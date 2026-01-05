import type { CCHubPluginSettings } from "../../plugin";
import type { BaseAgentSettings } from "../../domain/models/agent-config";
import {
	getAcpCliProfileByAgentId,
} from "./acp-cli-profiles";
import { AcpCliDetector } from "./acp-cli-detector";

export interface ResolvedAcpCommand {
	command: string;
	args: string[];
	source: "settings" | "detected" | "unresolved";
	detectedFrom?: string;
}

const defaultDetector = new AcpCliDetector();

export function resolveAcpAgentCommand(
	settings: CCHubPluginSettings,
	agentSettings: BaseAgentSettings,
	agentId: string,
	detector: AcpCliDetector = defaultDetector,
): ResolvedAcpCommand {
	const profile = getAcpCliProfileByAgentId(settings, agentId);
	let command = agentSettings.command?.trim() || "";
	let args = Array.isArray(agentSettings.args)
		? [...agentSettings.args]
		: [];
	let source: ResolvedAcpCommand["source"] = "settings";
	let detectedFrom: string | undefined;

	if (!command && profile) {
		const detected = detector.detect(profile);
		if (detected) {
			command = detected.command;
			detectedFrom = detected.detectedFrom;
			source = "detected";
		} else {
			source = "unresolved";
		}
	}

	if (profile && profile.requiredArgs.length > 0) {
		args = mergeArgs(args, profile.requiredArgs);
	}

	return {
		command,
		args,
		source,
		detectedFrom,
	};
}

function mergeArgs(existing: string[], required: string[]): string[] {
	const merged = [...existing];
	for (const arg of required) {
		if (!merged.includes(arg)) {
			merged.push(arg);
		}
	}
	return merged;
}
