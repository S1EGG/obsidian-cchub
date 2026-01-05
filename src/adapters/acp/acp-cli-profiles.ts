import type { CCHubPluginSettings } from "../../plugin";

export interface AcpCliProfile {
	agentId: string;
	displayName: string;
	commandCandidates: string[];
	requiredArgs: string[];
}

export function getAcpCliProfiles(
	settings: CCHubPluginSettings,
): AcpCliProfile[] {
	return [
		{
			agentId: settings.claude.id,
			displayName:
				settings.claude.displayName || settings.claude.id,
			commandCandidates: ["claude-code-acp", "claude"],
			requiredArgs: [],
		},
		{
			agentId: settings.codex.id,
			displayName:
				settings.codex.displayName || settings.codex.id,
			commandCandidates: ["codex-acp", "codex"],
			requiredArgs: [],
		},
		{
			agentId: settings.gemini.id,
			displayName:
				settings.gemini.displayName || settings.gemini.id,
			commandCandidates: ["gemini"],
			requiredArgs: ["--experimental-acp"],
		},
	];
}

export function getAcpCliProfileByAgentId(
	settings: CCHubPluginSettings,
	agentId: string,
): AcpCliProfile | null {
	return (
		getAcpCliProfiles(settings).find(
			(profile) => profile.agentId === agentId,
		) || null
	);
}
