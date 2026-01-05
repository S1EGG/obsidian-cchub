import type { CCHubPluginSettings } from "../plugin";
import type { AgentProfile } from "../domain/models/agent-config";
import {
	buildAgentRuntimeConfig,
	type ResolvedAgentRuntimeConfig,
} from "../domain/agents/agent-runtime";

/**
 * Agent information for display.
 */
export interface AgentInfo {
	id: string;
	displayName: string;
	moduleId: string;
}

/**
 * Get the currently active agent ID from settings.
 */
export function getActiveAgentId(settings: CCHubPluginSettings): string {
	return settings.activeAgentId || settings.agents[0]?.id || "";
}

/**
 * Get list of all available agents from settings.
 */
export function getAvailableAgentsFromSettings(
	settings: CCHubPluginSettings,
): AgentInfo[] {
	const enabled = settings.agents.filter((agent) => agent.enabled);
	const source = enabled.length > 0 ? enabled : settings.agents;
	return source.map((agent) => ({
		id: agent.id,
		displayName: agent.displayName || agent.id,
		moduleId: agent.moduleId,
	}));
}

/**
 * Get the currently active agent information from settings.
 */
export function getCurrentAgent(settings: CCHubPluginSettings): AgentInfo {
	const activeId = getActiveAgentId(settings);
	const agents = getAvailableAgentsFromSettings(settings);
	return (
		agents.find((agent) => agent.id === activeId) || {
			id: activeId,
			displayName: activeId,
			moduleId: "",
		}
	);
}

/**
 * Find agent settings by ID from plugin settings.
 */
export function findAgentProfile(
	settings: CCHubPluginSettings,
	agentId: string,
): AgentProfile | null {
	return settings.agents.find((agent) => agent.id === agentId) || null;
}

/**
 * Build AgentConfig from profile with module resolution applied.
 */
export function buildAgentRuntimeConfigFromProfile(
	profile: AgentProfile,
	workingDirectory: string,
): ResolvedAgentRuntimeConfig {
	return buildAgentRuntimeConfig(profile, workingDirectory);
}

export function getAgentDisplayName(
	settings: CCHubPluginSettings,
	agentId: string,
): string {
	const agent = findAgentProfile(settings, agentId);
	return agent?.displayName || agent?.id || agentId;
}

export function getAgentModuleId(
	settings: CCHubPluginSettings,
	agentId: string,
): string {
	const agent = findAgentProfile(settings, agentId);
	return agent?.moduleId || "";
}
