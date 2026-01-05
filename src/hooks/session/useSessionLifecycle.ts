import { useCallback } from "react";
import type {
	ChatSession,
	AuthenticationMethod,
} from "../../domain/models/chat-session";
import type { IAgentClient } from "../../domain/ports/agent-client.port";
import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import {
	getActiveAgentId,
	getCurrentAgent,
	findAgentSettings,
	buildAgentConfigWithApiKey,
} from "./session-helpers";
import {
	TimeoutError,
	getInitializeTimeoutMs,
	getNewSessionTimeoutMs,
	withTimeout,
} from "./session-timeout";

/**
 * Error information for session operations.
 */
export interface SessionErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
}

/**
 * Lifecycle operation callbacks.
 */
interface LifecycleCallbacks {
	onSessionUpdate: (updater: (prev: ChatSession) => ChatSession) => void;
	onErrorUpdate: (error: SessionErrorInfo | null) => void;
}

/**
 * Hook for managing session lifecycle operations.
 *
 * Handles:
 * - Session creation (initialization + new session)
 * - Session restart
 * - Session close
 * - Operation cancellation
 */
export function useSessionLifecycle(
	agentClient: IAgentClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
	callbacks: LifecycleCallbacks,
) {
	const { onSessionUpdate, onErrorUpdate } = callbacks;

	/**
	 * Create a new session with the active agent.
	 */
	const createSession = useCallback(async () => {
		const settings = settingsAccess.getSnapshot();
		const activeAgentId = getActiveAgentId(settings);
		const currentAgent = getCurrentAgent(settings);

		// Reset to initializing state
		onSessionUpdate((prev) => ({
			...prev,
			sessionId: null,
			state: "initializing",
			agentId: activeAgentId,
			agentDisplayName: currentAgent.displayName,
			authMethods: [],
			availableCommands: undefined,
			modes: undefined,
			models: undefined,
			promptCapabilities: prev.promptCapabilities,
			createdAt: new Date(),
			lastActivityAt: new Date(),
		}));
		onErrorUpdate(null);

		try {
			// Find agent settings
			const agentSettings = findAgentSettings(settings, activeAgentId);
			console.log("[useSessionLifecycle] agentSettings:", agentSettings);

			if (!agentSettings) {
				onSessionUpdate((prev) => ({ ...prev, state: "error" }));
				onErrorUpdate({
					title: "Agent Not Found",
					message: `Agent with ID "${activeAgentId}" not found in settings`,
					suggestion:
						"Please check your agent configuration in settings.",
				});
				return;
			}

			// Build agent configuration
			const agentConfig = buildAgentConfigWithApiKey(
				settings,
				agentSettings,
				activeAgentId,
				workingDirectory,
			);
			console.log("[useSessionLifecycle] agentConfig:", agentConfig);

			// Check if initialization is needed
			const isInit = agentClient.isInitialized();
			const currentAgentId = agentClient.getCurrentAgentId();
			const needsInitialize = !isInit || currentAgentId !== activeAgentId;
			console.log("[useSessionLifecycle] needsInitialize check:", {
				isInit,
				currentAgentId,
				activeAgentId,
				needsInitialize,
			});

			let authMethods: AuthenticationMethod[] = [];
			let promptCapabilities:
				| {
						image?: boolean;
						audio?: boolean;
						embeddedContext?: boolean;
				  }
				| undefined;

			// Initialize if needed
			if (needsInitialize) {
				console.log("[useSessionLifecycle] Calling initialize...");
				const initResult = await withTimeout(
					agentClient.initialize(agentConfig),
					getInitializeTimeoutMs(settings, activeAgentId),
					"initialize",
					() => {
						void agentClient.disconnect();
					},
				);
				console.log("[useSessionLifecycle] Initialize completed");
				authMethods = initResult.authMethods;
				promptCapabilities = initResult.promptCapabilities;
			}

			// Create new session
			const sessionResult = await withTimeout(
				agentClient.newSession(workingDirectory),
				getNewSessionTimeoutMs(settings, activeAgentId),
				"newSession",
				() => {
					void agentClient.disconnect();
				},
			);

			// Success - update to ready state
			onSessionUpdate((prev) => ({
				...prev,
				sessionId: sessionResult.sessionId,
				state: "ready",
				authMethods: authMethods,
				modes: sessionResult.modes,
				models: sessionResult.models,
				promptCapabilities: needsInitialize
					? promptCapabilities
					: prev.promptCapabilities,
				lastActivityAt: new Date(),
			}));
		} catch (error) {
			// Error - update to error state
			console.error("[useSessionLifecycle] Error caught:", error);
			onSessionUpdate((prev) => ({ ...prev, state: "error" }));

			if (error instanceof TimeoutError) {
				const isInit = error.step === "initialize";
				const isCodex = activeAgentId === settings.codex.id;
				onErrorUpdate({
					title: isInit
						? "Agent Initialization Timeout"
						: "Session Creation Timeout",
					message: isInit
						? isCodex
							? "Codex did not respond during MCP initialization in time."
							: "The agent did not respond to the ACP handshake in time."
						: "The agent did not respond to session creation in time.",
					suggestion:
						"Please confirm the agent command is correct: Claude Code uses codex-acp/claude-code-acp, Gemini needs --experimental-acp, and Codex CLI should be the codex binary (MCP).",
				});
				return;
			}

			onErrorUpdate({
				title: "Session Creation Failed",
				message: `Failed to create new session: ${error instanceof Error ? error.message : String(error)}`,
				suggestion:
					"Please check the agent configuration and try again.",
			});
		}
	}, [
		agentClient,
		settingsAccess,
		workingDirectory,
		onSessionUpdate,
		onErrorUpdate,
	]);

	/**
	 * Restart the current session.
	 */
	const restartSession = useCallback(async () => {
		await createSession();
	}, [createSession]);

	/**
	 * Close the current session and disconnect.
	 */
	const closeSession = useCallback(
		async (sessionId: string | null) => {
			// Cancel current session if active
			if (sessionId) {
				try {
					await agentClient.cancel(sessionId);
				} catch (error) {
					console.warn("Failed to cancel session:", error);
				}
			}

			// Disconnect from agent
			try {
				await agentClient.disconnect();
			} catch (error) {
				console.warn("Failed to disconnect:", error);
			}

			// Update to disconnected state
			onSessionUpdate((prev) => ({
				...prev,
				sessionId: null,
				state: "disconnected",
			}));
		},
		[agentClient, onSessionUpdate],
	);

	/**
	 * Cancel the current operation.
	 */
	const cancelOperation = useCallback(
		async (sessionId: string | null) => {
			if (!sessionId) {
				return;
			}

			try {
				await agentClient.cancel(sessionId);
				onSessionUpdate((prev) => ({
					...prev,
					state: "ready",
				}));
			} catch (error) {
				console.warn("Failed to cancel operation:", error);
				// Still update to ready state
				onSessionUpdate((prev) => ({
					...prev,
					state: "ready",
				}));
			}
		},
		[agentClient, onSessionUpdate],
	);

	return {
		createSession,
		restartSession,
		closeSession,
		cancelOperation,
	};
}
