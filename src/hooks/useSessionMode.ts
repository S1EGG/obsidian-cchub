import { useCallback } from "react";
import type { ChatSession, SlashCommand } from "../domain/models/chat-session";
import type { ICCHubClient } from "../domain/ports/cchub.port";
import type { ISettingsAccess } from "../domain/ports/settings-access.port";
import { getAvailableAgentsFromSettings } from "./session-helpers";
import type { AgentInfo } from "./session-helpers";

/**
 * Mode and model management callbacks.
 */
interface ModeCallbacks {
	onSessionUpdate: (updater: (prev: ChatSession) => ChatSession) => void;
}

/**
 * Hook for managing session modes and models.
 *
 * Handles:
 * - Mode switching
 * - Model switching
 * - Agent switching
 * - Available commands updates
 */
export function useSessionMode(
	cchubClient: ICCHubClient,
	settingsAccess: ISettingsAccess,
	callbacks: ModeCallbacks,
) {
	const { onSessionUpdate } = callbacks;

	/**
	 * Set the session mode.
	 */
	const setMode = useCallback(
		async (
			sessionId: string | null,
			currentModeId: string | undefined,
			modeId: string,
		) => {
			if (!sessionId) {
				console.warn("Cannot set mode: no active session");
				return;
			}

			const previousModeId = currentModeId;

			// Optimistic update
			onSessionUpdate((prev) => {
				if (!prev.modes) return prev;
				return {
					...prev,
					modes: {
						...prev.modes,
						currentModeId: modeId,
					},
				};
			});

			try {
				await cchubClient.setSessionMode(sessionId, modeId);
			} catch (error) {
				console.error("Failed to set mode:", error);
				// Rollback on error
				if (previousModeId) {
					onSessionUpdate((prev) => {
						if (!prev.modes) return prev;
						return {
							...prev,
							modes: {
								...prev.modes,
								currentModeId: previousModeId,
							},
						};
					});
				}
			}
		},
		[cchubClient, onSessionUpdate],
	);

	/**
	 * Set the session model.
	 */
	const setModel = useCallback(
		async (
			sessionId: string | null,
			currentModelId: string | undefined,
			modelId: string,
		) => {
			if (!sessionId) {
				console.warn("Cannot set model: no active session");
				return;
			}

			const previousModelId = currentModelId;

			// Optimistic update
			onSessionUpdate((prev) => {
				if (!prev.models) return prev;
				return {
					...prev,
					models: {
						...prev.models,
						currentModelId: modelId,
					},
				};
			});

			try {
				await cchubClient.setSessionModel(sessionId, modelId);
			} catch (error) {
				console.error("Failed to set model:", error);
				// Rollback on error
				if (previousModelId) {
					onSessionUpdate((prev) => {
						if (!prev.models) return prev;
						return {
							...prev,
							models: {
								...prev.models,
								currentModelId: previousModelId,
							},
						};
					});
				}
			}
		},
		[cchubClient, onSessionUpdate],
	);

	/**
	 * Switch to a different agent.
	 */
	const switchAgent = useCallback(
		async (agentId: string) => {
			// Update settings
			await settingsAccess.updateSettings({ activeAgentId: agentId });

			// Update session state
			onSessionUpdate((prev) => ({
				...prev,
				agentId,
				availableCommands: undefined,
				modes: undefined,
				models: undefined,
			}));
		},
		[settingsAccess, onSessionUpdate],
	);

	/**
	 * Get list of available agents.
	 */
	const getAvailableAgents = useCallback((): AgentInfo[] => {
		const settings = settingsAccess.getSnapshot();
		return getAvailableAgentsFromSettings(settings);
	}, [settingsAccess]);

	/**
	 * Update available slash commands.
	 */
	const updateAvailableCommands = useCallback(
		(commands: SlashCommand[]) => {
			onSessionUpdate((prev) => ({
				...prev,
				availableCommands: commands,
			}));
		},
		[onSessionUpdate],
	);

	/**
	 * Update current mode.
	 */
	const updateCurrentMode = useCallback(
		(modeId: string) => {
			onSessionUpdate((prev) => {
				if (!prev.modes) {
					return prev;
				}
				return {
					...prev,
					modes: {
						...prev.modes,
						currentModeId: modeId,
					},
				};
			});
		},
		[onSessionUpdate],
	);

	return {
		setMode,
		setModel,
		switchAgent,
		getAvailableAgents,
		updateAvailableCommands,
		updateCurrentMode,
	};
}
