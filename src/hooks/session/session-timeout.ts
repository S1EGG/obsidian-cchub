import type { AgentClientPluginSettings } from "../../plugin";

/**
 * Timeout error for session operations.
 */
export class TimeoutError extends Error {
	step: "initialize" | "newSession";

	constructor(step: "initialize" | "newSession", message: string) {
		super(message);
		this.name = "TimeoutError";
		this.step = step;
	}
}

const INITIALIZE_TIMEOUT_MS = 20000;
const NEW_SESSION_TIMEOUT_MS = 10000;

/**
 * Get initialization timeout for a specific agent.
 */
export function getInitializeTimeoutMs(
	settings: AgentClientPluginSettings,
	agentId: string,
): number {
	if (agentId === settings.codex.id) {
		return 60000; // Codex needs more time
	}
	return INITIALIZE_TIMEOUT_MS;
}

/**
 * Get new session timeout for a specific agent.
 */
export function getNewSessionTimeoutMs(
	settings: AgentClientPluginSettings,
	agentId: string,
): number {
	if (agentId === settings.codex.id) {
		return 120000; // Codex needs much more time for MCP server startup and session creation
	}
	return NEW_SESSION_TIMEOUT_MS;
}

/**
 * Execute a promise with a timeout.
 *
 * @param promise - Promise to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param step - Step name for error message
 * @param onTimeout - Optional callback to execute on timeout
 * @returns Promise result or throws TimeoutError
 */
export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	step: "initialize" | "newSession",
	onTimeout?: () => void,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	const timeoutPromise = new Promise<T>((_resolve, reject) => {
		timeoutId = setTimeout(() => {
			if (onTimeout) {
				onTimeout();
			}
			reject(
				new TimeoutError(
					step,
					`Operation timed out after ${timeoutMs}ms`,
				),
			);
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
		}
	}
}
