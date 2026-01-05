import { ItemView, WorkspaceLeaf, Platform, Notice } from "obsidian";
import * as React from "react";
const { useState, useRef, useEffect, useMemo, useCallback } = React;
import { createRoot, Root } from "react-dom/client";

import type CCHubPlugin from "../../plugin";

// Component imports
import { ChatHeader } from "./ChatHeader";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";

// Service imports
import { NoteMentionService } from "../../adapters/obsidian/mention-service";

// Utility imports
import { Logger } from "../../shared/logger";
import { ChatExporter } from "../../shared/chat-exporter";

// Adapter imports
import { AcpAdapter, type IAcpClient } from "../../adapters/acp/acp.adapter";
import { CodexAdapter } from "../../adapters/codex/codex.adapter";
import { CCHubRouter } from "../../adapters/cchub-router";
import { ObsidianVaultAdapter } from "../../adapters/obsidian/vault.adapter";

// Hooks imports
import { useSettings } from "../../hooks/useSettings";
import { useMentions } from "../../hooks/useMentions";
import { useSlashCommands } from "../../hooks/useSlashCommands";
import { useAgentSession } from "../../hooks/useAgentSession";
import { useChat } from "../../hooks/useChat";
import { usePermission } from "../../hooks/usePermission";
import { useAutoExport } from "../../hooks/useAutoExport";
import {
	getActiveAgentId,
	getAvailableAgentsFromSettings,
	getAgentDisplayName,
	getAgentModuleId,
} from "../../hooks/session/session-helpers";

// Type definitions for Obsidian internal APIs
interface VaultAdapterWithBasePath {
	basePath?: string;
}

interface AppWithSettings {
	setting: {
		open: () => void;
		openTabById: (id: string) => void;
	};
}

export const VIEW_TYPE_CHAT = "cchub-chat-view";

function ChatComponent({
	plugin,
	view,
}: {
	plugin: CCHubPlugin;
	view: ChatView;
}) {
	// ============================================================
	// Platform Check
	// ============================================================
	if (!Platform.isDesktopApp) {
		throw new Error("CCHub is only available on desktop");
	}

	// ============================================================
	// Memoized Services & Adapters
	// ============================================================
	const logger = useMemo(() => new Logger(plugin), [plugin]);

	const vaultPath = useMemo(() => {
		return (
			(plugin.app.vault.adapter as VaultAdapterWithBasePath).basePath ||
			process.cwd()
		);
	}, [plugin]);

	const noteMentionService = useMemo(
		() => new NoteMentionService(plugin),
		[plugin],
	);

	// Cleanup NoteMentionService when component unmounts
	useEffect(() => {
		return () => {
			noteMentionService.destroy();
		};
	}, [noteMentionService]);

	const acpAdapter = useMemo(() => new AcpAdapter(plugin), [plugin]);
	const codexAdapter = useMemo(() => new CodexAdapter(plugin), [plugin]);
	const cchubClient = useMemo(
		() => new CCHubRouter(plugin, acpAdapter, codexAdapter),
		[plugin, acpAdapter, codexAdapter],
	);
	const acpClientRef = useRef<IAcpClient>(acpAdapter);

	const vaultAccessAdapter = useMemo(() => {
		return new ObsidianVaultAdapter(plugin, noteMentionService);
	}, [plugin, noteMentionService]);

	// ============================================================
	// Custom Hooks
	// ============================================================
	const settings = useSettings(plugin);

	const workingDirectory = useMemo(() => {
		const configured = settings.workingDirectory.trim();
		return configured || vaultPath;
	}, [settings.workingDirectory, vaultPath]);

	const agentSession = useAgentSession(
		cchubClient,
		plugin.settingsStore,
		workingDirectory,
	);

	const {
		session,
		errorInfo: sessionErrorInfo,
		isReady: isSessionReady,
	} = agentSession;

	const chat = useChat(
		cchubClient,
		vaultAccessAdapter,
		noteMentionService,
		{
			sessionId: session.sessionId,
			authMethods: session.authMethods,
		},
		{
			windowsWslMode: settings.windowsWslMode,
		},
	);

	const { messages, isSending, isAwaitingResponse } = chat;

	const permission = usePermission(cchubClient, messages);

	const mentions = useMentions(vaultAccessAdapter, plugin);
	const slashCommands = useSlashCommands(session.availableCommands || []);

	const autoExport = useAutoExport(plugin);

	// Combined error info (session errors take precedence)
	const errorInfo =
		sessionErrorInfo || chat.errorInfo || permission.errorInfo;

	// ============================================================
	// Local State
	// ============================================================
	const [restoredMessage, setRestoredMessage] = useState<string | null>(null);

	// ============================================================
	// Computed Values
	// ============================================================
	const activeAgentLabel = useMemo(() => {
		return getAgentDisplayName(plugin.settings, session.agentId);
	}, [session.agentId, plugin.settings]);

	const activeAgentModuleId = useMemo(() => {
		return getAgentModuleId(plugin.settings, session.agentId);
	}, [session.agentId, plugin.settings]);

	const availableAgents = useMemo(() => {
		return getAvailableAgentsFromSettings(settings);
	}, [settings]);

	const defaultAgentId = useMemo(() => {
		return getActiveAgentId(settings);
	}, [settings]);

	// ============================================================
	// Callbacks
	// ============================================================
	/**
	 * Handle new chat request.
	 * @param requestedAgentId - If provided, switch to this agent (from "New chat with [Agent]" command)
	 */
	const handleNewChat = useCallback(
		async (requestedAgentId?: string) => {
			const targetAgentId =
				requestedAgentId ?? getActiveAgentId(settings);
			const isAgentSwitch = targetAgentId !== session.agentId;

			// Skip if already empty AND not switching agents
			if (messages.length === 0 && !isAgentSwitch) {
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				new Notice("CCHub: Already a new session");
				return;
			}

			// Cancel ongoing generation before starting new chat
			if (chat.isSending) {
				await agentSession.cancelOperation();
			}

			logger.log(
				`[Debug] Creating new session${isAgentSwitch ? ` with agent: ${targetAgentId}` : ""}...`,
			);

			// Auto-export current chat before starting new one (if has messages)
			if (messages.length > 0) {
				await autoExport.autoExportIfEnabled(
					"newChat",
					messages,
					session,
				);
			}

			// Switch agent if requested
			if (isAgentSwitch) {
				chat.clearMessages();
				await agentSession.restartSession(targetAgentId);
				return;
			}

			chat.clearMessages();
			await agentSession.restartSession();
		},
		[messages, session, logger, autoExport, chat, agentSession, settings],
	);

	const handleExportChat = useCallback(async () => {
		if (messages.length === 0) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("CCHub: No messages to export");
			return;
		}

		try {
			const exporter = new ChatExporter(plugin);
			const openFile = plugin.settings.exportSettings.openFileAfterExport;
			const filePath = await exporter.exportToMarkdown(
				messages,
				session.agentDisplayName,
				session.agentId,
				session.sessionId || "unknown",
				session.createdAt,
				openFile,
			);
			new Notice(`CCHub: Chat exported to ${filePath}`);
		} catch (error) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			new Notice("CCHub: Failed to export chat");
			logger.error("Export error:", error);
		}
	}, [messages, session, plugin, logger]);

	const handleOpenSettings = useCallback(() => {
		const appWithSettings = plugin.app as unknown as AppWithSettings;
		appWithSettings.setting.open();
		appWithSettings.setting.openTabById(plugin.manifest.id);
	}, [plugin]);

	const handleSendMessage = useCallback(
		async (
			content: string,
			images?: import("../../domain/models/prompt-content").ImagePromptContent[],
		) => {
			await chat.sendMessage(content, {
				vaultBasePath:
					(plugin.app.vault.adapter as VaultAdapterWithBasePath)
						.basePath || "",
				images,
			});
		},
		[chat, plugin],
	);

	const handleStopGeneration = useCallback(async () => {
		logger.log("Cancelling current operation...");
		// Save last user message before cancel (to restore it)
		const lastMessage = chat.lastUserMessage;
		await agentSession.cancelOperation();
		// Restore the last user message to input field
		if (lastMessage) {
			setRestoredMessage(lastMessage);
		}
	}, [logger, agentSession, chat.lastUserMessage]);

	const handleClearError = useCallback(() => {
		chat.clearError();
	}, [chat]);

	const handleRestoredMessageConsumed = useCallback(() => {
		setRestoredMessage(null);
	}, []);

	// ============================================================
	// Effects - Session Lifecycle
	// ============================================================
	// Initialize session on mount
	useEffect(() => {
		logger.log("[Debug] Starting connection setup via useAgentSession...");
		void agentSession.createSession();
	}, [agentSession.createSession, logger]);

	// Refs for cleanup (to access latest values in cleanup function)
	const messagesRef = useRef(messages);
	const sessionRef = useRef(session);
	const autoExportRef = useRef(autoExport);
	const closeSessionRef = useRef(agentSession.closeSession);
	messagesRef.current = messages;
	sessionRef.current = session;
	autoExportRef.current = autoExport;
	closeSessionRef.current = agentSession.closeSession;

	// Cleanup on unmount only - auto-export and close session
	useEffect(() => {
		return () => {
			logger.log("[ChatView] Cleanup: auto-export and close session");
			// Use refs to get latest values (avoid stale closures)
			void (async () => {
				await autoExportRef.current.autoExportIfEnabled(
					"closeChat",
					messagesRef.current,
					sessionRef.current,
				);
				await closeSessionRef.current();
			})();
		};
		// Empty dependency array - only run on unmount
	}, []);

	// ============================================================
	// Effects - ACP Adapter Callbacks
	// ============================================================
	// Register unified session update callback
	useEffect(() => {
		cchubClient.onSessionUpdate((update) => {
			// Filter by sessionId - ignore updates from old sessions
			if (session.sessionId && update.sessionId !== session.sessionId) {
				logger.log(
					`[ChatView] Ignoring update for old session: ${update.sessionId} (current: ${session.sessionId})`,
				);
				return;
			}

			// Route message-related updates to useChat
			chat.handleSessionUpdate(update);

			// Route session-level updates to useAgentSession
			if (update.type === "available_commands_update") {
				agentSession.updateAvailableCommands(update.commands);
			} else if (update.type === "current_mode_update") {
				agentSession.updateCurrentMode(update.currentModeId);
			}
		});
	}, [
		cchubClient,
		session.sessionId,
		logger,
		chat.handleSessionUpdate,
		agentSession.updateAvailableCommands,
		agentSession.updateCurrentMode,
	]);

	// Register updateMessage callback for permission UI updates
	useEffect(() => {
		acpAdapter.setUpdateMessageCallback(chat.updateMessage);
	}, [acpAdapter, chat.updateMessage]);

	// ============================================================
	// Effects - Workspace Events (Hotkeys)
	// ============================================================
	// Handle new chat request from plugin commands (e.g., "New chat with [Agent]")
	useEffect(() => {
		const workspace = plugin.app.workspace;

		// Cast to any to bypass Obsidian's type constraints for custom events
		const eventRef = (
			workspace as unknown as {
				on: (
					name: string,
					callback: (agentId?: string) => void,
				) => ReturnType<typeof workspace.on>;
			}
		).on("cchub:new-chat-requested", (agentId?: string) => {
			void handleNewChat(agentId);
		});

		return () => {
			workspace.offref(eventRef);
		};
	}, [plugin.app.workspace, handleNewChat]);

	useEffect(() => {
		const workspace = plugin.app.workspace;

		const approveRef = workspace.on(
			"cchub:approve-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.approveActivePermission();
					if (!success) {
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						new Notice("CCHub: No active permission request");
					}
				})();
			},
		);

		const rejectRef = workspace.on(
			"cchub:reject-active-permission" as "quit",
			() => {
				void (async () => {
					const success = await permission.rejectActivePermission();
					if (!success) {
						// eslint-disable-next-line obsidianmd/ui/sentence-case
						new Notice("CCHub: No active permission request");
					}
				})();
			},
		);

		const cancelRef = workspace.on("cchub:cancel-message" as "quit", () => {
			void handleStopGeneration();
		});

		return () => {
			workspace.offref(approveRef);
			workspace.offref(rejectRef);
			workspace.offref(cancelRef);
		};
	}, [
		plugin.app.workspace,
		permission.approveActivePermission,
		permission.rejectActivePermission,
		handleStopGeneration,
	]);

	// ============================================================
	// Render
	// ============================================================
	return (
		<div className="cchub-chat-view-container">
			<ChatHeader
				agentId={session.agentId}
				agentLabel={activeAgentLabel}
				agentModuleId={activeAgentModuleId}
				availableAgents={availableAgents}
				defaultAgentId={defaultAgentId}
				isSessionReady={isSessionReady}
				onNewChat={(agentId) => void handleNewChat(agentId)}
				onExportChat={() => void handleExportChat()}
				onOpenSettings={handleOpenSettings}
			/>

			<ChatMessages
				messages={messages}
				isSending={isSending}
				isAwaitingResponse={isAwaitingResponse}
				errorInfo={errorInfo}
				plugin={plugin}
				view={view}
				acpClient={acpClientRef.current}
				onApprovePermission={permission.approvePermission}
				onClearError={handleClearError}
			/>

			<ChatInput
				isSending={isSending}
				isSessionReady={isSessionReady}
				agentLabel={activeAgentLabel}
				availableCommands={session.availableCommands || []}
				restoredMessage={restoredMessage}
				mentions={mentions}
				slashCommands={slashCommands}
				plugin={plugin}
				view={view}
				onSendMessage={handleSendMessage}
				onStopGeneration={handleStopGeneration}
				onRestoredMessageConsumed={handleRestoredMessageConsumed}
				modes={session.modes}
				onModeChange={(modeId) => void agentSession.setMode(modeId)}
				models={session.models}
				onModelChange={(modelId) => void agentSession.setModel(modelId)}
				supportsImages={session.promptCapabilities?.image ?? false}
				agentId={session.agentId}
			/>
		</div>
	);
}

export class ChatView extends ItemView {
	private root: Root | null = null;
	private plugin: CCHubPlugin;
	private logger: Logger;

	constructor(leaf: WorkspaceLeaf, plugin: CCHubPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.logger = new Logger(plugin);
	}

	getViewType() {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText() {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		return "CCHub";
	}

	getIcon() {
		return "bot-message-square";
	}

	onOpen() {
		const container = this.containerEl.children[1];
		if (!(container instanceof HTMLElement)) {
			this.logger.warn("[ChatView] Container element not found");
			return Promise.resolve();
		}
		container.empty();

		this.root = createRoot(container);
		this.root.render(<ChatComponent plugin={this.plugin} view={this} />);
		return Promise.resolve();
	}

	onClose(): Promise<void> {
		this.logger.log("[ChatView] onClose() called");
		// Cleanup is handled by React useEffect cleanup in ChatComponent
		// which performs auto-export and closeSession
		if (this.root) {
			this.root.unmount();
			this.root = null;
		}
		return Promise.resolve();
	}
}
