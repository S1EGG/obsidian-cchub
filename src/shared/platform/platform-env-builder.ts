import { Platform } from "obsidian";

/**
 * Options for building process environment variables.
 */
export interface BuildEnvOptions {
	/** Custom environment variables to merge */
	customEnv?: Record<string, string>;
	/** Node.js directory to add to PATH */
	nodeDir?: string;
}

/**
 * Builds environment variables for process spawning.
 *
 * This function:
 * - Starts with current process environment
 * - Merges custom environment variables
 * - Adds Node.js directory to PATH if provided
 *
 * @param options - Environment building options
 * @returns Complete environment variables object
 */
export function buildProcessEnv(
	options: BuildEnvOptions = {},
): NodeJS.ProcessEnv {
	const { customEnv = {}, nodeDir } = options;

	// Start with base environment
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...customEnv,
	};

	// Add Node.js directory to PATH if provided
	if (nodeDir) {
		const separator = Platform.isWin ? ";" : ":";
		env.PATH = env.PATH ? `${nodeDir}${separator}${env.PATH}` : nodeDir;
	}

	return env;
}

/**
 * Converts an array of environment variable objects to a record.
 *
 * Used for converting ACP environment variable format to Node.js format.
 *
 * @param envVars - Array of { name, value } objects
 * @returns Environment variables record
 */
export function envArrayToRecord(
	envVars: Array<{ name: string; value: string }>,
): Record<string, string> {
	const record: Record<string, string> = {};
	for (const { name, value } of envVars) {
		record[name] = value;
	}
	return record;
}
