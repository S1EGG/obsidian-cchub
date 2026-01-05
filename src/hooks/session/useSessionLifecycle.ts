import { useCallback } from "react";
import type {
	ChatSession,
	AuthenticationMethod,
} from "../../domain/models/chat-session";
import type { ICCHubClient } from "../../domain/ports/cchub.port";
import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import {
	getActiveAgentId,
	getCurrentAgent,
	findAgentProfile,
	buildAgentRuntimeConfigFromProfile,
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
	cchubClient: ICCHubClient,
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

		let resolvedRuntime: ReturnType<
			typeof buildAgentRuntimeConfigFromProfile
		> | null = null;

		try {
			// Find agent settings
			const agentSettings = findAgentProfile(settings, activeAgentId);
			console.debug(
				"[useSessionLifecycle] agentSettings:",
				agentSettings,
			);

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
			resolvedRuntime = buildAgentRuntimeConfigFromProfile(
				agentSettings,
				workingDirectory,
			);
			const agentConfig = resolvedRuntime.config;
			console.debug("[useSessionLifecycle] agentConfig:", agentConfig);

			if (!agentConfig.command) {
				onSessionUpdate((prev) => ({ ...prev, state: "error" }));
				onErrorUpdate({
					title: "Agent Command Missing",
					message: `Agent "${agentConfig.displayName}" has no command configured.`,
					suggestion:
						resolvedRuntime?.module.setupHint ||
						"Please configure the agent command in settings.",
				});
				return;
			}

			// Check if initialization is needed
			const isInit = cchubClient.isInitialized();
			const currentAgentId = cchubClient.getCurrentAgentId();
			const needsInitialize = !isInit || currentAgentId !== activeAgentId;
			console.debug("[useSessionLifecycle] needsInitialize check:", {
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
				console.debug("[useSessionLifecycle] Calling initialize...");
				const initResult = await withTimeout(
					cchubClient.initialize(agentConfig),
					getInitializeTimeoutMs(settings, activeAgentId),
					"initialize",
					() => {
						void cchubClient.disconnect();
					},
				);
				console.debug("[useSessionLifecycle] Initialize completed");
				authMethods = initResult.authMethods;
				promptCapabilities = initResult.promptCapabilities;
			}

			// Create new session
			const sessionResult = await withTimeout(
				cchubClient.newSession(workingDirectory),
				getNewSessionTimeoutMs(settings, activeAgentId),
				"newSession",
				() => {
					void cchubClient.disconnect();
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
				const isMcp = resolvedRuntime?.module.protocol === "mcp";
				onErrorUpdate({
					title: isInit
						? "Agent Initialization Timeout"
						: "Session Creation Timeout",
					message: isInit
						? isMcp
							? "The agent did not respond during MCP initialization in time."
							: "The agent did not respond to the ACP handshake in time."
						: "The agent did not respond to session creation in time.",
					suggestion:
						resolvedRuntime?.module.setupHint ||
						"Please confirm the agent command is correct.",
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
		cchubClient,
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
					await cchubClient.cancel(sessionId);
				} catch (error) {
					console.warn("Failed to cancel session:", error);
				}
			}

			// Disconnect from agent
			try {
				await cchubClient.disconnect();
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
		[cchubClient, onSessionUpdate],
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
				await cchubClient.cancel(sessionId);
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
		[cchubClient, onSessionUpdate],
	);

	return {
		createSession,
		restartSession,
		closeSession,
		cancelOperation,
	};
}
