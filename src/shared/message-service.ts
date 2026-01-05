/**
 * Message Service
 *
 * Pure functions for prompt preparation and sending.
 * Extracted from SendMessageUseCase for better separation of concerns.
 *
 * Responsibilities:
 * - Process mentions (@[[note]] syntax)
 * - Convert mentions to file paths
 * - Send prompt to agent via ICCHubClient
 * - Handle authentication errors with retry logic
 */

import type { ICCHubClient } from "../domain/ports/cchub.port";
import type { IVaultAccess } from "../domain/ports/vault-access.port";
import type { AgentError } from "../domain/models/agent-error";
import type { AuthenticationMethod } from "../domain/models/chat-session";
import type {
	PromptContent,
	ImagePromptContent,
} from "../domain/models/prompt-content";
import { extractMentionedNotes, type IMentionService } from "./mention-utils";
import { convertWindowsPathToWsl } from "./wsl-utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for preparing a prompt
 */
export interface PreparePromptInput {
	/** User's message text (may contain @mentions) */
	message: string;

	/** Attached images */
	images?: ImagePromptContent[];

	/** Vault base path for converting mentions to absolute paths */
	vaultBasePath: string;

	/** Whether to convert paths to WSL format (Windows + WSL mode) */
	convertToWsl?: boolean;
}

/**
 * Result of preparing a prompt
 */
export interface PreparePromptResult {
	/** Content for UI display (original text + images) */
	displayContent: PromptContent[];

	/** Content to send to agent (processed text + images) */
	agentContent: PromptContent[];
}

/**
 * Input for sending a prepared prompt
 */
export interface SendPreparedPromptInput {
	/** Current session ID */
	sessionId: string;

	/** The prepared agent content (from preparePrompt) */
	agentContent: PromptContent[];

	/** The display content (for error reporting) */
	displayContent: PromptContent[];

	/** Available authentication methods */
	authMethods: AuthenticationMethod[];
}

/**
 * Result of sending a prompt
 */
export interface SendPromptResult {
	/** Whether the prompt was sent successfully */
	success: boolean;

	/** The display content */
	displayContent: PromptContent[];

	/** The agent content sent */
	agentContent: PromptContent[];

	/** Error information if sending failed */
	error?: AgentError;

	/** Whether authentication is required */
	requiresAuth?: boolean;

	/** Whether the prompt was successfully sent after retry */
	retriedSuccessfully?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_NOTE_LENGTH = 10000; // Maximum characters per note
// ============================================================================
// Prompt Preparation Functions
// ============================================================================

/**
 * Prepare a prompt for sending to the agent.
 *
 * Processes the message by:
 * - Building context blocks for mentioned notes
 * - Creating agent content with context + user message + images
 */
export async function preparePrompt(
	input: PreparePromptInput,
	vaultAccess: IVaultAccess,
	mentionService: IMentionService,
): Promise<PreparePromptResult> {
	// Step 1: Extract all mentioned notes from the message
	const mentionedNotes = extractMentionedNotes(input.message, mentionService);

	// Step 2: Build context blocks for each mentioned note
	const contextBlocks: string[] = [];

	for (const { file } of mentionedNotes) {
		if (!file) {
			continue;
		}

		try {
			const content = await vaultAccess.readNote(file.path);

			let processedContent = content;
			let truncationNote = "";

			if (content.length > MAX_NOTE_LENGTH) {
				processedContent = content.substring(0, MAX_NOTE_LENGTH);
				truncationNote = `\n\n[Note: This note was truncated. Original length: ${content.length} characters, showing first ${MAX_NOTE_LENGTH} characters]`;
			}

			let absolutePath = input.vaultBasePath
				? `${input.vaultBasePath}/${file.path}`
				: file.path;

			if (input.convertToWsl) {
				absolutePath = convertWindowsPathToWsl(absolutePath);
			}

			const contextBlock = `<obsidian_mentioned_note ref="${absolutePath}">\n${processedContent}${truncationNote}\n</obsidian_mentioned_note>`;
			contextBlocks.push(contextBlock);
		} catch (error) {
			console.error(`Failed to read note ${file.path}:`, error);
		}
	}

	// Step 3: Build agent message text (context blocks + original message)
	const agentMessageText =
		contextBlocks.length > 0
			? contextBlocks.join("\n") + "\n\n" + input.message
			: input.message;

	// Step 4: Build content arrays
	// Only include text block if there's actual text content
	// (API rejects empty text blocks)
	const displayContent: PromptContent[] = [
		...(input.message
			? [{ type: "text" as const, text: input.message }]
			: []),
		...(input.images || []),
	];

	const agentContent: PromptContent[] = [
		...(agentMessageText
			? [{ type: "text" as const, text: agentMessageText }]
			: []),
		...(input.images || []),
	];

	return {
		displayContent,
		agentContent,
	};
}

// ============================================================================
// Prompt Sending Functions
// ============================================================================

/**
 * Send a prepared prompt to the agent.
 */
export async function sendPreparedPrompt(
	input: SendPreparedPromptInput,
	cchubClient: ICCHubClient,
): Promise<SendPromptResult> {
	try {
		await cchubClient.sendPrompt(input.sessionId, input.agentContent);

		return {
			success: true,
			displayContent: input.displayContent,
			agentContent: input.agentContent,
		};
	} catch (error) {
		return await handleSendError(
			error,
			input.sessionId,
			input.agentContent,
			input.displayContent,
			input.authMethods,
			cchubClient,
		);
	}
}

// ============================================================================
// Error Handling Functions
// ============================================================================

/**
 * Handle errors that occur during prompt sending.
 */
async function handleSendError(
	error: unknown,
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethods: AuthenticationMethod[],
	cchubClient: ICCHubClient,
): Promise<SendPromptResult> {
	// Check for "empty response text" error - ignore silently
	if (isEmptyResponseError(error)) {
		return {
			success: true,
			displayContent,
			agentContent,
		};
	}

	// Check if this is a rate limit error
	const isRateLimitError =
		error &&
		typeof error === "object" &&
		"code" in error &&
		(error as { code: unknown }).code === 429;

	if (isRateLimitError) {
		const errorMessage =
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
				? (error as { message: string }).message
				: "Too many requests. Please try again later.";

		return {
			success: false,
			displayContent,
			agentContent,
			error: {
				id: crypto.randomUUID(),
				category: "rate_limit",
				severity: "error",
				title: "Rate Limit Exceeded",
				message: `Rate limit exceeded: ${errorMessage}`,
				suggestion:
					"You have exceeded the API rate limit. Please wait a few moments before trying again.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	// Check if authentication is required
	if (!authMethods || authMethods.length === 0) {
		return {
			success: false,
			displayContent,
			agentContent,
			error: {
				id: crypto.randomUUID(),
				category: "authentication",
				severity: "error",
				title: "No Authentication Methods",
				message: "No authentication methods available for this agent.",
				suggestion:
					"Please check your agent configuration in settings.",
				occurredAt: new Date(),
				sessionId,
				originalError: error,
			},
		};
	}

	// Try automatic authentication retry if only one method available
	if (authMethods.length === 1) {
		const method = authMethods[0];
		if (!method) {
			return {
				success: false,
				displayContent,
				agentContent,
				error: {
					id: crypto.randomUUID(),
					category: "authentication",
					severity: "error",
					title: "Authentication Required",
					message:
						"Authentication method was not available for this agent.",
					suggestion:
						"Please check your agent configuration in settings.",
					occurredAt: new Date(),
					sessionId,
					originalError: error,
				},
			};
		}
		const retryResult = await retryWithAuthentication(
			sessionId,
			agentContent,
			displayContent,
			method.id,
			cchubClient,
		);

		if (retryResult) {
			return retryResult;
		}
	}

	// Multiple auth methods or retry failed
	return {
		success: false,
		displayContent,
		agentContent,
		requiresAuth: true,
		error: {
			id: crypto.randomUUID(),
			category: "authentication",
			severity: "error",
			title: "Authentication Required",
			message:
				"Authentication failed. Please check if you are logged into the agent or if your API key is correctly set.",
			suggestion:
				"Check your agent configuration in settings and ensure API keys are valid.",
			occurredAt: new Date(),
			sessionId,
			originalError: error,
		},
	};
}

/**
 * Check if error is the "empty response text" error that should be ignored.
 */
function isEmptyResponseError(error: unknown): boolean {
	if (!error || typeof error !== "object") {
		return false;
	}

	if (!("code" in error) || (error as { code: unknown }).code !== -32603) {
		return false;
	}

	if (!("data" in error)) {
		return false;
	}

	const errorData = (error as { data: unknown }).data;

	if (
		errorData &&
		typeof errorData === "object" &&
		"details" in errorData &&
		typeof (errorData as { details: unknown }).details === "string" &&
		(errorData as { details: string }).details.includes(
			"empty response text",
		)
	) {
		return true;
	}

	return false;
}

/**
 * Retry sending prompt after authentication.
 */
async function retryWithAuthentication(
	sessionId: string,
	agentContent: PromptContent[],
	displayContent: PromptContent[],
	authMethodId: string,
	cchubClient: ICCHubClient,
): Promise<SendPromptResult | null> {
	try {
		const authSuccess = await cchubClient.authenticate(authMethodId);

		if (!authSuccess) {
			return null;
		}

		await cchubClient.sendPrompt(sessionId, agentContent);

		return {
			success: true,
			displayContent,
			agentContent,
			retriedSuccessfully: true,
		};
	} catch (retryError) {
		return {
			success: false,
			displayContent,
			agentContent,
			error: {
				id: crypto.randomUUID(),
				category: "communication",
				severity: "error",
				title: "Message Send Failed",
				message: `Failed to send message after authentication: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
				suggestion: "Please try again or check your connection.",
				occurredAt: new Date(),
				sessionId,
				originalError: retryError,
			},
		};
	}
}
