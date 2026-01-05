import * as acp from "@agentclientprotocol/sdk";
import type { SessionUpdate } from "../../domain/models/session-update";
import type { SlashCommand } from "../../domain/models/chat-session";
import { AcpTypeConverter } from "./acp-type-converter";
import type { Logger } from "../obsidian/logger";

/**
 * Callback type for session updates.
 */
export type SessionUpdateCallback = (update: SessionUpdate) => void;

/**
 * Handles ACP session update notifications and converts them to domain events.
 *
 * This class is responsible for:
 * - Receiving session update notifications from ACP protocol
 * - Converting ACP types to domain types
 * - Dispatching updates to registered callbacks
 */
export class AcpMessageHandler {
	private sessionUpdateCallback: SessionUpdateCallback | null = null;

	constructor(private logger: Logger) {}

	/**
	 * Register a callback to receive session updates.
	 */
	onSessionUpdate(callback: SessionUpdateCallback): void {
		this.sessionUpdateCallback = callback;
	}

	/**
	 * Handle a session update notification from ACP.
	 *
	 * This method is called by the ACP connection when the agent
	 * sends a session update.
	 *
	 * @param params - Session notification from ACP protocol
	 */
	handleSessionUpdate(params: acp.SessionNotification): void {
		const update = params.update;
		const sessionId = params.sessionId;

		this.logger.log("[MessageHandler] Session update:", {
			sessionId,
			type: update.sessionUpdate,
		});

		switch (update.sessionUpdate) {
			case "agent_message_chunk":
				this.handleAgentMessageChunk(sessionId, update);
				break;

			case "agent_thought_chunk":
				this.handleAgentThoughtChunk(sessionId, update);
				break;

			case "tool_call":
			case "tool_call_update":
				this.handleToolCall(sessionId, update);
				break;

			case "plan":
				this.handlePlan(sessionId, update);
				break;

			case "available_commands_update":
				this.handleAvailableCommandsUpdate(sessionId, update);
				break;

			case "current_mode_update":
				this.handleCurrentModeUpdate(sessionId, update);
				break;

			default:
				this.logger.warn(
					"[MessageHandler] Unknown update type:",
					update,
				);
		}
	}

	// ========================================================================
	// Private Methods - Update Handlers
	// ========================================================================

	private handleAgentMessageChunk(
		sessionId: string,
		update: acp.SessionUpdate,
	): void {
		if (
			update.sessionUpdate === "agent_message_chunk" &&
			update.content.type === "text"
		) {
			this.sessionUpdateCallback?.({
				type: "agent_message_chunk",
				sessionId,
				text: update.content.text,
			});
		}
	}

	private handleAgentThoughtChunk(
		sessionId: string,
		update: acp.SessionUpdate,
	): void {
		if (
			update.sessionUpdate === "agent_thought_chunk" &&
			update.content.type === "text"
		) {
			this.sessionUpdateCallback?.({
				type: "agent_thought_chunk",
				sessionId,
				text: update.content.text,
			});
		}
	}

	private handleToolCall(sessionId: string, update: acp.SessionUpdate): void {
		if (
			update.sessionUpdate === "tool_call" ||
			update.sessionUpdate === "tool_call_update"
		) {
			this.sessionUpdateCallback?.({
				type: update.sessionUpdate,
				sessionId,
				toolCallId: update.toolCallId,
				title: update.title ?? undefined,
				status: update.status || "pending",
				kind: update.kind ?? undefined,
				content: AcpTypeConverter.toToolCallContent(update.content),
				locations: update.locations ?? undefined,
			});
		}
	}

	private handlePlan(sessionId: string, update: acp.SessionUpdate): void {
		if (update.sessionUpdate === "plan") {
			this.sessionUpdateCallback?.({
				type: "plan",
				sessionId,
				entries: update.entries,
			});
		}
	}

	private handleAvailableCommandsUpdate(
		sessionId: string,
		update: acp.SessionUpdate,
	): void {
		if (update.sessionUpdate === "available_commands_update") {
			this.logger.log(
				"[MessageHandler] Available commands:",
				update.availableCommands,
			);

			const commands: SlashCommand[] = (
				update.availableCommands || []
			).map(
				(cmd: {
					name: string;
					description: string;
					input?: { hint?: string | null } | null;
				}) => ({
					name: cmd.name,
					description: cmd.description,
					hint: cmd.input?.hint ?? null,
				}),
			);

			this.sessionUpdateCallback?.({
				type: "available_commands_update",
				sessionId,
				commands,
			});
		}
	}

	private handleCurrentModeUpdate(
		sessionId: string,
		update: acp.SessionUpdate,
	): void {
		if (update.sessionUpdate === "current_mode_update") {
			this.logger.log(
				"[MessageHandler] Current mode update:",
				update.currentModeId,
			);

			this.sessionUpdateCallback?.({
				type: "current_mode_update",
				sessionId,
				currentModeId: update.currentModeId,
			});
		}
	}
}
