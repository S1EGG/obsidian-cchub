import type {
	AgentConfig,
	IAgentClient,
	InitializeResult,
	NewSessionResult,
} from "../../domain/ports/agent-client.port";
import type { AgentError } from "../../domain/models/agent-error";
import type { PromptContent } from "../../domain/models/prompt-content";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { PermissionOption } from "../../domain/models/chat-message";
import { Platform } from "obsidian";
import { Logger } from "../../shared/logger";
import { resolveCommandDirectory } from "../../shared/path-utils";
import type AgentClientPlugin from "../../plugin";
import { CodexConnection, type CodexEventEnvelope } from "./codex.connection";

interface PermissionRequestEntry {
	requestId: string;
	toolCallId: string;
	callId: string;
	kind: "execute" | "edit";
	options: PermissionOption[];
	sessionId: string;
	changes?: Record<string, unknown>;
}

export class CodexAdapter implements IAgentClient {
	private connection: CodexConnection | null = null;
	private logger: Logger;
	private sessionUpdateCallback: ((update: SessionUpdate) => void) | null =
		null;
	private errorCallback: ((error: AgentError) => void) | null = null;
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;
	private currentSessionId: string | null = null;
	private currentWorkingDirectory: string | null = null;
	private sessionStarted = false;
	private pendingPermissionRequests = new Map<
		string,
		PermissionRequestEntry
	>();
	private pendingPermissionQueue: string[] = [];

	constructor(private plugin: AgentClientPlugin) {
		this.logger = new Logger(plugin);
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		console.log("[CodexAdapter] initialize called with config:", {
			id: config.id,
			command: config.command,
			args: config.args,
			workingDirectory: config.workingDirectory,
		});

		this.currentConfig = config;
		this.isInitializedFlag = false;
		this.currentAgentId = null;

		if (!config.command || config.command.trim().length === 0) {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id}). Please configure the agent command in settings.`,
			);
		}

		this.connection?.stop();
		this.connection = new CodexConnection(this.logger);
		this.connection.onEvent = (event) => this.handleEvent(event);
		this.connection.onError = (error) => this.handleConnectionError(error);

		const baseEnv: NodeJS.ProcessEnv = {
			...process.env,
			...(config.env || {}),
		};
		if (
			this.plugin.settings.nodePath &&
			this.plugin.settings.nodePath.trim().length > 0
		) {
			const nodeDir = resolveCommandDirectory(
				this.plugin.settings.nodePath.trim(),
			);
			if (nodeDir) {
				const separator = Platform.isWin ? ";" : ":";
				baseEnv.PATH = baseEnv.PATH
					? `${nodeDir}${separator}${baseEnv.PATH}`
					: nodeDir;
			}
		}

		await this.connection.start(
			config.command.trim(),
			config.workingDirectory,
			config.args,
			baseEnv,
		);

		// Codex MCP server doesn't support standard MCP initialize/ping methods
		// It only responds to tools/list and tools/call
		// So we skip waitForServerReady and initialize, and go directly to tools/list
		try {
			await this.connection.request("tools/list", {}, 15000);
			console.log("[CodexAdapter] tools/list succeeded");
		} catch (error) {
			console.error("[CodexAdapter] tools/list failed:", error);
			throw error;
		}

		this.isInitializedFlag = true;
		this.currentAgentId = config.id;

		return {
			protocolVersion: 1,
			authMethods: [],
			promptCapabilities: {
				image: false,
				audio: false,
				embeddedContext: false,
			},
		};
	}

	async newSession(workingDirectory: string): Promise<NewSessionResult> {
		if (!this.connection) {
			throw new Error("Codex connection not initialized");
		}

		// Generate session ID but don't start the Codex session yet
		// The actual session will be started when the first prompt is sent
		const sessionId = crypto.randomUUID();
		this.currentSessionId = sessionId;
		this.currentWorkingDirectory = workingDirectory;
		this.sessionStarted = false;

		return { sessionId };
	}

	async authenticate(): Promise<boolean> {
		return true;
	}

	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		if (!this.connection) {
			throw new Error("Codex connection not initialized");
		}

		const promptText = content
			.map((block) =>
				block.type === "text"
					? block.text
					: `[Image omitted: ${block.mimeType}]`,
			)
			.join("\n");

		try {
			// If session hasn't started yet, use "codex" tool to start it with the first prompt
			// Otherwise use "codex-reply" for subsequent messages
			if (!this.sessionStarted) {
				await this.connection.request(
					"tools/call",
					{
						name: "codex",
						arguments: {
							prompt: promptText,
							cwd: this.currentWorkingDirectory,
							sandbox: "workspace-write",
						},
						config: { conversationId: sessionId },
					},
					600000,
				);
				this.sessionStarted = true;
			} else {
				await this.connection.request(
					"tools/call",
					{
						name: "codex-reply",
						arguments: {
							prompt: promptText,
							conversationId: sessionId,
						},
					},
					600000,
				);
			}
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			if (message.includes("timed out")) {
				this.logger.log(
					"[CodexAdapter] Prompt timed out but stream may continue",
				);
				return;
			}
			throw error;
		}
	}

	async cancel(): Promise<void> {
		return;
	}

	async disconnect(): Promise<void> {
		this.connection?.stop();
		this.connection = null;
		this.currentConfig = null;
		this.isInitializedFlag = false;
		this.currentAgentId = null;
		this.currentSessionId = null;
		this.currentWorkingDirectory = null;
		this.sessionStarted = false;
		this.pendingPermissionRequests.clear();
		this.pendingPermissionQueue = [];
	}

	onSessionUpdate(callback: (update: SessionUpdate) => void): void {
		this.sessionUpdateCallback = callback;
	}

	onError(callback: (error: AgentError) => void): void {
		this.errorCallback = callback;
	}

	async respondToPermission(
		requestId: string,
		optionId: string,
	): Promise<void> {
		if (!this.connection) {
			throw new Error("Codex connection not initialized");
		}

		const entry = this.pendingPermissionRequests.get(requestId);
		if (!entry) {
			return;
		}

		const approved = entry.options.some(
			(option) =>
				option.optionId === optionId &&
				(option.kind === "allow_once" ||
					option.kind === "allow_always"),
		);

		if (entry.kind === "edit") {
			await this.connection.request(
				"apply_patch_approval_response",
				{
					call_id: entry.callId,
					approved,
					changes: entry.changes || {},
				},
				60000,
			);
		} else {
			this.connection.respondElicitation(
				entry.callId,
				approved ? "approved" : "denied",
			);
		}

		this.sessionUpdateCallback?.({
			type: "tool_call_update",
			sessionId: entry.sessionId,
			toolCallId: entry.toolCallId,
			status: "completed",
			permissionRequest: {
				requestId: entry.requestId,
				options: entry.options,
				selectedOptionId: optionId,
				isActive: false,
			},
		});

		this.pendingPermissionRequests.delete(requestId);
		this.pendingPermissionQueue = this.pendingPermissionQueue.filter(
			(id) => id !== requestId,
		);
		this.activateNextPermission();
	}

	isInitialized(): boolean {
		return this.isInitializedFlag && this.connection !== null;
	}

	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	async setSessionMode(): Promise<void> {
		throw new Error("Codex does not support session modes");
	}

	async setSessionModel(): Promise<void> {
		throw new Error("Codex does not support session models");
	}

	private handleEvent(event: CodexEventEnvelope): void {
		if (event.method !== "codex/event") {
			return;
		}

		const params = event.params as Record<string, unknown> | null;
		const msg = params?.msg as Record<string, unknown> | undefined;
		if (!msg || typeof msg.type !== "string") {
			return;
		}

		const sessionId =
			(this.currentSessionId as string | null) ||
			this.currentConfig?.id ||
			"codex";

		switch (msg.type) {
			case "agent_message_delta": {
				const text = typeof msg.delta === "string" ? msg.delta : "";
				if (text) {
					this.sessionUpdateCallback?.({
						type: "agent_message_chunk",
						sessionId,
						text,
					});
				}
				break;
			}
			case "agent_message": {
				const text = typeof msg.message === "string" ? msg.message : "";
				if (text) {
					this.sessionUpdateCallback?.({
						type: "agent_message_chunk",
						sessionId,
						text,
					});
				}
				break;
			}
			case "agent_reasoning_delta": {
				const text = typeof msg.delta === "string" ? msg.delta : "";
				if (text) {
					this.sessionUpdateCallback?.({
						type: "agent_thought_chunk",
						sessionId,
						text,
					});
				}
				break;
			}
			case "exec_approval_request":
			case "apply_patch_approval_request": {
				this.handlePermissionRequest(msg, sessionId);
				break;
			}
			case "session_configured": {
				const sessionValue = msg.session_id;
				if (
					typeof sessionValue === "string" ||
					typeof sessionValue === "number"
				) {
					this.currentSessionId = String(sessionValue);
				}
				break;
			}
			default:
				break;
		}
	}

	private handlePermissionRequest(
		msg: Record<string, unknown>,
		sessionId: string,
	): void {
		const callId = typeof msg.call_id === "string" ? msg.call_id : "";
		const requestId = crypto.randomUUID();
		const toolCallId = callId || requestId;
		const isExec = msg.type === "exec_approval_request";
		const options = this.getPermissionOptions();
		const kind: PermissionRequestEntry["kind"] = isExec
			? "execute"
			: "edit";

		const entry: PermissionRequestEntry = {
			requestId,
			toolCallId,
			callId: callId || requestId,
			kind,
			options,
			sessionId,
			changes: this.extractPatchChanges(msg),
		};

		const isActive = this.pendingPermissionQueue.length === 0;
		this.pendingPermissionRequests.set(requestId, entry);
		this.pendingPermissionQueue.push(requestId);

		this.sessionUpdateCallback?.({
			type: "tool_call",
			sessionId,
			toolCallId,
			status: "pending",
			kind: isExec ? "execute" : "edit",
			title: isExec ? "Exec command" : "Apply patch",
			permissionRequest: {
				requestId,
				options,
				isActive,
			},
		});
	}

	private activateNextPermission(): void {
		if (this.pendingPermissionQueue.length === 0) {
			return;
		}
		const nextId = this.pendingPermissionQueue[0];
		if (!nextId) {
			return;
		}
		const entry = this.pendingPermissionRequests.get(nextId);
		if (!entry) {
			return;
		}
		this.sessionUpdateCallback?.({
			type: "tool_call_update",
			sessionId: entry.sessionId,
			toolCallId: entry.toolCallId,
			status: "pending",
			permissionRequest: {
				requestId: entry.requestId,
				options: entry.options,
				isActive: true,
			},
		});
	}

	private getPermissionOptions(): PermissionOption[] {
		return [
			{
				optionId: "allow_once",
				name: "Allow once",
				kind: "allow_once",
			},
			{
				optionId: "reject_once",
				name: "Reject",
				kind: "reject_once",
			},
		];
	}

	private extractPatchChanges(
		msg: Record<string, unknown>,
	): Record<string, unknown> | undefined {
		const changes = msg.changes;
		if (changes && typeof changes === "object") {
			return changes as Record<string, unknown>;
		}
		const codexChanges = msg.codex_changes;
		if (codexChanges && typeof codexChanges === "object") {
			return codexChanges as Record<string, unknown>;
		}
		return undefined;
	}

	private handleConnectionError(error: {
		message: string;
		type?: string;
		details?: unknown;
	}): void {
		const details = error.details as { code?: number | null } | null;
		const exitCode = details?.code;
		let title = "Codex Error";
		let category: AgentError["category"] = "connection";
		let suggestion =
			"Please check Codex CLI authentication and network connectivity.";

		if (exitCode === 127 || error.message.includes("code: 127")) {
			title = "Codex Command Not Found";
			category = "configuration";
			suggestion =
				'Please set the Codex CLI path in settings (use "which codex" or "where codex"), then reload Obsidian.';
		}

		const agentError: AgentError = {
			id: crypto.randomUUID(),
			category,
			severity: "error",
			occurredAt: new Date(),
			agentId: this.currentAgentId || undefined,
			title,
			message: error.message,
			suggestion,
		};
		this.errorCallback?.(agentError);
	}
}
