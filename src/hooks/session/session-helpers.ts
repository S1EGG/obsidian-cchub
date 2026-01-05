import type { CCHubPluginSettings } from "../../plugin";
import type {
	BaseAgentSettings,
	ClaudeAgentSettings,
	CodexAgentSettings,
	GeminiAgentSettings,
} from "../../domain/models/agent-config";
import type { AgentConfig } from "../../domain/ports/cchub.port";
import { toAgentConfig } from "../../shared/settings-utils";
import { resolveAcpAgentCommand } from "../../adapters/acp/acp-command-resolver";

/**
 * Agent information for display.
 */
export interface AgentInfo {
	id: string;
	displayName: string;
}

/**
 * Get the currently active agent ID from settings.
 */
export function getActiveAgentId(settings: CCHubPluginSettings): string {
	return settings.activeAgentId || settings.claude.id;
}

/**
 * Get list of all available agents from settings.
 */
export function getAvailableAgentsFromSettings(
	settings: CCHubPluginSettings,
): AgentInfo[] {
	return [
		{
			id: settings.claude.id,
			displayName: settings.claude.displayName || settings.claude.id,
		},
		{
			id: settings.codex.id,
			displayName: settings.codex.displayName || settings.codex.id,
		},
		{
			id: settings.gemini.id,
			displayName: settings.gemini.displayName || settings.gemini.id,
		},
		...settings.customAgents.map((agent) => ({
			id: agent.id,
			displayName: agent.displayName || agent.id,
		})),
	];
}

/**
 * Get the currently active agent information from settings.
 */
export function getCurrentAgent(
	settings: CCHubPluginSettings,
): AgentInfo {
	const activeId = getActiveAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
		}
	);
}

/**
 * Find agent settings by ID from plugin settings.
 */
export function findAgentSettings(
	settings: CCHubPluginSettings,
	agentId: string,
): BaseAgentSettings | null {
	if (agentId === settings.claude.id) {
		return settings.claude;
	}
	if (agentId === settings.codex.id) {
		return settings.codex;
	}
	if (agentId === settings.gemini.id) {
		return settings.gemini;
	}
	// Search in custom agents
	const customAgent = settings.customAgents.find(
		(agent) => agent.id === agentId,
	);
	return customAgent || null;
}

/**
 * Build AgentConfig with API key injection for known agents.
 */
export function buildAgentConfigWithApiKey(
	settings: CCHubPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	workingDirectory: string,
): AgentConfig {
	const resolvedCommand = resolveAcpAgentCommand(
		settings,
		agentSettings,
		agentId,
	);
	const normalizedSettings: BaseAgentSettings = {
		...agentSettings,
		command: resolvedCommand.command,
		args: resolvedCommand.args,
	};
	const baseConfig = toAgentConfig(normalizedSettings, workingDirectory);

	// Add API keys to environment for Claude, Codex, and Gemini
	if (agentId === settings.claude.id) {
		const claudeSettings = agentSettings as ClaudeAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				ANTHROPIC_API_KEY: claudeSettings.apiKey,
			},
		};
	}
	if (agentId === settings.codex.id) {
		const codexSettings = agentSettings as CodexAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				OPENAI_API_KEY: codexSettings.apiKey,
			},
		};
	}
	if (agentId === settings.gemini.id) {
		const geminiSettings = agentSettings as GeminiAgentSettings;
		return {
			...baseConfig,
			env: {
				...baseConfig.env,
				GOOGLE_API_KEY: geminiSettings.apiKey,
			},
		};
	}

	// Custom agents - no API key injection
	return baseConfig;
}
