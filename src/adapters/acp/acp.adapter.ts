import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type {
	IAgentClient,
	AgentConfig,
	InitializeResult,
	NewSessionResult,
} from "../../domain/ports/agent-client.port";
import type { MessageContent } from "../../domain/models/chat-message";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { PromptContent } from "../../domain/models/prompt-content";
import type { AgentError } from "../../domain/models/agent-error";
import type {
	SessionModeState,
	SessionModelState,
} from "../../domain/models/chat-session";
import { AcpTypeConverter } from "./acp-type-converter";
import {
	AcpConnection,
	type AcpProcessErrorEvent,
	type AcpProcessExitEvent,
} from "./acp.connection";
import { TerminalManager } from "../../shared/terminal-manager";
import { Logger } from "../../shared/logger";
import { AcpPermissionHandler } from "./acp-permission-handler";
import { AcpMessageHandler } from "./acp-message-handler";
import type AgentClientPlugin from "../../plugin";
import { convertWindowsPathToWsl } from "../../shared/wsl-utils";

/**
 * Extended ACP Client interface for UI layer.
 *
 * Provides ACP-specific operations needed by UI components
 * (terminal rendering, permission handling, etc.) that are not
 * part of the domain-level IAgentClient interface.
 */
export interface IAcpClient extends acp.Client {
	handlePermissionResponse(requestId: string, optionId: string): void;
	cancelAllOperations(): void;
	resetCurrentMessage(): void;
	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse>;
}

/**
 * Adapter that wraps the Agent Client Protocol (ACP) library.
 *
 * This adapter:
 * - Manages agent process lifecycle (spawn, monitor, kill)
 * - Implements ACP protocol communication
 * - Delegates permission handling to AcpPermissionHandler
 * - Delegates message processing to AcpMessageHandler
 * - Provides callbacks for UI updates
 */
export class AcpAdapter implements IAgentClient, IAcpClient {
	private acpConnection: AcpConnection;
	private logger: Logger;
	private permissionHandler: AcpPermissionHandler;
	private messageHandler: AcpMessageHandler;
	private terminalManager: TerminalManager;

	// Error callback for process-level errors
	private errorCallback: ((error: AgentError) => void) | null = null;

	// Configuration state
	private currentConfig: AgentConfig | null = null;
	private isInitializedFlag = false;
	private currentAgentId: string | null = null;

	// Current message tracking (for terminal operations)
	private currentMessageId: string | null = null;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = new Logger(plugin);

		// Initialize handlers
		this.permissionHandler = new AcpPermissionHandler(plugin, this.logger);
		this.messageHandler = new AcpMessageHandler(this.logger);
		this.terminalManager = new TerminalManager(plugin);

		// Initialize ACP connection
		this.acpConnection = new AcpConnection(plugin, this.logger, this, {
			onProcessError: (event) => this.handleProcessError(event),
			onProcessExit: (event) => this.handleProcessExit(event),
		});
	}

	/**
	 * Set the update message callback for permission UI updates.
	 *
	 * This callback is used to update tool call messages when permission
	 * requests are responded to or cancelled.
	 */
	setUpdateMessageCallback(
		updateMessage: (toolCallId: string, content: MessageContent) => void,
	): void {
		// Forward to permission handler with type conversion
		this.permissionHandler.setUpdateMessageCallback(
			(toolCallId, content) => {
				updateMessage(toolCallId, content as MessageContent);
			},
		);
	}

	// ========================================================================
	// IAgentClient Implementation
	// ========================================================================

	/**
	 * Initialize connection to an AI agent.
	 */
	async initialize(config: AgentConfig): Promise<InitializeResult> {
		console.log("[AcpAdapter] Starting initialization:", config.id);
		this.currentConfig = config;

		try {
			const initResult = await this.acpConnection.initialize(config);

			console.log(
				`[AcpAdapter] ✅ Connected (protocol v${initResult.protocolVersion})`,
			);

			// Verify connection is still valid after initialization
			if (!this.acpConnection.isConnected()) {
				console.error(
					"[AcpAdapter] Connection lost after initialization!",
				);
				throw new Error(
					"Connection lost immediately after initialization",
				);
			}

			// Mark as initialized
			this.isInitializedFlag = true;
			this.currentAgentId = config.id;
			console.log(
				"[AcpAdapter] isInitializedFlag set to true, currentAgentId:",
				config.id,
			);

			// Extract prompt capabilities
			const promptCaps = initResult.agentCapabilities?.promptCapabilities;

			return {
				protocolVersion: initResult.protocolVersion,
				authMethods: initResult.authMethods || [],
				promptCapabilities: {
					image: promptCaps?.image ?? false,
					audio: promptCaps?.audio ?? false,
					embeddedContext: promptCaps?.embeddedContext ?? false,
				},
			};
		} catch (error) {
			console.error("[AcpAdapter] Initialization failed:", error);
			this.isInitializedFlag = false;
			this.currentAgentId = null;
			this.acpConnection.disconnect();
			throw error;
		}
	}

	/**
	 * Create a new chat session.
	 */
	async newSession(workingDirectory: string): Promise<NewSessionResult> {
		const connection = this.getConnectionOrThrow();

		try {
			this.logger.log("[AcpAdapter] Creating new session...");

			// Convert Windows path to WSL if needed
			let sessionCwd = workingDirectory;
			if (Platform.isWin && this.plugin.settings.windowsWslMode) {
				sessionCwd = convertWindowsPathToWsl(workingDirectory);
			}

			this.logger.log("[AcpAdapter] Working directory:", sessionCwd);

			const sessionResult = await connection.newSession({
				cwd: sessionCwd,
				mcpServers: [],
			});

			this.logger.log(
				`[AcpAdapter] 📝 Session created: ${sessionResult.sessionId}`,
			);

			// Convert modes from ACP to domain format
			let modes: SessionModeState | undefined;
			if (sessionResult.modes) {
				modes = {
					availableModes: sessionResult.modes.availableModes.map(
						(m) => ({
							id: m.id,
							name: m.name,
							description: m.description ?? undefined,
						}),
					),
					currentModeId: sessionResult.modes.currentModeId,
				};
			}

			// Convert models from ACP to domain format
			let models: SessionModelState | undefined;
			if (sessionResult.models) {
				models = {
					availableModels: sessionResult.models.availableModels.map(
						(m) => ({
							modelId: m.modelId,
							name: m.name,
							description: m.description ?? undefined,
						}),
					),
					currentModelId: sessionResult.models.currentModelId,
				};
			}

			return {
				sessionId: sessionResult.sessionId,
				modes,
				models,
			};
		} catch (error) {
			this.logger.error("[AcpAdapter] New session failed:", error);
			throw error;
		}
	}

	/**
	 * Authenticate with the agent.
	 */
	async authenticate(methodId: string): Promise<boolean> {
		const connection = this.getConnectionOrThrow();

		try {
			await connection.authenticate({ methodId });
			this.logger.log("[AcpAdapter] ✅ Authenticated:", methodId);
			return true;
		} catch (error: unknown) {
			this.logger.error("[AcpAdapter] Authentication failed:", error);
			return false;
		}
	}

	/**
	 * Send a message to the agent.
	 */
	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		const connection = this.getConnectionOrThrow();
		this.resetCurrentMessage();

		try {
			// Convert domain PromptContent to ACP ContentBlock
			const acpContent = content.map((c) =>
				AcpTypeConverter.toAcpContentBlock(c),
			);

			this.logger.log(
				`[AcpAdapter] Sending ${content.length} content blocks`,
			);

			const promptResult = await connection.prompt({
				sessionId: sessionId,
				prompt: acpContent,
			});

			this.logger.log(
				`[AcpAdapter] Completed: ${promptResult.stopReason}`,
			);
		} catch (error: unknown) {
			this.logger.error("[AcpAdapter] Prompt error:", error);

			// Ignore certain benign errors
			if (this.isIgnorableError(error)) {
				return;
			}

			throw error;
		}
	}

	/**
	 * Cancel the current operation.
	 */
	async cancel(sessionId: string): Promise<void> {
		const connection = this.acpConnection.getConnection();
		if (!connection) {
			this.logger.warn("[AcpAdapter] Cannot cancel: no connection");
			return;
		}

		try {
			this.logger.log("[AcpAdapter] Sending cancellation...");
			await connection.cancel({ sessionId });
			this.logger.log("[AcpAdapter] Cancellation sent");
			this.cancelAllOperations();
		} catch (error) {
			this.logger.error("[AcpAdapter] Cancellation failed:", error);
			this.cancelAllOperations();
		}
	}

	/**
	 * Disconnect from the agent.
	 */
	disconnect(): Promise<void> {
		this.logger.log("[AcpAdapter] Disconnecting...");

		this.cancelAllOperations();
		this.acpConnection.disconnect();
		this.currentConfig = null;
		this.isInitializedFlag = false;
		this.currentAgentId = null;

		this.logger.log("[AcpAdapter] Disconnected");
		return Promise.resolve();
	}

	/**
	 * Check if initialized.
	 */
	isInitialized(): boolean {
		return this.isInitializedFlag && this.acpConnection.isConnected();
	}

	/**
	 * Get current agent ID.
	 */
	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	/**
	 * Set session mode.
	 */
	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		const connection = this.getConnectionOrThrow();

		this.logger.log(`[AcpAdapter] Setting mode: ${modeId}`);

		try {
			await connection.setSessionMode({ sessionId, modeId });
			this.logger.log(`[AcpAdapter] Mode set: ${modeId}`);
		} catch (error) {
			this.logger.error("[AcpAdapter] Set mode failed:", error);
			throw error;
		}
	}

	/**
	 * Set session model.
	 */
	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		const connection = this.getConnectionOrThrow();

		this.logger.log(`[AcpAdapter] Setting model: ${modelId}`);

		try {
			await connection.unstable_setSessionModel({ sessionId, modelId });
			this.logger.log(`[AcpAdapter] Model set: ${modelId}`);
		} catch (error) {
			this.logger.error("[AcpAdapter] Set model failed:", error);
			throw error;
		}
	}

	/**
	 * Register session update callback.
	 */
	onSessionUpdate(callback: (update: SessionUpdate) => void): void {
		this.messageHandler.onSessionUpdate(callback);
	}

	/**
	 * Register error callback.
	 */
	onError(callback: (error: AgentError) => void): void {
		this.errorCallback = callback;
	}

	/**
	 * Respond to a permission request.
	 */
	respondToPermission(requestId: string, optionId: string): Promise<void> {
		this.getConnectionOrThrow();
		this.logger.log("[AcpAdapter] Responding to permission:", requestId);
		this.handlePermissionResponse(requestId, optionId);
		return Promise.resolve();
	}

	// ========================================================================
	// IAcpClient Implementation (ACP Protocol Methods)
	// ========================================================================

	/**
	 * Handle session updates from ACP protocol.
	 */
	sessionUpdate(params: acp.SessionNotification): Promise<void> {
		this.messageHandler.handleSessionUpdate(params);
		return Promise.resolve();
	}

	/**
	 * Handle permission requests from ACP protocol.
	 */
	async requestPermission(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		return await this.permissionHandler.handlePermissionRequest(params);
	}

	/**
	 * Reset current message ID.
	 */
	resetCurrentMessage(): void {
		this.currentMessageId = null;
	}

	/**
	 * Handle permission response from user (UI layer).
	 */
	handlePermissionResponse(requestId: string, optionId: string): void {
		this.permissionHandler.handleUserResponse(requestId, optionId);
	}

	/**
	 * Cancel all ongoing operations.
	 */
	cancelAllOperations(): void {
		this.permissionHandler.cancelAll();
		this.terminalManager.killAllTerminals();
	}

	// ========================================================================
	// Terminal Operations (IAcpClient)
	// ========================================================================

	readTextFile(params: acp.ReadTextFileRequest) {
		return Promise.resolve({ content: "" });
	}

	writeTextFile(params: acp.WriteTextFileRequest) {
		return Promise.resolve({});
	}

	createTerminal(
		params: acp.CreateTerminalRequest,
	): Promise<acp.CreateTerminalResponse> {
		this.logger.log("[AcpAdapter] Creating terminal:", params);

		const modifiedParams = {
			...params,
			cwd: params.cwd || this.currentConfig?.workingDirectory || "",
		};

		const terminalId = this.terminalManager.createTerminal(modifiedParams);
		return Promise.resolve({ terminalId });
	}

	terminalOutput(
		params: acp.TerminalOutputRequest,
	): Promise<acp.TerminalOutputResponse> {
		const result = this.terminalManager.getOutput(params.terminalId);
		if (!result) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return Promise.resolve(result);
	}

	async waitForTerminalExit(
		params: acp.WaitForTerminalExitRequest,
	): Promise<acp.WaitForTerminalExitResponse> {
		return await this.terminalManager.waitForExit(params.terminalId);
	}

	killTerminal(
		params: acp.KillTerminalCommandRequest,
	): Promise<acp.KillTerminalCommandResponse> {
		const success = this.terminalManager.killTerminal(params.terminalId);
		if (!success) {
			throw new Error(`Terminal ${params.terminalId} not found`);
		}
		return Promise.resolve({});
	}

	releaseTerminal(
		params: acp.ReleaseTerminalRequest,
	): Promise<acp.ReleaseTerminalResponse> {
		const success = this.terminalManager.releaseTerminal(params.terminalId);
		if (!success) {
			this.logger.log(
				`[AcpAdapter] Terminal ${params.terminalId} already released`,
			);
		}
		return Promise.resolve({});
	}

	// ========================================================================
	// Private Helper Methods
	// ========================================================================

	private getConnectionOrThrow(): acp.ClientSideConnection {
		const connection = this.acpConnection.getConnection();
		if (!connection) {
			throw new Error("Not initialized. Call initialize() first.");
		}
		return connection;
	}

	private handleProcessError(event: AcpProcessErrorEvent): void {
		const agentError: AgentError = {
			id: crypto.randomUUID(),
			category: "connection",
			severity: "error",
			occurredAt: new Date(),
			agentId: this.currentConfig?.id,
			originalError: event.error,
			...this.getErrorInfo(event.error, event.command, event.agentLabel),
		};

		this.errorCallback?.(agentError);
	}

	private handleProcessExit(event: AcpProcessExitEvent): void {
		if (event.code === 127) {
			this.logger.error(
				`[AcpAdapter] Command not found: ${event.command}`,
			);

			const agentError: AgentError = {
				id: crypto.randomUUID(),
				category: "configuration",
				severity: "error",
				title: "Command Not Found",
				message: `The command "${event.command}" could not be found. Please check the path configuration for ${event.agentLabel}.`,
				suggestion: this.getCommandNotFoundSuggestion(event.command),
				occurredAt: new Date(),
				agentId: this.currentConfig?.id,
				code: event.code,
			};

			this.errorCallback?.(agentError);
		}
	}

	private getErrorInfo(
		error: Error,
		command: string,
		agentLabel: string,
	): { title: string; message: string; suggestion: string } {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {
				title: "Command Not Found",
				message: `The command "${command}" could not be found. Please check the path configuration for ${agentLabel}.`,
				suggestion: this.getCommandNotFoundSuggestion(command),
			};
		}

		return {
			title: "Agent Startup Error",
			message: `Failed to start ${agentLabel}: ${error.message}`,
			suggestion: "Please check the agent configuration in settings.",
		};
	}

	private getCommandNotFoundSuggestion(command: string): string {
		const commandName =
			command.split("/").pop()?.split("\\").pop() || "command";

		if (Platform.isWin) {
			return `1. Verify the agent path: Use "where ${commandName}" in Command Prompt to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "where node" to find it).`;
		} else {
			return `1. Verify the agent path: Use "which ${commandName}" in Terminal to find the correct path. 2. If the agent requires Node.js, also check that Node.js path is correctly set in General Settings (use "which node" to find it).`;
		}
	}

	private isIgnorableError(error: unknown): boolean {
		const errorObj = error as Record<string, unknown> | null;
		if (
			errorObj &&
			typeof errorObj === "object" &&
			"code" in errorObj &&
			errorObj.code === -32603 &&
			"data" in errorObj
		) {
			const errorData = errorObj.data as Record<string, unknown> | null;
			if (
				errorData &&
				typeof errorData === "object" &&
				"details" in errorData &&
				typeof errorData.details === "string"
			) {
				// Ignore "empty response text" errors
				if (errorData.details.includes("empty response text")) {
					this.logger.log("[AcpAdapter] Empty response - ignoring");
					return true;
				}
				// Ignore "user aborted" errors
				if (errorData.details.includes("user aborted")) {
					this.logger.log("[AcpAdapter] User aborted - ignoring");
					return true;
				}
			}
		}
		return false;
	}
}
