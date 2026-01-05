import type {
	AgentAuthSettings,
	AgentEnvVar,
	AgentProfile,
	AgentProtocol,
} from "../domain/models/agent-config";
import type { AgentConfig } from "../domain/ports/cchub.port";

export const sanitizeArgs = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value
			.map((item) => (typeof item === "string" ? item.trim() : ""))
			.filter((item) => item.length > 0);
	}
	if (typeof value === "string") {
		return value
			.split(/\r?\n/)
			.map((item) => item.trim())
			.filter((item) => item.length > 0);
	}
	return [];
};

// Convert stored env structures into a deduplicated list
export const normalizeEnvVars = (value: unknown): AgentEnvVar[] => {
	const pairs: AgentEnvVar[] = [];
	if (!value) {
		return pairs;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			if (entry && typeof entry === "object") {
				// Type guard: check if entry has key and value properties
				const entryObj = entry as Record<string, unknown>;
				const key = "key" in entryObj ? entryObj.key : undefined;
				const val = "value" in entryObj ? entryObj.value : undefined;
				if (typeof key === "string" && key.trim().length > 0) {
					pairs.push({
						key: key.trim(),
						value: typeof val === "string" ? val : "",
					});
				}
			}
		}
	} else if (typeof value === "object") {
		for (const [key, val] of Object.entries(
			value as Record<string, unknown>,
		)) {
			if (typeof key === "string" && key.trim().length > 0) {
				pairs.push({
					key: key.trim(),
					value: typeof val === "string" ? val : "",
				});
			}
		}
	}

	const seen = new Set<string>();
	return pairs.filter((pair) => {
		if (seen.has(pair.key)) {
			return false;
		}
		seen.add(pair.key);
		return true;
	});
};

// Rebuild an agent profile entry with defaults and cleaned values
export const normalizeAgentProfile = (
	agent: Record<string, unknown>,
	fallback: Partial<AgentProfile> = {},
): AgentProfile => {
	const rawId =
		agent && typeof agent.id === "string" && agent.id.trim().length > 0
			? agent.id.trim()
			: fallback.id || "agent";
	const rawDisplayName =
		agent &&
		typeof agent.displayName === "string" &&
		agent.displayName.trim().length > 0
			? agent.displayName.trim()
			: fallback.displayName || rawId;
	const rawModuleId =
		agent &&
		typeof agent.moduleId === "string" &&
		agent.moduleId.trim().length > 0
			? agent.moduleId.trim()
			: fallback.moduleId || "acp:custom";
	const enabled =
		typeof agent.enabled === "boolean"
			? agent.enabled
			: (fallback.enabled ?? true);
	const command =
		agent && typeof agent.command === "string"
			? agent.command.trim()
			: fallback.command || "";
	const args = sanitizeArgs(
		"args" in agent ? agent.args : (fallback.args ?? []),
	);
	const env = normalizeEnvVars(
		"env" in agent
			? agent.env
			: "envVars" in agent
				? agent.envVars
				: fallback.env,
	);
	const rawAuth =
		"auth" in agent && agent.auth && typeof agent.auth === "object"
			? (agent.auth as Record<string, unknown>)
			: {};
	const rawApiKey =
		typeof rawAuth.apiKey === "string"
			? rawAuth.apiKey
			: typeof agent.apiKey === "string"
				? agent.apiKey
				: fallback.auth?.apiKey;
	const shouldKeepAuth =
		"auth" in agent || "apiKey" in agent || fallback.auth !== undefined;
	const auth: AgentAuthSettings | undefined = shouldKeepAuth
		? { apiKey: rawApiKey || "" }
		: undefined;

	return {
		id: rawId,
		displayName: rawDisplayName,
		moduleId: rawModuleId,
		enabled,
		command,
		args,
		env,
		auth,
	};
};

// Ensure agent IDs are unique within the collection
export const ensureUniqueAgentIds = (
	agents: AgentProfile[],
): AgentProfile[] => {
	const seen = new Set<string>();
	return agents.map((agent) => {
		const base =
			agent.id && agent.id.trim().length > 0 ? agent.id.trim() : "agent";
		let candidate = base;
		let suffix = 2;
		while (seen.has(candidate)) {
			candidate = `${base}-${suffix}`;
			suffix += 1;
		}
		seen.add(candidate);
		return { ...agent, id: candidate };
	});
};

/**
 * Convert AgentProfile to AgentConfig for process execution.
 *
 * Transforms the storage format (AgentProfile) to the runtime format (AgentConfig)
 * needed by ICCHubClient.initialize().
 *
 * @param settings - Agent settings from plugin configuration
 * @param workingDirectory - Working directory for the agent session
 * @returns AgentConfig ready for agent process spawning
 */
export const toAgentConfig = (
	settings: AgentProfile,
	workingDirectory: string,
	protocol: AgentProtocol,
	moduleId: string,
	envOverride?: Record<string, string>,
): AgentConfig => {
	// Convert AgentEnvVar[] to Record<string, string> for process.spawn()
	const env = envOverride
		? envOverride
		: settings.env.reduce(
				(acc, { key, value }) => {
					acc[key] = value;
					return acc;
				},
				{} as Record<string, string>,
			);
	const resolvedEnv = Object.keys(env).length > 0 ? env : undefined;

	return {
		id: settings.id,
		displayName: settings.displayName,
		command: settings.command,
		args: settings.args,
		env: resolvedEnv,
		workingDirectory,
		protocol,
		moduleId,
	};
};
