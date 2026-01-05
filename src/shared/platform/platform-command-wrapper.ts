import { Platform } from "obsidian";
import { wrapCommandForWsl } from "../wsl-utils";

/**
 * Command and arguments structure.
 */
export interface CommandSpec {
	command: string;
	args: string[];
}

/**
 * Options for wrapping a command for cross-platform execution.
 */
export interface WrapCommandOptions {
	/** Original command to execute */
	command: string;
	/** Command arguments */
	args: string[];
	/** Working directory for the command */
	cwd: string;
	/** Whether WSL mode is enabled (Windows only) */
	wslMode?: boolean;
	/** WSL distribution name (Windows only) */
	wslDistribution?: string;
	/** Node.js directory to add to PATH */
	nodeDir?: string;
}

/**
 * Wraps a command for cross-platform execution.
 *
 * This function handles platform-specific command wrapping:
 * - Windows: Uses WSL wrapper if enabled, otherwise executes natively
 * - macOS/Linux: Wraps command in login shell to inherit environment
 *
 * @param options - Command wrapping options
 * @returns Wrapped command specification
 */
export function wrapCommandForPlatform(
	options: WrapCommandOptions,
): CommandSpec {
	const { command, args, cwd, wslMode, wslDistribution, nodeDir } = options;

	// Windows with WSL mode
	if (Platform.isWin && wslMode) {
		return wrapCommandForWsl(
			command,
			args,
			cwd,
			wslDistribution,
			nodeDir,
		);
	}

	// macOS or Linux - wrap in login shell
	if (Platform.isMacOS || Platform.isLinux) {
		return wrapInLoginShell(command, args, nodeDir);
	}

	// Windows native mode - return as-is
	return { command, args };
}

/**
 * Wraps a command in a login shell for macOS/Linux.
 *
 * This ensures the command inherits the user's environment variables.
 *
 * @param command - Command to execute
 * @param args - Command arguments
 * @param nodeDir - Optional Node.js directory to add to PATH
 * @returns Wrapped command specification
 */
function wrapInLoginShell(
	command: string,
	args: string[],
	nodeDir?: string,
): CommandSpec {
	const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";

	// Escape single quotes in arguments
	const commandString = [command, ...args]
		.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
		.join(" ");

	let fullCommand = commandString;

	// Add Node.js directory to PATH if provided
	if (nodeDir) {
		const escapedNodeDir = nodeDir.replace(/'/g, "'\\''");
		fullCommand = `export PATH='${escapedNodeDir}':"$PATH"; ${commandString}`;
	}

	return {
		command: shell,
		args: ["-l", "-c", fullCommand],
	};
}

/**
 * Detects if a command contains shell syntax that requires shell execution.
 *
 * Shell syntax includes: pipes, redirects, logical operators, etc.
 *
 * @param command - Command string to check
 * @returns True if command contains shell syntax
 */
export function hasShellSyntax(command: string): boolean {
	return /[|&;<>()$`\\"]/.test(command);
}

/**
 * Wraps a command in a shell if it contains shell syntax.
 *
 * @param command - Command to execute
 * @returns Wrapped command specification
 */
export function wrapInShellIfNeeded(command: string): CommandSpec {
	if (!hasShellSyntax(command)) {
		// No shell syntax - split by spaces
		const parts = command.split(" ").filter((part) => part.length > 0);
		const [first, ...rest] = parts;
		return {
			command: first || command,
			args: rest,
		};
	}

	// Has shell syntax - use appropriate shell
	const shell =
		Platform.isMacOS || Platform.isLinux ? "/bin/sh" : "cmd.exe";
	const shellFlag = Platform.isMacOS || Platform.isLinux ? "-c" : "/c";

	return {
		command: shell,
		args: [shellFlag, command],
	};
}
