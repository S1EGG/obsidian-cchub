import { spawn, ChildProcess, SpawnOptions } from "child_process";
import * as acp from "@agentclientprotocol/sdk";
import { Platform } from "obsidian";

import type CCHubPlugin from "../plugin";
import { Logger } from "./logger";
import {
	wrapCommandForPlatform,
	wrapInShellIfNeeded,
} from "./platform/platform-command-wrapper";
import {
	buildProcessEnv,
	envArrayToRecord,
} from "./platform/platform-env-builder";
import { resolveCommandDirectory } from "./path-utils";

/**
 * Terminal process state.
 */
interface TerminalProcess {
	id: string;
	process: ChildProcess;
	output: string;
	exitStatus: { exitCode: number | null; signal: string | null } | null;
	outputByteLimit?: number;
	waitPromises: Array<
		(exitStatus: { exitCode: number | null; signal: string | null }) => void
	>;
	cleanupTimeout?: number;
}

/**
 * Manages terminal processes for ACP agent.
 *
 * This class handles:
 * - Creating terminal processes with cross-platform support
 * - Capturing stdout/stderr output with byte limits
 * - Managing process lifecycle (wait, kill, release)
 * - Cleanup after terminal operations complete
 */
export class TerminalManager {
	private terminals = new Map<string, TerminalProcess>();
	private logger: Logger;
	private plugin: CCHubPlugin;

	constructor(plugin: CCHubPlugin) {
		this.logger = new Logger(plugin);
		this.plugin = plugin;
	}

	/**
	 * Create a new terminal process.
	 *
	 * @param params - Terminal creation parameters from ACP
	 * @returns Terminal ID
	 */
	createTerminal(params: acp.CreateTerminalRequest): string {
		const terminalId = crypto.randomUUID();

		if (!Platform.isDesktopApp) {
			throw new Error("CCHub is only available on desktop");
		}

		this.logger.log(`[Terminal ${terminalId}] Creating terminal:`, {
			command: params.command,
			args: params.args,
			cwd: params.cwd,
		});

		// Prepare environment
		const env = this.prepareEnvironment(params);

		// Prepare command and arguments
		const { command, args } = this.prepareCommand(params);

		// Spawn the process
		const childProcess = this.spawnTerminalProcess(
			command,
			args,
			params.cwd ?? undefined,
			env,
			terminalId,
		);

		// Create terminal state
		const terminal: TerminalProcess = {
			id: terminalId,
			process: childProcess,
			output: "",
			exitStatus: null,
			outputByteLimit: params.outputByteLimit ?? undefined,
			waitPromises: [],
		};

		// Set up process handlers
		this.setupProcessHandlers(terminal, terminalId);

		this.terminals.set(terminalId, terminal);
		return terminalId;
	}

	/**
	 * Get terminal output.
	 *
	 * @param terminalId - Terminal ID
	 * @returns Output data or null if terminal not found
	 */
	getOutput(terminalId: string): {
		output: string;
		truncated: boolean;
		exitStatus: { exitCode: number | null; signal: string | null } | null;
	} | null {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return null;
		}

		return {
			output: terminal.output,
			truncated: terminal.outputByteLimit
				? Buffer.byteLength(terminal.output, "utf8") >=
					terminal.outputByteLimit
				: false,
			exitStatus: terminal.exitStatus,
		};
	}

	/**
	 * Wait for terminal to exit.
	 *
	 * @param terminalId - Terminal ID
	 * @returns Promise that resolves with exit status
	 */
	waitForExit(
		terminalId: string,
	): Promise<{ exitCode: number | null; signal: string | null }> {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return Promise.reject(
				new Error(`Terminal ${terminalId} not found`),
			);
		}

		if (terminal.exitStatus) {
			return Promise.resolve(terminal.exitStatus);
		}

		return new Promise((resolve) => {
			terminal.waitPromises.push(resolve);
		});
	}

	/**
	 * Kill a terminal process.
	 *
	 * @param terminalId - Terminal ID
	 * @returns True if terminal was found and killed
	 */
	killTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return false;
		}

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}
		return true;
	}

	/**
	 * Release a terminal (schedule cleanup).
	 *
	 * @param terminalId - Terminal ID
	 * @returns True if terminal was found
	 */
	releaseTerminal(terminalId: string): boolean {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) {
			return false;
		}

		this.logger.log(`[Terminal ${terminalId}] Releasing terminal`);

		if (!terminal.exitStatus) {
			terminal.process.kill("SIGTERM");
		}

		// Schedule cleanup after 30 seconds to allow UI to poll final output
		terminal.cleanupTimeout = window.setTimeout(() => {
			this.logger.log(
				`[Terminal ${terminalId}] Cleaning up after grace period`,
			);
			this.terminals.delete(terminalId);
		}, 30000);

		return true;
	}

	/**
	 * Kill all running terminals.
	 */
	killAllTerminals(): void {
		this.logger.log(
			`[TerminalManager] Killing ${this.terminals.size} terminals`,
		);

		this.terminals.forEach((terminal, terminalId) => {
			// Clear cleanup timeout if scheduled
			if (terminal.cleanupTimeout) {
				window.clearTimeout(terminal.cleanupTimeout);
			}
			if (!terminal.exitStatus) {
				this.logger.log(`[TerminalManager] Killing ${terminalId}`);
				this.killTerminal(terminalId);
			}
		});

		// Clear all terminals
		this.terminals.clear();
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Prepare environment variables for terminal process.
	 */
	private prepareEnvironment(
		params: acp.CreateTerminalRequest,
	): NodeJS.ProcessEnv {
		const customEnv = params.env ? envArrayToRecord(params.env) : {};

		return buildProcessEnv({
			customEnv,
		});
	}

	/**
	 * Prepare command and arguments for terminal.
	 */
	private prepareCommand(params: acp.CreateTerminalRequest): {
		command: string;
		args: string[];
	} {
		let command = params.command;
		let args = params.args || [];

		// If no args provided, check if command needs shell wrapping
		if (!params.args) {
			const wrapped = wrapInShellIfNeeded(params.command);
			command = wrapped.command;
			args = wrapped.args;
		}

		// WSL mode wrapping (if enabled on Windows)
		if (Platform.isWin && this.plugin.settings.windowsWslMode) {
			const nodeDir = this.getNodeDirectory();

			const wslWrapped = wrapCommandForPlatform({
				command,
				args,
				cwd: params.cwd || process.cwd(),
				wslMode: true,
				wslDistribution: this.plugin.settings.windowsWslDistribution,
				nodeDir,
			});

			this.logger.log(
				`[TerminalManager] WSL mode:`,
				this.plugin.settings.windowsWslDistribution || "default",
			);

			return wslWrapped;
		}

		// macOS/Linux - wrap in login shell
		if (Platform.isMacOS || Platform.isLinux) {
			const nodeDir = this.getNodeDirectory();

			return wrapCommandForPlatform({
				command,
				args,
				cwd: params.cwd || process.cwd(),
				nodeDir,
			});
		}

		// Windows native - return as-is
		return { command, args };
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
	 * Spawn the terminal process.
	 */
	private spawnTerminalProcess(
		command: string,
		args: string[],
		cwd: string | undefined,
		env: NodeJS.ProcessEnv,
		terminalId: string,
	): ChildProcess {
		const spawnOptions: SpawnOptions = {
			cwd: cwd ?? undefined,
			env,
			stdio: ["pipe", "pipe", "pipe"],
		};

		const childProcess = spawn(command, args, spawnOptions);

		this.logger.log(
			`[Terminal ${terminalId}] Spawned (PID: ${childProcess.pid})`,
		);

		return childProcess;
	}

	/**
	 * Set up event handlers for terminal process.
	 */
	private setupProcessHandlers(
		terminal: TerminalProcess,
		terminalId: string,
	): void {
		const { process: childProcess } = terminal;

		// Handle spawn errors
		childProcess.on("error", (error) => {
			this.logger.log(
				`[Terminal ${terminalId}] Process error:`,
				error.message,
			);
			// Set exit status to indicate failure
			const exitStatus = { exitCode: 127, signal: null }; // 127 = command not found
			terminal.exitStatus = exitStatus;
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});

		// Capture stdout
		childProcess.stdout?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stdout:`, output);
			this.appendOutput(terminal, output);
		});

		// Capture stderr
		childProcess.stderr?.on("data", (data: Buffer) => {
			const output = data.toString();
			this.logger.log(`[Terminal ${terminalId}] stderr:`, output);
			this.appendOutput(terminal, output);
		});

		// Handle process exit
		childProcess.on("exit", (code, signal) => {
			this.logger.log(
				`[Terminal ${terminalId}] Exited (code: ${code}, signal: ${signal})`,
			);
			const exitStatus = { exitCode: code, signal };
			terminal.exitStatus = exitStatus;
			// Resolve all waiting promises
			terminal.waitPromises.forEach((resolve) => resolve(exitStatus));
			terminal.waitPromises = [];
		});
	}

	/**
	 * Append output to terminal with byte limit enforcement.
	 */
	private appendOutput(terminal: TerminalProcess, data: string): void {
		terminal.output += data;

		// Apply output byte limit if specified
		if (
			terminal.outputByteLimit &&
			Buffer.byteLength(terminal.output, "utf8") >
				terminal.outputByteLimit
		) {
			// Truncate from the beginning
			const bytes = Buffer.from(terminal.output, "utf8");
			const truncatedBytes = bytes.subarray(
				bytes.length - terminal.outputByteLimit,
			);
			terminal.output = truncatedBytes.toString("utf8");
		}
	}
}
