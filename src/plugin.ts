import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./components/chat/ChatView";
import {
	createSettingsStore,
	type SettingsStore,
} from "./adapters/obsidian/settings-store.adapter";
import { AgentClientSettingTab } from "./components/settings/AgentClientSettingTab";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeCustomAgent,
	ensureUniqueCustomAgentIds,
} from "./shared/settings-utils";
import {
	AgentEnvVar,
	GeminiAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	CustomAgentSettings,
} from "./domain/models/agent-config";

// Re-export for backward compatibility
export type { AgentEnvVar, CustomAgentSettings };

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

export interface AgentClientPluginSettings {
	gemini: GeminiAgentSettings;
	claude: ClaudeAgentSettings;
	codex: CodexAgentSettings;
	customAgents: CustomAgentSettings[];
	activeAgentId: string;
	autoApproveRead: boolean;
	autoApproveList: boolean;
	autoApproveExecute: boolean;
	autoMentionActiveNote: boolean;
	debugMode: boolean;
	nodePath: string;
	workingDirectory: string;
	exportSettings: {
		defaultFolder: string;
		filenameTemplate: string;
		autoExportOnNewChat: boolean;
		autoExportOnCloseChat: boolean;
		openFileAfterExport: boolean;
		includeImages: boolean;
		imageLocation: "obsidian" | "custom" | "base64";
		imageCustomFolder: string;
	};
	// WSL settings (Windows only)
	windowsWslMode: boolean;
	windowsWslDistribution?: string;
	// Input behavior
	sendMessageShortcut: SendMessageShortcut;
}

const DEFAULT_SETTINGS: AgentClientPluginSettings = {
	claude: {
		id: "claude-code-acp",
		displayName: "Claude Code",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	codex: {
		id: "codex-acp",
		displayName: "Codex",
		apiKey: "",
		command: "",
		args: [],
		env: [],
	},
	gemini: {
		id: "gemini-cli",
		displayName: "Gemini CLI",
		apiKey: "",
		command: "",
		args: ["--experimental-acp"],
		env: [],
	},
	customAgents: [],
	activeAgentId: "claude-code-acp",
	autoApproveRead: false,
	autoApproveList: false,
	autoApproveExecute: false,
	autoMentionActiveNote: true,
	debugMode: false,
	nodePath: "",
	workingDirectory: "",
	exportSettings: {
		defaultFolder: "CCHub",
		filenameTemplate: "cchub_{date}_{time}",
		autoExportOnNewChat: false,
		autoExportOnCloseChat: false,
		openFileAfterExport: true,
		includeImages: true,
		imageLocation: "obsidian",
		imageCustomFolder: "CCHub",
	},
	windowsWslMode: false,
	windowsWslDistribution: undefined,
	sendMessageShortcut: "enter",
};

export default class AgentClientPlugin extends Plugin {
	settings: AgentClientPluginSettings;
	settingsStore!: SettingsStore;

	// Active ACP adapter instance (shared across use cases)
	acpAdapter: import("./adapters/acp/acp.adapter").AcpAdapter | null = null;

	async onload() {
		await this.loadSettings();

		const fallbackWorkingDirectory = this.resolveVaultBasePath();
		if (!this.settings.workingDirectory && fallbackWorkingDirectory) {
			this.settings.workingDirectory = fallbackWorkingDirectory;
			await this.saveSettings();
		}

		// Initialize settings store
		this.settingsStore = createSettingsStore(this.settings, this);

		this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));

		const ribbonIconEl = this.addRibbonIcon(
			"bot-message-square",
			"Open CCHub",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("cchub-ribbon-icon");

		this.addCommand({
			id: "open-chat-view",
			name: "Open CCHub",
			callback: () => {
				void this.activateView();
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();

		this.addSettingTab(new AgentClientSettingTab(this.app, this));
	}

	onunload() {}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

		if (leaves.length > 0) {
			const firstLeaf = leaves[0];
			if (firstLeaf) {
				leaf = firstLeaf;
			}
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: VIEW_TYPE_CHAT,
					active: true,
				});
			}
		}

		if (leaf) {
			await workspace.revealLeaf(leaf);
			// Focus textarea after revealing the leaf
			const viewContainerEl = leaf.view?.containerEl;
			if (viewContainerEl) {
				window.setTimeout(() => {
					const textarea = viewContainerEl.querySelector(
						"textarea.agent-client-chat-input-textarea",
					);
					if (textarea instanceof HTMLTextAreaElement) {
						textarea.focus();
					}
				}, 0);
			}
		}
	}

	/**
	 * Get all available agents (claude, codex, gemini, custom)
	 */
	private getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return [
			{
				id: this.settings.claude.id,
				displayName:
					this.settings.claude.displayName || this.settings.claude.id,
			},
			{
				id: this.settings.codex.id,
				displayName:
					this.settings.codex.displayName || this.settings.codex.id,
			},
			{
				id: this.settings.gemini.id,
				displayName:
					this.settings.gemini.displayName || this.settings.gemini.id,
			},
			...this.settings.customAgents.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName || agent.id,
			})),
		];
	}

	/**
	 * Open chat view and switch to specified agent
	 */
	private async openChatWithAgent(agentId: string): Promise<void> {
		// 1. Switch agent in settings (if different from current)
		if (this.settings.activeAgentId !== agentId) {
			await this.settingsStore.updateSettings({ activeAgentId: agentId });
		}

		// 2. Activate view (create new or focus existing)
		await this.activateView();

		// Trigger new chat with specific agent
		// Pass agentId so ChatComponent knows to force new session even if empty
		this.app.workspace.trigger(
			"cchub:new-chat-requested" as "quit",
			agentId,
		);
	}

	/**
	 * Register commands for each configured agent
	 */
	private registerAgentCommands(): void {
		const agents = this.getAvailableAgents();

		for (const agent of agents) {
			this.addCommand({
				id: `open-chat-with-${agent.id}`,
				name: `New chat with ${agent.displayName}`,
				callback: async () => {
					await this.openChatWithAgent(agent.id);
				},
			});
		}
	}

	private registerPermissionCommands(): void {
		this.addCommand({
			id: "approve-active-permission",
			name: "Approve active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger("cchub:approve-active-permission");
			},
		});

		this.addCommand({
			id: "reject-active-permission",
			name: "Reject active permission",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger("cchub:reject-active-permission");
			},
		});

		this.addCommand({
			id: "toggle-auto-mention",
			name: "Toggle auto-mention",
			callback: async () => {
				await this.activateView();
				this.app.workspace.trigger("cchub:toggle-auto-mention");
			},
		});

		this.addCommand({
			id: "cancel-current-message",
			name: "Cancel current message",
			callback: () => {
				this.app.workspace.trigger("cchub:cancel-message");
			},
		});
	}

	async loadSettings() {
		const rawSettings = ((await this.loadData()) ?? {}) as Record<
			string,
			unknown
		>;
		const legacyBuiltIn =
			typeof rawSettings.builtInAgents === "object" &&
			rawSettings.builtInAgents !== null
				? (rawSettings.builtInAgents as Record<string, unknown>)
				: {};
		const legacyClaude =
			typeof legacyBuiltIn.claudeCode === "object" &&
			legacyBuiltIn.claudeCode !== null
				? (legacyBuiltIn.claudeCode as Record<string, unknown>)
				: {};
		const legacyCodex =
			typeof legacyBuiltIn.codexCli === "object" &&
			legacyBuiltIn.codexCli !== null
				? (legacyBuiltIn.codexCli as Record<string, unknown>)
				: {};
		const legacyGemini =
			typeof legacyBuiltIn.geminiCli === "object" &&
			legacyBuiltIn.geminiCli !== null
				? (legacyBuiltIn.geminiCli as Record<string, unknown>)
				: {};
		const legacyClaudeEnabled =
			typeof legacyClaude.enabled === "boolean"
				? legacyClaude.enabled
				: false;
		const legacyCodexEnabled =
			typeof legacyCodex.enabled === "boolean"
				? legacyCodex.enabled
				: false;
		const legacyGeminiEnabled =
			typeof legacyGemini.enabled === "boolean"
				? legacyGemini.enabled
				: false;
		const legacyClaudeCommand =
			legacyClaudeEnabled && typeof legacyClaude.path === "string"
				? legacyClaude.path.trim()
				: "";
		const legacyCodexCommand =
			legacyCodexEnabled && typeof legacyCodex.path === "string"
				? legacyCodex.path.trim()
				: "";
		const legacyGeminiCommand =
			legacyGeminiEnabled && typeof legacyGemini.path === "string"
				? legacyGemini.path.trim()
				: "";
		const legacyClaudeApiKey =
			legacyClaudeEnabled && typeof legacyClaude.apiKey === "string"
				? legacyClaude.apiKey
				: "";
		const legacyCodexApiKey =
			legacyCodexEnabled && typeof legacyCodex.apiKey === "string"
				? legacyCodex.apiKey
				: "";
		const legacyGeminiApiKey =
			legacyGeminiEnabled && typeof legacyGemini.apiKey === "string"
				? legacyGemini.apiKey
				: "";
		const legacyClaudeArgs = legacyClaudeEnabled
			? sanitizeArgs(legacyClaude.args)
			: [];
		const legacyCodexArgs = legacyCodexEnabled
			? sanitizeArgs(legacyCodex.args)
			: [];
		const legacyGeminiArgs = legacyGeminiEnabled
			? sanitizeArgs(legacyGemini.args)
			: [];

		const claudeFromRaw =
			typeof rawSettings.claude === "object" &&
			rawSettings.claude !== null
				? (rawSettings.claude as Record<string, unknown>)
				: {};
		const codexFromRaw =
			typeof rawSettings.codex === "object" && rawSettings.codex !== null
				? (rawSettings.codex as Record<string, unknown>)
				: {};
		const geminiFromRaw =
			typeof rawSettings.gemini === "object" &&
			rawSettings.gemini !== null
				? (rawSettings.gemini as Record<string, unknown>)
				: {};

		const resolvedClaudeArgs = sanitizeArgs(claudeFromRaw.args);
		const resolvedClaudeEnv = normalizeEnvVars(claudeFromRaw.env);
		const resolvedCodexArgs = sanitizeArgs(codexFromRaw.args);
		const resolvedCodexEnv = normalizeEnvVars(codexFromRaw.env);
		const resolvedGeminiArgs = sanitizeArgs(geminiFromRaw.args);
		const resolvedGeminiEnv = normalizeEnvVars(geminiFromRaw.env);
		const customAgents = Array.isArray(rawSettings.customAgents)
			? ensureUniqueCustomAgentIds(
					rawSettings.customAgents.map((agent: unknown) => {
						const agentObj =
							typeof agent === "object" && agent !== null
								? (agent as Record<string, unknown>)
								: {};
						return normalizeCustomAgent(agentObj);
					}),
				)
			: [];
		const legacyAutoAllow =
			typeof rawSettings.autoAllowPermissions === "boolean"
				? rawSettings.autoAllowPermissions
				: false;
		const legacyAutoExportOnNewChat =
			typeof rawSettings.autoExportOnNewChat === "boolean"
				? rawSettings.autoExportOnNewChat
				: null;
		const legacyAutoExportOnCloseChat =
			typeof rawSettings.autoExportOnCloseChat === "boolean"
				? rawSettings.autoExportOnCloseChat
				: null;
		const resolvedExportSettings = (() => {
			const rawExport = rawSettings.exportSettings as
				| Record<string, unknown>
				| null
				| undefined;
			const hasRawExport = rawExport && typeof rawExport === "object";

			const baseSettings = hasRawExport
				? {
						defaultFolder:
							typeof rawExport.defaultFolder === "string"
								? rawExport.defaultFolder
								: DEFAULT_SETTINGS.exportSettings.defaultFolder,
						filenameTemplate:
							typeof rawExport.filenameTemplate === "string"
								? rawExport.filenameTemplate
								: DEFAULT_SETTINGS.exportSettings
										.filenameTemplate,
						autoExportOnNewChat:
							typeof rawExport.autoExportOnNewChat === "boolean"
								? rawExport.autoExportOnNewChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnNewChat,
						autoExportOnCloseChat:
							typeof rawExport.autoExportOnCloseChat === "boolean"
								? rawExport.autoExportOnCloseChat
								: DEFAULT_SETTINGS.exportSettings
										.autoExportOnCloseChat,
						openFileAfterExport:
							typeof rawExport.openFileAfterExport === "boolean"
								? rawExport.openFileAfterExport
								: DEFAULT_SETTINGS.exportSettings
										.openFileAfterExport,
						includeImages:
							typeof rawExport.includeImages === "boolean"
								? rawExport.includeImages
								: DEFAULT_SETTINGS.exportSettings.includeImages,
						imageLocation:
							rawExport.imageLocation === "obsidian" ||
							rawExport.imageLocation === "custom" ||
							rawExport.imageLocation === "base64"
								? rawExport.imageLocation
								: DEFAULT_SETTINGS.exportSettings.imageLocation,
						imageCustomFolder:
							typeof rawExport.imageCustomFolder === "string"
								? rawExport.imageCustomFolder
								: DEFAULT_SETTINGS.exportSettings
										.imageCustomFolder,
					}
				: { ...DEFAULT_SETTINGS.exportSettings };

			if (!hasRawExport && legacyAutoExportOnNewChat !== null) {
				baseSettings.autoExportOnNewChat = legacyAutoExportOnNewChat;
			}
			if (!hasRawExport && legacyAutoExportOnCloseChat !== null) {
				baseSettings.autoExportOnCloseChat =
					legacyAutoExportOnCloseChat;
			}

			return baseSettings;
		})();

		const availableAgentIds = [
			DEFAULT_SETTINGS.claude.id,
			DEFAULT_SETTINGS.codex.id,
			DEFAULT_SETTINGS.gemini.id,
			...customAgents.map((agent) => agent.id),
		];
		const rawActiveId =
			typeof rawSettings.activeAgentId === "string"
				? rawSettings.activeAgentId.trim()
				: "";
		const legacyActiveAgent =
			typeof rawSettings.activeAgent === "string"
				? rawSettings.activeAgent.trim()
				: "";
		const legacyActiveAgentId =
			legacyActiveAgent === "claude"
				? DEFAULT_SETTINGS.claude.id
				: legacyActiveAgent === "codex"
					? DEFAULT_SETTINGS.codex.id
					: legacyActiveAgent === "gemini"
						? DEFAULT_SETTINGS.gemini.id
						: "";
		const fallbackActiveId =
			availableAgentIds.find((id) => id.length > 0) ||
			DEFAULT_SETTINGS.claude.id;
		const candidateActiveId =
			rawActiveId.length > 0 ? rawActiveId : legacyActiveAgentId;
		const activeAgentId =
			availableAgentIds.includes(candidateActiveId) &&
			candidateActiveId.length > 0
				? candidateActiveId
				: fallbackActiveId;

		this.settings = {
			claude: {
				id: DEFAULT_SETTINGS.claude.id,
				displayName:
					typeof claudeFromRaw.displayName === "string" &&
					claudeFromRaw.displayName.trim().length > 0
						? claudeFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.claude.displayName,
				apiKey:
					typeof claudeFromRaw.apiKey === "string"
						? claudeFromRaw.apiKey
						: legacyClaudeApiKey || DEFAULT_SETTINGS.claude.apiKey,
				command:
					typeof claudeFromRaw.command === "string" &&
					claudeFromRaw.command.trim().length > 0
						? claudeFromRaw.command.trim()
						: legacyClaudeCommand
							? legacyClaudeCommand
							: typeof rawSettings.claudeCodeAcpCommandPath ===
										"string" &&
								  rawSettings.claudeCodeAcpCommandPath.trim()
										.length > 0
								? rawSettings.claudeCodeAcpCommandPath.trim()
								: DEFAULT_SETTINGS.claude.command,
				args:
					resolvedClaudeArgs.length > 0
						? resolvedClaudeArgs
						: legacyClaudeArgs.length > 0
							? legacyClaudeArgs
							: [],
				env: resolvedClaudeEnv.length > 0 ? resolvedClaudeEnv : [],
			},
			codex: {
				id: DEFAULT_SETTINGS.codex.id,
				displayName:
					typeof codexFromRaw.displayName === "string" &&
					codexFromRaw.displayName.trim().length > 0
						? codexFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.codex.displayName,
				apiKey:
					typeof codexFromRaw.apiKey === "string"
						? codexFromRaw.apiKey
						: legacyCodexApiKey || DEFAULT_SETTINGS.codex.apiKey,
				command:
					typeof codexFromRaw.command === "string" &&
					codexFromRaw.command.trim().length > 0
						? codexFromRaw.command.trim()
						: legacyCodexCommand
							? legacyCodexCommand
							: DEFAULT_SETTINGS.codex.command,
				args:
					resolvedCodexArgs.length > 0
						? resolvedCodexArgs
						: legacyCodexArgs.length > 0
							? legacyCodexArgs
							: [],
				env: resolvedCodexEnv.length > 0 ? resolvedCodexEnv : [],
			},
			gemini: {
				id: DEFAULT_SETTINGS.gemini.id,
				displayName:
					typeof geminiFromRaw.displayName === "string" &&
					geminiFromRaw.displayName.trim().length > 0
						? geminiFromRaw.displayName.trim()
						: DEFAULT_SETTINGS.gemini.displayName,
				apiKey:
					typeof geminiFromRaw.apiKey === "string"
						? geminiFromRaw.apiKey
						: legacyGeminiApiKey || DEFAULT_SETTINGS.gemini.apiKey,
				command:
					typeof geminiFromRaw.command === "string" &&
					geminiFromRaw.command.trim().length > 0
						? geminiFromRaw.command.trim()
						: legacyGeminiCommand
							? legacyGeminiCommand
							: typeof rawSettings.geminiCommandPath ===
										"string" &&
								  rawSettings.geminiCommandPath.trim().length >
										0
								? rawSettings.geminiCommandPath.trim()
								: DEFAULT_SETTINGS.gemini.command,
				args:
					resolvedGeminiArgs.length > 0
						? resolvedGeminiArgs
						: legacyGeminiArgs.length > 0
							? legacyGeminiArgs
							: DEFAULT_SETTINGS.gemini.args,
				env: resolvedGeminiEnv.length > 0 ? resolvedGeminiEnv : [],
			},
			customAgents: customAgents,
			activeAgentId,
			autoApproveRead:
				typeof rawSettings.autoApproveRead === "boolean"
					? rawSettings.autoApproveRead
					: legacyAutoAllow || DEFAULT_SETTINGS.autoApproveRead,
			autoApproveList:
				typeof rawSettings.autoApproveList === "boolean"
					? rawSettings.autoApproveList
					: legacyAutoAllow || DEFAULT_SETTINGS.autoApproveList,
			autoApproveExecute:
				typeof rawSettings.autoApproveExecute === "boolean"
					? rawSettings.autoApproveExecute
					: legacyAutoAllow || DEFAULT_SETTINGS.autoApproveExecute,
			autoMentionActiveNote:
				typeof rawSettings.autoMentionActiveNote === "boolean"
					? rawSettings.autoMentionActiveNote
					: DEFAULT_SETTINGS.autoMentionActiveNote,
			debugMode:
				typeof rawSettings.debugMode === "boolean"
					? rawSettings.debugMode
					: DEFAULT_SETTINGS.debugMode,
			nodePath:
				typeof rawSettings.nodePath === "string"
					? rawSettings.nodePath.trim()
					: DEFAULT_SETTINGS.nodePath,
			workingDirectory:
				typeof rawSettings.workingDirectory === "string"
					? rawSettings.workingDirectory.trim()
					: DEFAULT_SETTINGS.workingDirectory,
			exportSettings: resolvedExportSettings,
			windowsWslMode:
				typeof rawSettings.windowsWslMode === "boolean"
					? rawSettings.windowsWslMode
					: DEFAULT_SETTINGS.windowsWslMode,
			windowsWslDistribution:
				typeof rawSettings.windowsWslDistribution === "string"
					? rawSettings.windowsWslDistribution
					: DEFAULT_SETTINGS.windowsWslDistribution,
			sendMessageShortcut:
				rawSettings.sendMessageShortcut === "enter" ||
				rawSettings.sendMessageShortcut === "cmd-enter"
					? rawSettings.sendMessageShortcut
					: DEFAULT_SETTINGS.sendMessageShortcut,
		};

		this.ensureActiveAgentId();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		if (this.settingsStore) {
			this.settingsStore.set(this.settings);
		}
	}

	async saveSettingsAndNotify(nextSettings: AgentClientPluginSettings) {
		this.settings = nextSettings;
		await this.saveData(this.settings);
		this.settingsStore.set(this.settings);
	}

	ensureActiveAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (availableIds.length === 0) {
			this.settings.activeAgentId = DEFAULT_SETTINGS.claude.id;
			return;
		}
		if (!availableIds.includes(this.settings.activeAgentId)) {
			this.settings.activeAgentId =
				availableIds[0] || DEFAULT_SETTINGS.claude.id;
		}
	}

	private collectAvailableAgentIds(): string[] {
		const ids = new Set<string>();
		ids.add(this.settings.claude.id);
		ids.add(this.settings.codex.id);
		ids.add(this.settings.gemini.id);
		for (const agent of this.settings.customAgents) {
			if (agent.id && agent.id.length > 0) {
				ids.add(agent.id);
			}
		}
		return Array.from(ids);
	}

	private resolveVaultBasePath(): string {
		const adapter = this.app.vault.adapter as {
			basePath?: string;
			getBasePath?: () => string;
		};
		if (typeof adapter.getBasePath === "function") {
			return adapter.getBasePath();
		}
		return adapter.basePath || "";
	}
}
