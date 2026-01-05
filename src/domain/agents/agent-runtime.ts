import type { AgentProfile } from "../models/agent-config";
import type { AgentConfig } from "../ports/cchub.port";
import { toAgentConfig } from "../../shared/settings-utils";
import {
	resolveAgentCommand,
	type ResolvedAgentCommand,
} from "./agent-command-resolver";
import {
	FALLBACK_AGENT_MODULE,
	getAgentModuleById,
	type AgentModuleDefinition,
} from "./agent-modules";

export interface ResolvedAgentRuntimeConfig {
	config: AgentConfig;
	module: AgentModuleDefinition;
	command: ResolvedAgentCommand;
}

export function buildAgentRuntimeConfig(
	profile: AgentProfile,
	workingDirectory: string,
): ResolvedAgentRuntimeConfig {
	const module =
		getAgentModuleById(profile.moduleId) || FALLBACK_AGENT_MODULE;
	const command = resolveAgentCommand(profile, module);
	const resolvedProfile: AgentProfile = {
		...profile,
		command: command.command,
		args: command.args,
	};

	const envRecord = buildEnvRecord(resolvedProfile, module);
	const baseConfig = toAgentConfig(
		resolvedProfile,
		workingDirectory,
		module.protocol,
		module.id,
		Object.keys(envRecord).length > 0 ? envRecord : undefined,
	);

	return {
		config: baseConfig,
		module,
		command,
	};
}

function buildEnvRecord(
	profile: AgentProfile,
	module: AgentModuleDefinition,
): Record<string, string> {
	const env: Record<string, string> = {};

	if (module.defaultEnv) {
		for (const entry of module.defaultEnv) {
			env[entry.key] = entry.value;
		}
	}

	for (const entry of profile.env) {
		env[entry.key] = entry.value;
	}

	if (
		module.auth?.type === "apiKey" &&
		profile.auth &&
		typeof profile.auth.apiKey === "string"
	) {
		env[module.auth.envKey] = profile.auth.apiKey;
	}

	return env;
}
