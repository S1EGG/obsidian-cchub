import { Plugin, WorkspaceLeaf } from "obsidian";
import { ChatView, VIEW_TYPE_CHAT } from "./components/chat/ChatView";
import {
	createSettingsStore,
	type SettingsStore,
} from "./adapters/obsidian/settings-store.adapter";
import { CCHubSettingTab } from "./components/settings/CCHubSettingTab";
import {
	sanitizeArgs,
	normalizeEnvVars,
	normalizeAgentProfile,
	ensureUniqueAgentIds,
} from "./shared/settings-utils";
import { AgentEnvVar, AgentProfile } from "./domain/models/agent-config";
import { getAgentModuleById } from "./domain/agents/agent-modules";

// Re-export for backward compatibility
export type { AgentEnvVar, AgentProfile };

/**
 * Send message shortcut configuration.
 * - 'enter': Enter to send, Shift+Enter for newline (default)
 * - 'cmd-enter': Cmd/Ctrl+Enter to send, Enter for newline
 */
export type SendMessageShortcut = "enter" | "cmd-enter";

export interface CCHubPluginSettings {
	agents: AgentProfile[];
	activeAgentId: string;
	autoApproveRead: boolean;
	autoApproveList: boolean;
	autoApproveExecute: boolean;
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

const DEFAULT_SETTINGS: CCHubPluginSettings = {
	agents: [
		{
			id: "claude-code-acp",
			displayName: "Claude Code",
			moduleId: "acp:claude",
			enabled: true,
			command: "",
			args: [],
			env: [],
			auth: { apiKey: "" },
		},
		{
			id: "codex-acp",
			displayName: "Codex",
			moduleId: "mcp:codex",
			enabled: true,
			command: "",
			args: [],
			env: [],
			auth: { apiKey: "" },
		},
		{
			id: "gemini-cli",
			displayName: "Gemini CLI",
			moduleId: "acp:gemini",
			enabled: true,
			command: "",
			args: [],
			env: [],
			auth: { apiKey: "" },
		},
	],
	activeAgentId: "claude-code-acp",
	autoApproveRead: false,
	autoApproveList: false,
	autoApproveExecute: false,
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

export default class CCHubPlugin extends Plugin {
	settings: CCHubPluginSettings;
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			"Open CCHub",
			(_evt: MouseEvent) => {
				void this.activateView();
			},
		);
		ribbonIconEl.addClass("cchub-ribbon-icon");

		this.addCommand({
			id: "open-chat-view",
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			name: "Open CCHub",
			callback: () => {
				void this.activateView();
			},
		});

		// Register agent-specific commands
		this.registerAgentCommands();
		this.registerPermissionCommands();

		this.addSettingTab(new CCHubSettingTab(this.app, this));
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
						"textarea.cchub-chat-input-textarea",
					);
					if (textarea instanceof HTMLTextAreaElement) {
						textarea.focus();
					}
				}, 0);
			}
		}
	}

	/**
	 * Get all available agents from settings.
	 */
	private getAvailableAgents(): Array<{ id: string; displayName: string }> {
		return this.settings.agents
			.filter((agent) => agent.enabled)
			.map((agent) => ({
				id: agent.id,
				displayName: agent.displayName || agent.id,
			}));
	}

	/**
	 * Open chat view and switch to specified agent
	 */
	private async openChatWithAgent(agentId: string): Promise<void> {
		// 1. Activate view (create new or focus existing)
		await this.activateView();

		// 2. Trigger new chat with specific agent
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

		const defaultAgentsById = new Map(
			DEFAULT_SETTINGS.agents.map((agent) => [agent.id, agent]),
		);

		const resolveCodexModuleId = (
			command: string,
			args: string[],
		): string => {
			const normalizedCommand = command.trim().toLowerCase();
			if (normalizedCommand.includes("codex-acp")) {
				return "acp:codex";
			}
			const normalizedArgs = args.map((arg) => arg.toLowerCase());
			if (normalizedArgs.some((arg) => arg.includes("acp"))) {
				return "acp:codex";
			}
			return "mcp:codex";
		};

		const guessModuleId = (profile: AgentProfile): string => {
			const idLower = profile.id.toLowerCase();
			if (idLower.includes("claude")) {
				return "acp:claude";
			}
			if (idLower.includes("gemini")) {
				return "acp:gemini";
			}
			if (idLower.includes("codex")) {
				return resolveCodexModuleId(profile.command, profile.args);
			}
			return "acp:custom";
		};

		const ensureValidModuleId = (profile: AgentProfile): AgentProfile => {
			if (getAgentModuleById(profile.moduleId)) {
				return profile;
			}
			return { ...profile, moduleId: guessModuleId(profile) };
		};

		const resolvedAgents = (() => {
			if (Array.isArray(rawSettings.agents)) {
				const normalized = rawSettings.agents.map((agent) => {
					const agentObj =
						typeof agent === "object" && agent !== null
							? (agent as Record<string, unknown>)
							: {};
					const fallbackId =
						typeof agentObj.id === "string"
							? agentObj.id.trim()
							: "";
					const fallback = fallbackId
						? defaultAgentsById.get(fallbackId)
						: undefined;
					const normalizedProfile = normalizeAgentProfile(
						agentObj,
						fallback,
					);
					return ensureValidModuleId(normalizedProfile);
				});
				return ensureUniqueAgentIds(normalized);
			}

			const defaultClaude = DEFAULT_SETTINGS.agents.find(
				(agent) => agent.moduleId === "acp:claude",
			);
			const defaultCodex = DEFAULT_SETTINGS.agents.find(
				(agent) => agent.moduleId === "mcp:codex",
			);
			const defaultGemini = DEFAULT_SETTINGS.agents.find(
				(agent) => agent.moduleId === "acp:gemini",
			);

			const claudeDisplayName =
				typeof claudeFromRaw.displayName === "string" &&
				claudeFromRaw.displayName.trim().length > 0
					? claudeFromRaw.displayName.trim()
					: defaultClaude?.displayName || "Claude Code";
			const claudeApiKey =
				typeof claudeFromRaw.apiKey === "string"
					? claudeFromRaw.apiKey
					: legacyClaudeApiKey || defaultClaude?.auth?.apiKey || "";
			const claudeCommand =
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
							: defaultClaude?.command || "";
			const claudeArgs =
				resolvedClaudeArgs.length > 0
					? resolvedClaudeArgs
					: legacyClaudeArgs.length > 0
						? legacyClaudeArgs
						: [];

			const codexDisplayName =
				typeof codexFromRaw.displayName === "string" &&
				codexFromRaw.displayName.trim().length > 0
					? codexFromRaw.displayName.trim()
					: defaultCodex?.displayName || "Codex";
			const codexApiKey =
				typeof codexFromRaw.apiKey === "string"
					? codexFromRaw.apiKey
					: legacyCodexApiKey || defaultCodex?.auth?.apiKey || "";
			const codexCommand =
				typeof codexFromRaw.command === "string" &&
				codexFromRaw.command.trim().length > 0
					? codexFromRaw.command.trim()
					: legacyCodexCommand
						? legacyCodexCommand
						: defaultCodex?.command || "";
			const codexArgs =
				resolvedCodexArgs.length > 0
					? resolvedCodexArgs
					: legacyCodexArgs.length > 0
						? legacyCodexArgs
						: [];
			const codexModuleId = resolveCodexModuleId(codexCommand, codexArgs);

			const geminiDisplayName =
				typeof geminiFromRaw.displayName === "string" &&
				geminiFromRaw.displayName.trim().length > 0
					? geminiFromRaw.displayName.trim()
					: defaultGemini?.displayName || "Gemini CLI";
			const geminiApiKey =
				typeof geminiFromRaw.apiKey === "string"
					? geminiFromRaw.apiKey
					: legacyGeminiApiKey || defaultGemini?.auth?.apiKey || "";
			const geminiCommand =
				typeof geminiFromRaw.command === "string" &&
				geminiFromRaw.command.trim().length > 0
					? geminiFromRaw.command.trim()
					: legacyGeminiCommand
						? legacyGeminiCommand
						: typeof rawSettings.geminiCommandPath === "string" &&
							  rawSettings.geminiCommandPath.trim().length > 0
							? rawSettings.geminiCommandPath.trim()
							: defaultGemini?.command || "";
			const geminiArgs =
				resolvedGeminiArgs.length > 0
					? resolvedGeminiArgs
					: legacyGeminiArgs.length > 0
						? legacyGeminiArgs
						: [];

			const claudeProfile: AgentProfile = {
				id: defaultClaude?.id || "claude-code-acp",
				displayName: claudeDisplayName,
				moduleId: "acp:claude",
				enabled: true,
				command: claudeCommand,
				args: claudeArgs,
				env: resolvedClaudeEnv.length > 0 ? resolvedClaudeEnv : [],
				auth: { apiKey: claudeApiKey },
			};
			const codexProfile: AgentProfile = {
				id: defaultCodex?.id || "codex-acp",
				displayName: codexDisplayName,
				moduleId: codexModuleId,
				enabled: true,
				command: codexCommand,
				args: codexArgs,
				env: resolvedCodexEnv.length > 0 ? resolvedCodexEnv : [],
				auth: { apiKey: codexApiKey },
			};
			const geminiProfile: AgentProfile = {
				id: defaultGemini?.id || "gemini-cli",
				displayName: geminiDisplayName,
				moduleId: "acp:gemini",
				enabled: true,
				command: geminiCommand,
				args: geminiArgs,
				env: resolvedGeminiEnv.length > 0 ? resolvedGeminiEnv : [],
				auth: { apiKey: geminiApiKey },
			};

			const customFallback: Partial<AgentProfile> = {
				id: "custom-agent",
				displayName: "Custom agent",
				moduleId: "acp:custom",
				enabled: true,
				command: "",
				args: [],
				env: [],
			};
			const legacyCustomAgents = Array.isArray(rawSettings.customAgents)
				? rawSettings.customAgents.map((agent: unknown) => {
						const agentObj =
							typeof agent === "object" && agent !== null
								? (agent as Record<string, unknown>)
								: {};
						const normalizedProfile = normalizeAgentProfile(
							agentObj,
							customFallback,
						);
						return ensureValidModuleId(normalizedProfile);
					})
				: [];

			return ensureUniqueAgentIds([
				claudeProfile,
				codexProfile,
				geminiProfile,
				...legacyCustomAgents,
			]);
		})();

		const normalizedAgents =
			resolvedAgents.length > 0
				? resolvedAgents
				: DEFAULT_SETTINGS.agents.map((agent) => ({
						...agent,
						args: [...agent.args],
						env: [...agent.env],
						auth: agent.auth ? { ...agent.auth } : undefined,
					}));

		const enabledAgentIds = normalizedAgents
			.filter((agent) => agent.enabled)
			.map((agent) => agent.id)
			.filter((id) => id.length > 0);
		const availableAgentIds =
			enabledAgentIds.length > 0
				? enabledAgentIds
				: normalizedAgents
						.map((agent) => agent.id)
						.filter((id) => id.length > 0);
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
				? "claude-code-acp"
				: legacyActiveAgent === "codex"
					? "codex-acp"
					: legacyActiveAgent === "gemini"
						? "gemini-cli"
						: "";
		const fallbackActiveId =
			availableAgentIds.find((id) => id.length > 0) ||
			DEFAULT_SETTINGS.agents[0]?.id ||
			"";
		const candidateActiveId =
			rawActiveId.length > 0 ? rawActiveId : legacyActiveAgentId;
		const activeAgentId =
			availableAgentIds.includes(candidateActiveId) &&
			candidateActiveId.length > 0
				? candidateActiveId
				: fallbackActiveId;

		this.settings = {
			agents: normalizedAgents,
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

	async saveSettingsAndNotify(nextSettings: CCHubPluginSettings) {
		this.settings = nextSettings;
		await this.saveData(this.settings);
		this.settingsStore.set(this.settings);
	}

	ensureActiveAgentId(): void {
		const availableIds = this.collectAvailableAgentIds();
		if (availableIds.length === 0) {
			this.settings.activeAgentId = DEFAULT_SETTINGS.agents[0]?.id || "";
			return;
		}
		if (!availableIds.includes(this.settings.activeAgentId)) {
			this.settings.activeAgentId =
				availableIds[0] || DEFAULT_SETTINGS.agents[0]?.id || "";
		}
	}

	private collectAvailableAgentIds(): string[] {
		const enabledIds = this.settings.agents
			.filter((agent) => agent.enabled)
			.map((agent) => agent.id)
			.filter((id) => id.length > 0);
		if (enabledIds.length > 0) {
			return Array.from(new Set(enabledIds));
		}
		const allIds = this.settings.agents
			.map((agent) => agent.id)
			.filter((id) => id.length > 0);
		return Array.from(new Set(allIds));
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
