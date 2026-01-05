/**
 * Domain Models for Agent Configuration
 *
 * These types represent agent settings and configuration,
 * independent of the plugin infrastructure. They define
 * the core concepts of agent identity, capabilities, and
 * connection parameters.
 */

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variable for agent process.
 *
 * Used to pass configuration and credentials to agent processes
 * via environment variables (e.g., API keys, paths, feature flags).
 */
export interface AgentEnvVar {
	/** Environment variable name (e.g., "ANTHROPIC_API_KEY") */
	key: string;

	/** Environment variable value */
	value: string;
}

// ============================================================================
// Agent Configuration
// ============================================================================

/**
 * Agent protocol used by the runtime.
 */
export type AgentProtocol = "acp" | "mcp";

/**
 * Authentication configuration for an agent profile.
 */
export interface AgentAuthSettings {
	/** API key used by modules that require it */
	apiKey?: string;
}

/**
 * Persisted agent profile stored in settings.
 *
 * Each profile references a module definition and carries the
 * user-configurable values (command, args, env, auth).
 */
export interface AgentProfile {
	/** Unique identifier for this agent instance */
	id: string;

	/** Human-readable display name shown in UI */
	displayName: string;

	/** Module identifier (e.g., "acp:claude", "mcp:codex") */
	moduleId: string;

	/** Whether the agent is available for selection */
	enabled: boolean;

	/** Command to execute (full path to executable or command name) */
	command: string;

	/** Command-line arguments passed to the agent */
	args: string[];

	/** Environment variables for the agent process */
	env: AgentEnvVar[];

	/** Optional auth settings (e.g., API keys) */
	auth?: AgentAuthSettings;
}
