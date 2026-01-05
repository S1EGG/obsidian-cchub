import type { AgentProfile } from "../models/agent-config";
import type { AgentModuleDefinition } from "./agent-modules";
import { CliDetector, type DetectedCliCommand } from "../../shared/cli-detector";

export interface ResolvedAgentCommand {
	command: string;
	args: string[];
	source: "settings" | "detected" | "unresolved";
	detectedFrom?: string;
}

const defaultDetector = new CliDetector();

export function resolveAgentCommand(
	profile: AgentProfile,
	module: AgentModuleDefinition,
	detector: CliDetector = defaultDetector,
): ResolvedAgentCommand {
	let command = profile.command?.trim() || "";
	let args = Array.isArray(profile.args) ? [...profile.args] : [];
	let source: ResolvedAgentCommand["source"] = "settings";
	let detectedFrom: string | undefined;

	if (!command && module.commandCandidates && module.commandCandidates.length) {
		const detected = detector.detect(module.commandCandidates);
		if (detected) {
			command = detected.command;
			detectedFrom = detected.detectedFrom;
			source = "detected";
		} else {
			source = "unresolved";
		}
	}

	if (module.requiredArgs && module.requiredArgs.length > 0) {
		args = mergeArgs(
			args,
			module.requiredArgs,
			module.argsPlacement || "append",
		);
	}

	return {
		command,
		args,
		source,
		detectedFrom,
	};
}

function mergeArgs(
	existing: string[],
	required: string[],
	placement: "prepend" | "append",
): string[] {
	if (placement === "prepend") {
		const filtered = existing.filter((arg) => !required.includes(arg));
		return [...required, ...filtered];
	}

	const merged = [...existing];
	for (const arg of required) {
		if (!merged.includes(arg)) {
			merged.push(arg);
		}
	}
	return merged;
}

export function formatDetectedCommand(
	detected: DetectedCliCommand | null,
): string {
	if (!detected) {
		return "";
	}
	return `${detected.command} (from ${detected.detectedFrom})`;
}
