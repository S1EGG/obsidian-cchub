import { useState, useCallback, useEffect } from "react";
import type {
	ChatSession,
	SessionState,
	SlashCommand,
} from "../domain/models/chat-session";
import type { ICCHubClient } from "../domain/ports/cchub.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import {
	useSessionLifecycle,
	type SessionErrorInfo,
} from "./useSessionLifecycle";
import { useSessionMode } from "./useSessionMode";
import {
	getActiveAgentId,
	getCurrentAgent,
	type AgentInfo,
} from "./session-helpers";

// ============================================================================
// Types
// ============================================================================

/**
 * Return type for useAgentSession hook.
 */
export interface UseAgentSessionReturn {
	/** Current session state */
	session: ChatSession;
	/** Whether the session is ready for user input */
	isReady: boolean;
	/** Error information if session operation failed */
	errorInfo: SessionErrorInfo | null;
	/** Clear the current session error */
	clearError: () => void;

	/** Create a new session (optionally overriding the agent) */
	createSession: (agentIdOverride?: string) => Promise<void>;
	/** Restart the current session */
	restartSession: (agentIdOverride?: string) => Promise<void>;
	/** Close the current session and disconnect from agent */
	closeSession: () => Promise<void>;
	/** Cancel the current agent operation */
	cancelOperation: () => Promise<void>;
	/** Switch to a different agent */
	switchAgent: (agentId: string) => Promise<void>;
	/** Get list of available agents */
	getAvailableAgents: () => AgentInfo[];
	/** Update available slash commands */
	updateAvailableCommands: (commands: SlashCommand[]) => void;
	/** Update current mode */
	updateCurrentMode: (modeId: string) => void;
	/** Set the session mode */
	setMode: (modeId: string) => Promise<void>;
	/** Set the session model */
	setModel: (modelId: string) => Promise<void>;
}

// Re-export types for consumers
export type { AgentInfo, SessionErrorInfo };

// ============================================================================
// Initial State
// ============================================================================

/**
 * Create initial session state.
 */
function createInitialSession(
	agentId: string,
	agentDisplayName: string,
	workingDirectory: string,
): ChatSession {
	return {
		sessionId: null,
		state: "disconnected" as SessionState,
		agentId,
		agentDisplayName,
		authMethods: [],
		availableCommands: undefined,
		modes: undefined,
		models: undefined,
		createdAt: new Date(),
		lastActivityAt: new Date(),
		workingDirectory,
	};
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing agent session lifecycle.
 *
 * Handles session creation, restart, cancellation, and agent switching.
 * This hook owns the session state independently.
 *
 * @param cchubClient - Agent client for communication
 * @param settingsAccess - Settings access for agent configuration
 * @param workingDirectory - Working directory for the session
 */
export function useAgentSession(
	cchubClient: ICCHubClient,
	settingsAccess: ISettingsAccess,
	workingDirectory: string,
): UseAgentSessionReturn {
	// Get initial agent info from settings
	const initialSettings = settingsAccess.getSnapshot();
	const initialAgentId = getActiveAgentId(initialSettings);
	const initialAgent = getCurrentAgent(initialSettings);

	// Session state
	const [session, setSession] = useState<ChatSession>(() =>
		createInitialSession(
			initialAgentId,
			initialAgent.displayName,
			workingDirectory,
		),
	);

	// Error state
	const [errorInfo, setErrorInfo] = useState<SessionErrorInfo | null>(null);

	// Derived state
	const isReady = session.state === "ready";

	// State update callbacks
	const onSessionUpdate = useCallback(
		(updater: (prev: ChatSession) => ChatSession) => {
			setSession(updater);
		},
		[],
	);

	const onErrorUpdate = useCallback((error: SessionErrorInfo | null) => {
		setErrorInfo(error);
	}, []);

	const clearError = useCallback(() => {
		setErrorInfo(null);
	}, []);

	// Use lifecycle hook
	const {
		createSession,
		restartSession,
		closeSession: closeSessionBase,
		cancelOperation: cancelOperationBase,
	} = useSessionLifecycle(cchubClient, settingsAccess, workingDirectory, {
		onSessionUpdate,
		onErrorUpdate,
	});

	// Use mode management hook
	const {
		setMode: setModeBase,
		setModel: setModelBase,
		switchAgent,
		getAvailableAgents,
		updateAvailableCommands,
		updateCurrentMode,
	} = useSessionMode(cchubClient, settingsAccess, {
		onSessionUpdate,
	});

	// Wrap lifecycle methods with session context
	const closeSession = useCallback(async () => {
		await closeSessionBase(session.sessionId);
	}, [closeSessionBase, session.sessionId]);

	const cancelOperation = useCallback(async () => {
		await cancelOperationBase(session.sessionId);
	}, [cancelOperationBase, session.sessionId]);

	// Wrap mode methods with session context
	const setMode = useCallback(
		async (modeId: string) => {
			await setModeBase(
				session.sessionId,
				session.modes?.currentModeId,
				modeId,
			);
		},
		[setModeBase, session.sessionId, session.modes?.currentModeId],
	);

	const setModel = useCallback(
		async (modelId: string) => {
			await setModelBase(
				session.sessionId,
				session.models?.currentModelId,
				modelId,
			);
		},
		[setModelBase, session.sessionId, session.models?.currentModelId],
	);

	// Register error callback for process-level errors
	useEffect(() => {
		cchubClient.onError((error) => {
			setSession((prev) => ({ ...prev, state: "error" }));
			setErrorInfo({
				title: error.title || "Agent Error",
				message: error.message || "An error occurred",
				suggestion: error.suggestion,
			});
		});
	}, [cchubClient]);

	return {
		session,
		isReady,
		errorInfo,
		clearError,
		createSession,
		restartSession,
		closeSession,
		cancelOperation,
		switchAgent,
		getAvailableAgents,
		updateAvailableCommands,
		updateCurrentMode,
		setMode,
		setModel,
	};
}
