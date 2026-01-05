import { spawn, type ChildProcess } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type CCHubPlugin from "../../plugin";
import type { AgentConfig } from "../../domain/ports/cchub.port";
import type { Logger } from "../../shared/logger";
import { resolveCommandDirectory } from "../../shared/path-utils";
import { wrapCommandForPlatform } from "../../shared/platform/platform-command-wrapper";
import { buildProcessEnv } from "../../shared/platform/platform-env-builder";

export interface AcpProcessErrorEvent {
	error: Error;
	command: string;
	agentLabel: string;
}

export interface AcpProcessExitEvent {
	code: number | null;
	signal: NodeJS.Signals | null;
	command: string;
	agentLabel: string;
}

export interface AcpConnectionEvents {
	onProcessError?: (event: AcpProcessErrorEvent) => void;
	onProcessExit?: (event: AcpProcessExitEvent) => void;
}

/**
 * Manages ACP agent process lifecycle and connection.
 *
 * This class handles:
 * - Spawning agent processes with proper platform-specific configuration
 * - Establishing ACP protocol connection via stdio
 * - Monitoring process events (spawn, error, exit)
 * - Cleaning up resources on disconnect
 */
export class AcpConnection {
	private connection: acp.ClientSideConnection | null = null;
	private agentProcess: ChildProcess | null = null;

	constructor(
		private plugin: CCHubPlugin,
		private logger: Logger,
		private client: acp.Client,
		private events: AcpConnectionEvents = {},
	) {}

	getConnection(): acp.ClientSideConnection | null {
		return this.connection;
	}

	isConnected(): boolean {
		const connected =
			this.connection !== null && this.agentProcess !== null;
		console.debug("[AcpConnection] isConnected check:", {
			hasConnection: this.connection !== null,
			hasProcess: this.agentProcess !== null,
			processPid: this.agentProcess?.pid,
			result: connected,
		});
		return connected;
	}

	disconnect(): void {
		if (this.agentProcess) {
			this.logger.log(
				`[AcpConnection] Killing process (PID: ${this.agentProcess.pid})`,
			);
			this.agentProcess.kill();
			this.agentProcess = null;
		}
		this.connection = null;
	}

	async initialize(config: AgentConfig): Promise<acp.InitializeResponse> {
		this.cleanupExisting();

		if (!config.command || config.command.trim().length === 0) {
			throw new Error(
				`Command not configured for agent "${config.displayName}" (${config.id})`,
			);
		}

		const agentLabel = `${config.displayName} (${config.id})`;
		this.logger.log(`[AcpConnection] Initializing: ${agentLabel}`);

		// Prepare command and environment
		const { command, args } = this.prepareCommand(config);
		const env = this.prepareEnvironment(config);

		this.logger.log("[AcpConnection] Command:", command);
		this.logger.log("[AcpConnection] Args:", args.join(" ") || "(none)");
		this.logger.log("[AcpConnection] CWD:", config.workingDirectory);

		// Spawn the agent process
		const agentProcess = this.spawnAgentProcess(
			command,
			args,
			env,
			config.workingDirectory,
			agentLabel,
		);

		this.agentProcess = agentProcess;

		// Set up process event handlers
		this.setupProcessHandlers(agentProcess, config.command, agentLabel);

		// Create ACP connection from stdio streams
		this.connection = await this.createAcpConnection(
			agentProcess,
			agentLabel,
		);

		// Initialize ACP protocol
		this.logger.log("[AcpConnection] Starting ACP initialization...");

		return await this.connection.initialize({
			protocolVersion: acp.PROTOCOL_VERSION,
			clientCapabilities: {
				fs: {
					readTextFile: false,
					writeTextFile: false,
				},
				terminal: true,
			},
		});
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Prepare command and arguments for platform-specific execution.
	 */
	private prepareCommand(config: AgentConfig): {
		command: string;
		args: string[];
	} {
		const nodeDir = this.getNodeDirectory();

		const wrapped = wrapCommandForPlatform({
			command: config.command.trim(),
			args: config.args.length > 0 ? [...config.args] : [],
			cwd: config.workingDirectory,
			wslMode: this.plugin.settings.windowsWslMode,
			wslDistribution: this.plugin.settings.windowsWslDistribution,
			nodeDir,
		});

		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			this.logger.log(
				"[AcpConnection] WSL mode:",
				this.plugin.settings.windowsWslDistribution || "default",
			);
		}

		return wrapped;
	}

	/**
	 * Prepare environment variables for the agent process.
	 */
	private prepareEnvironment(config: AgentConfig): NodeJS.ProcessEnv {
		const nodeDir = this.getNodeDirectory();

		return buildProcessEnv({
			customEnv: config.env || {},
			nodeDir,
		});
	}

	/**
	 * Get Node.js directory from settings.
	 */
	private getNodeDirectory(): string | undefined {
		if (
			!this.plugin.settings.nodePath ||
			this.plugin.settings.nodePath.trim().length === 0
		) {
			return undefined;
		}

		return (
			resolveCommandDirectory(this.plugin.settings.nodePath.trim()) ||
			undefined
		);
	}

	/**
	 * Spawn the agent process.
	 */
	private spawnAgentProcess(
		command: string,
		args: string[],
		env: NodeJS.ProcessEnv,
		cwd: string,
		agentLabel: string,
	): ChildProcess {
		const needsShell =
			Platform.isWin && !this.plugin.settings.windowsWslMode;

		const agentProcess = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env,
			cwd,
			shell: needsShell,
		});

		this.logger.log(
			`[AcpConnection] Spawned ${agentLabel} (PID: ${agentProcess.pid})`,
		);

		return agentProcess;
	}

	/**
	 * Set up event handlers for the agent process.
	 */
	private setupProcessHandlers(
		agentProcess: ChildProcess,
		command: string,
		agentLabel: string,
	): void {
		agentProcess.on("spawn", () => {
			this.logger.log(
				`[AcpConnection] ${agentLabel} spawned (PID: ${agentProcess.pid})`,
			);
		});

		agentProcess.on("error", (error) => {
			this.logger.error(`[AcpConnection] ${agentLabel} error:`, error);
			this.events.onProcessError?.({
				error,
				command,
				agentLabel,
			});
		});

		agentProcess.on("exit", (code, signal) => {
			console.debug(
				`[AcpConnection] ${agentLabel} exited (code: ${code}, signal: ${signal}, pid: ${agentProcess.pid})`,
			);
			this.events.onProcessExit?.({
				code,
				signal,
				command,
				agentLabel,
			});
			// Only clear connection if this is the current process
			if (this.agentProcess === agentProcess) {
				console.debug(
					"[AcpConnection] Clearing connection for exited process",
				);
				this.connection = null;
				this.agentProcess = null;
			} else {
				console.debug(
					"[AcpConnection] Ignoring exit from old process (current pid:",
					this.agentProcess?.pid,
					")",
				);
			}
		});

		agentProcess.on("close", (code, signal) => {
			this.logger.log(
				`[AcpConnection] ${agentLabel} closed (code: ${code}, signal: ${signal})`,
			);
		});

		// Log stderr output
		agentProcess.stderr?.setEncoding("utf8");
		agentProcess.stderr?.on("data", (data) => {
			this.logger.log(`[AcpConnection] ${agentLabel} stderr:`, data);
		});

		// Handle stdin errors
		agentProcess.stdin?.on("error", (error) => {
			const errno = error as NodeJS.ErrnoException;
			if (errno.code === "EPIPE") {
				this.logger.warn(
					`[AcpConnection] ${agentLabel} stdin closed (EPIPE)`,
				);
				return;
			}
			this.logger.error(
				`[AcpConnection] ${agentLabel} stdin error:`,
				error,
			);
		});
	}

	/**
	 * Create ACP connection from process stdio streams.
	 */
	private async createAcpConnection(
		agentProcess: ChildProcess,
		agentLabel: string,
	): Promise<acp.ClientSideConnection> {
		if (!agentProcess.stdin || !agentProcess.stdout) {
			throw new Error("Agent process stdin/stdout not available");
		}

		const stdin = agentProcess.stdin;
		const stdout = agentProcess.stdout;
		const logger = this.logger;

		let isClosed = false;

		// Set up close detection
		agentProcess.on("close", () => {
			isClosed = true;
		});

		// Create writable stream for ACP input
		const input = new WritableStream<Uint8Array>({
			write(chunk: Uint8Array) {
				if (isClosed || stdin.destroyed || !stdin.writable) {
					return;
				}
				try {
					stdin.write(chunk);
				} catch (error) {
					const errno = error as NodeJS.ErrnoException;
					if (errno.code === "EPIPE") {
						logger.warn(
							`[AcpConnection] ${agentLabel} stdin closed while writing`,
						);
						return;
					}
					logger.error(
						`[AcpConnection] ${agentLabel} stdin write failed:`,
						error,
					);
				}
			},
			close() {
				if (!stdin.destroyed && !stdin.writableEnded) {
					stdin.end();
				}
			},
		});

		// Create readable stream for ACP output
		const output = new ReadableStream<Uint8Array>({
			start(controller) {
				stdout.on("data", (chunk: Uint8Array) => {
					controller.enqueue(chunk);
				});
				stdout.on("end", () => {
					controller.close();
				});
			},
		});

		// Create ACP protocol stream
		const stream = acp.ndJsonStream(input, output);

		return new acp.ClientSideConnection(() => this.client, stream);
	}

	/**
	 * Clean up existing connection and process.
	 */
	private cleanupExisting(): void {
		if (this.agentProcess) {
			this.logger.log(
				`[AcpConnection] Killing existing process (PID: ${this.agentProcess.pid})`,
			);
			this.agentProcess.kill();
			this.agentProcess = null;
		}
		if (this.connection) {
			this.logger.log("[AcpConnection] Cleaning up existing connection");
			this.connection = null;
		}
	}
}
