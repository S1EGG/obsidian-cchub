import type { AgentEnvVar, AgentProtocol } from "../models/agent-config";

export type AgentIconId = "claude" | "gemini" | "openai";

export interface AgentAuthSchema {
	type: "apiKey";
	envKey: string;
	label: string;
	description: string;
	placeholder?: string;
}

export interface AgentTimeoutProfile {
	initializeMs?: number;
	newSessionMs?: number;
}

export interface AgentModuleDefinition {
	id: string;
	protocol: AgentProtocol;
	label: string;
	description?: string;
	iconId?: AgentIconId;
	commandCandidates?: string[];
	requiredArgs?: string[];
	argsPlacement?: "prepend" | "append";
	auth?: AgentAuthSchema;
	setupHint?: string;
	timeouts?: AgentTimeoutProfile;
	defaultEnv?: AgentEnvVar[];
}

export const AGENT_MODULES: AgentModuleDefinition[] = [
	{
		id: "acp:claude",
		protocol: "acp",
		label: "Claude Code",
		description: "Claude Code CLI via ACP.",
		iconId: "claude",
		commandCandidates: ["claude-code-acp", "claude"],
		auth: {
			type: "apiKey",
			envKey: "ANTHROPIC_API_KEY",
			label: "API key",
			description:
				"Anthropic API key. Required if not logging in with an Anthropic account.",
			placeholder: "Enter your Anthropic API key",
		},
		setupHint:
			"Claude Code uses claude-code-acp (or claude) as the ACP command.",
	},
	{
		id: "acp:gemini",
		protocol: "acp",
		label: "Gemini CLI",
		description: "Gemini CLI via ACP.",
		iconId: "gemini",
		commandCandidates: ["gemini"],
		requiredArgs: ["--experimental-acp"],
		auth: {
			type: "apiKey",
			envKey: "GOOGLE_API_KEY",
			label: "API key",
			description:
				"Gemini API key. Required if not logging in with a Google account.",
			placeholder: "Enter your Gemini API key",
		},
		setupHint: "Gemini CLI requires --experimental-acp to enable ACP.",
	},
	{
		id: "acp:codex",
		protocol: "acp",
		label: "Codex (ACP)",
		description: "Codex CLI in ACP mode.",
		iconId: "openai",
		commandCandidates: ["codex-acp"],
		auth: {
			type: "apiKey",
			envKey: "OPENAI_API_KEY",
			label: "API key",
			description:
				"OpenAI API key. Required if not logging in with an OpenAI account.",
			placeholder: "Enter your OpenAI API key",
		},
		setupHint: "Codex ACP typically uses the codex-acp binary.",
	},
	{
		id: "mcp:codex",
		protocol: "mcp",
		label: "Codex (MCP)",
		description: "Codex CLI MCP server.",
		iconId: "openai",
		commandCandidates: ["codex"],
		auth: {
			type: "apiKey",
			envKey: "OPENAI_API_KEY",
			label: "API key",
			description:
				"OpenAI API key. Required if not logging in with an OpenAI account.",
			placeholder: "Enter your OpenAI API key",
		},
		timeouts: {
			initializeMs: 60000,
			newSessionMs: 120000,
		},
		setupHint: "Codex MCP uses the codex command.",
	},
	{
		id: "acp:qwen",
		protocol: "acp",
		label: "Qwen Code",
		description: "Qwen Code CLI via ACP.",
		commandCandidates: ["qwen"],
		requiredArgs: ["--experimental-acp"],
		setupHint:
			"Qwen Code typically needs --experimental-acp to enable ACP.",
	},
	{
		id: "acp:iflow",
		protocol: "acp",
		label: "iFlow CLI",
		description: "iFlow CLI via ACP.",
		commandCandidates: ["iflow"],
		requiredArgs: ["--experimental-acp"],
	},
	{
		id: "acp:goose",
		protocol: "acp",
		label: "Goose",
		description: "Goose CLI (acp subcommand).",
		commandCandidates: ["goose"],
		requiredArgs: ["acp"],
		argsPlacement: "prepend",
		setupHint: "Goose starts via the goose acp subcommand.",
	},
	{
		id: "acp:auggie",
		protocol: "acp",
		label: "Augment Code",
		description: "Augment Code CLI.",
		commandCandidates: ["auggie"],
		requiredArgs: ["--acp"],
		setupHint: "Augment Code starts with --acp.",
	},
	{
		id: "acp:kimi",
		protocol: "acp",
		label: "Kimi CLI",
		description: "Kimi CLI via ACP.",
		commandCandidates: ["kimi"],
		requiredArgs: ["--acp"],
	},
	{
		id: "acp:opencode",
		protocol: "acp",
		label: "OpenCode",
		description: "OpenCode CLI (acp subcommand).",
		commandCandidates: ["opencode"],
		requiredArgs: ["acp"],
		argsPlacement: "prepend",
	},
	{
		id: "acp:custom",
		protocol: "acp",
		label: "Custom ACP",
		description: "User-configured ACP agent.",
		setupHint: "Provide a command path or executable name.",
	},
];

export const FALLBACK_AGENT_MODULE: AgentModuleDefinition = {
	id: "acp:custom",
	protocol: "acp",
	label: "Custom ACP",
	description: "User-configured ACP agent.",
};

export function listAgentModules(): AgentModuleDefinition[] {
	return [...AGENT_MODULES];
}

export function getAgentModuleById(id: string): AgentModuleDefinition | null {
	return AGENT_MODULES.find((module) => module.id === id) || null;
}
