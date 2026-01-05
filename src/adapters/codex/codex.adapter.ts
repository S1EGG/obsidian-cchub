import type {
	AgentConfig,
	ICCHubClient,
	InitializeResult,
	NewSessionResult,
} from "../../domain/ports/cchub.port";
import type { AgentError } from "../../domain/models/agent-error";
import type { PromptContent } from "../../domain/models/prompt-content";
import type { SessionUpdate } from "../../domain/models/session-update";
import type {
	PermissionOption,
	ToolKind,
} from "../../domain/models/chat-message";
import { Platform } from "obsidian";
import { Logger } from "../../shared/logger";
import { resolveCommandDirectory } from "../../shared/path-utils";
import type CCHubPlugin from "../../plugin";
import { CodexConnection, type CodexEventEnvelope } from "./codex.connection";

interface PermissionRequestEntry {
	requestId: string;
	toolCallId: string;
	callId: string;
	kind: "execute" | "apply_patch" | "generic";
	options: PermissionOption[];
	sessionId: string;
	changes?: Record<string, unknown>;
}

export class CodexAdapter implements ICCHubClient {
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

	constructor(private plugin: CCHubPlugin) {
		this.logger = new Logger(plugin);
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		console.debug("[CodexAdapter] initialize called with config:", {
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
			console.debug("[CodexAdapter] tools/list succeeded");
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

		const selectedOption = entry.options.find(
			(option) => option.optionId === optionId,
		);
		const approved =
			selectedOption?.kind === "allow_once" ||
			selectedOption?.kind === "allow_always";

		if (entry.kind === "apply_patch") {
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
			const decision = approved
				? selectedOption?.kind === "allow_always"
					? "approved_for_session"
					: "approved"
				: "denied";
			this.connection.respondElicitation(entry.callId, decision);
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
		if (event.method.endsWith("elicitation/create")) {
			const params = event.params as Record<string, unknown> | null;
			if (params) {
				this.handleElicitationCreate(params, event.id);
			}
			return;
		}

		if (event.method !== "codex/event") {
			const params = event.params as Record<string, unknown> | null;
			if (params && this.hasPermissionOptions(params)) {
				this.handleElicitationCreate(params, event.id);
			}
			return;
		}

		const params = event.params as Record<string, unknown> | null;
		const msg = params?.msg as Record<string, unknown> | undefined;
		if (!msg || typeof msg.type !== "string") {
			return;
		}

		const sessionId =
			this.currentSessionId || this.currentConfig?.id || "codex";

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
				if (
					msg.type &&
					typeof msg.type === "string" &&
					msg.type.endsWith("_approval_request")
				) {
					this.handlePermissionRequest(msg, sessionId);
				} else if (
					msg.type &&
					typeof msg.type === "string" &&
					this.isPermissionRequestType(msg.type) &&
					this.hasPermissionOptions(msg)
				) {
					this.handlePermissionRequest(msg, sessionId);
				}
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
		if (
			callId &&
			Array.from(this.pendingPermissionRequests.values()).some(
				(entry) => entry.toolCallId === toolCallId,
			)
		) {
			return;
		}
		const msgType = typeof msg.type === "string" ? msg.type : "";
		const isExec = msgType === "exec_approval_request";
		const isApplyPatch = msgType === "apply_patch_approval_request";
		const options = this.normalizePermissionOptions(msg.options);
		const kind: PermissionRequestEntry["kind"] = isApplyPatch
			? "apply_patch"
			: isExec
				? "execute"
				: "generic";
		const title = this.getPermissionTitle(msg, msgType);
		const toolKind = this.inferToolKind(msgType, msg);

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
			kind: toolKind,
			title,
			permissionRequest: {
				requestId,
				options,
				isActive,
			},
		});
	}

	private handleElicitationCreate(
		params: Record<string, unknown>,
		rpcId?: number,
	): void {
		const sessionId =
			this.currentSessionId || this.currentConfig?.id || "codex";
		const callId =
			(typeof params.codex_call_id === "string" &&
				params.codex_call_id) ||
			(typeof params.call_id === "string" && params.call_id) ||
			(typeof rpcId === "number" ? `elicitation_${rpcId}` : "");

		if (!callId) {
			return;
		}

		const msg: Record<string, unknown> = {
			type: "elicitation_create",
			call_id: callId,
			title: params.title,
			options: params.options,
		};

		this.handlePermissionRequest(msg, sessionId);
	}

	private hasPermissionOptions(params: Record<string, unknown>): boolean {
		return Array.isArray(params.options) || Array.isArray(params.choices);
	}

	private isPermissionRequestType(value: string): boolean {
		const lowered = value.toLowerCase();
		return lowered.includes("approval") || lowered.includes("permission");
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

	private normalizePermissionOptions(options: unknown): PermissionOption[] {
		if (!Array.isArray(options)) {
			if (options && typeof options === "object") {
				const record = options as Record<string, unknown>;
				if (Array.isArray(record.options)) {
					return this.normalizePermissionOptions(record.options);
				}
				if (Array.isArray(record.choices)) {
					return this.normalizePermissionOptions(record.choices);
				}
			}
			return this.getPermissionOptions();
		}

		const normalized = options
			.map((option, index) => {
				if (!option || typeof option !== "object") {
					return null;
				}

				const record = option as Record<string, unknown>;
				const optionId =
					(typeof record.optionId === "string" && record.optionId) ||
					(typeof record.id === "string" && record.id) ||
					`option_${index}`;
				const name =
					(typeof record.name === "string" && record.name) ||
					(typeof record.label === "string" && record.label) ||
					(typeof record.title === "string" && record.title) ||
					String(optionId);
				const kind = this.normalizePermissionKind(
					record.kind ?? record.type ?? record.name ?? record.id,
				);

				return {
					optionId,
					name,
					kind,
				} as PermissionOption;
			})
			.filter((option): option is PermissionOption => option !== null);

		return normalized.length > 0 ? normalized : this.getPermissionOptions();
	}

	private normalizePermissionKind(
		rawKind: unknown,
	): PermissionOption["kind"] {
		const value = String(rawKind ?? "").toLowerCase();
		const isReject = value.includes("reject") || value.includes("deny");
		const isAlways = value.includes("always") || value.includes("session");

		if (isReject) {
			return isAlways ? "reject_always" : "reject_once";
		}
		if (value.includes("allow") || value.includes("approve")) {
			return isAlways ? "allow_always" : "allow_once";
		}
		return "allow_once";
	}

	private getPermissionTitle(
		msg: Record<string, unknown>,
		msgType: string,
	): string {
		if (typeof msg.title === "string" && msg.title.trim()) {
			return msg.title.trim();
		}
		if (typeof msg.label === "string" && msg.label.trim()) {
			return msg.label.trim();
		}
		if (msgType === "exec_approval_request") {
			return "Exec command";
		}
		if (msgType === "apply_patch_approval_request") {
			return "Apply patch";
		}
		return msgType ? msgType.replace(/_/g, " ") : "Permission request";
	}

	private inferToolKind(
		msgType: string,
		msg: Record<string, unknown>,
	): ToolKind {
		const raw =
			(typeof msg.kind === "string" && msg.kind) ||
			(typeof msg.tool === "string" && msg.tool) ||
			msgType;
		const value = raw.toLowerCase();
		if (value.includes("exec") || value.includes("command")) {
			return "execute";
		}
		if (
			value.includes("write") ||
			value.includes("edit") ||
			value.includes("patch")
		) {
			return "edit";
		}
		if (value.includes("read")) {
			return "read";
		}
		return "other";
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
