import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type CCHubPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import { MessageRenderer } from "./MessageRenderer";
import type { ErrorInfo as BaseErrorInfo } from "../../domain/models/agent-error";

/**
 * Error source types for display.
 */
export type ErrorSource = "session" | "chat" | "permission";

export interface ErrorAction {
	label: string;
	onClick: () => void;
	variant?: "primary" | "secondary";
}

export interface ErrorDisplayInfo extends BaseErrorInfo {
	source: ErrorSource;
	sourceLabel: string;
	actions: ErrorAction[];
}

/**
 * Props for ChatMessages component
 */
export interface ChatMessagesProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Whether we are waiting for the first agent response */
	isAwaitingResponse: boolean;
	/** Error information (if any) */
	errorInfo: ErrorDisplayInfo | null;
	/** Plugin instance */
	plugin: CCHubPlugin;
	/** View instance for event registration */
	view: ChatView;
	/** ACP client for terminal operations */
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

/**
 * Messages container component for the chat view.
 *
 * Handles:
 * - Message list rendering
 * - Auto-scroll behavior
 * - Error display
 * - Empty state display
 * - Loading indicator
 */
export function ChatMessages({
	messages,
	isSending,
	isAwaitingResponse,
	errorInfo,
	plugin,
	view,
	acpClient,
	onApprovePermission,
}: ChatMessagesProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [isAtBottom, setIsAtBottom] = useState(true);

	/**
	 * Check if the scroll position is near the bottom.
	 */
	const checkIfAtBottom = useCallback(() => {
		const container = containerRef.current;
		if (!container) return true;

		const threshold = 50;
		const isNearBottom =
			container.scrollTop + container.clientHeight >=
			container.scrollHeight - threshold;
		setIsAtBottom(isNearBottom);
		return isNearBottom;
	}, []);

	/**
	 * Scroll to the bottom of the container.
	 */
	const scrollToBottom = useCallback(() => {
		const container = containerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Auto-scroll when messages change
	useEffect(() => {
		if (isAtBottom && messages.length > 0) {
			// Use setTimeout to ensure DOM has updated
			window.setTimeout(() => {
				scrollToBottom();
			}, 0);
		}
	}, [messages, isAtBottom, scrollToBottom]);

	// Set up scroll event listener
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const handleScroll = () => {
			checkIfAtBottom();
		};

		view.registerDomEvent(container, "scroll", handleScroll);

		// Initial check
		checkIfAtBottom();
	}, [view, checkIfAtBottom]);

	const lastMessageId =
		messages.length > 0 ? messages[messages.length - 1]?.id : null;
	const lastMessage = messages[messages.length - 1];
	const shouldShowThinkingPlaceholder =
		isAwaitingResponse && (!lastMessage || lastMessage.role === "user");

	return (
		<div ref={containerRef} className="cchub-chat-view-messages">
			{errorInfo ? (
				<div className="cchub-chat-error-container" role="alert">
					<div className="cchub-chat-error-header">
						<span
							className="cchub-chat-error-icon"
							aria-hidden="true"
						>
							⚠️
						</span>
						<div className="cchub-chat-error-meta">
							<h4 className="cchub-chat-error-title">
								{errorInfo.title}
							</h4>
							<div className="cchub-chat-error-source">
								{errorInfo.sourceLabel}
							</div>
						</div>
					</div>

					<div className="cchub-chat-error-section">
						<div className="cchub-chat-error-section-title">
							What happened
						</div>
						<p className="cchub-chat-error-message">
							{errorInfo.message}
						</p>
					</div>

					{errorInfo.suggestion && (
						<div className="cchub-chat-error-section">
							<div className="cchub-chat-error-section-title">
								Suggested fix
							</div>
							<p className="cchub-chat-error-suggestion">
								{errorInfo.suggestion}
							</p>
						</div>
					)}

					{errorInfo.actions.length > 0 && (
						<div className="cchub-chat-error-actions">
							{errorInfo.actions.map((action, index) => (
								<button
									type="button"
									key={`${action.label}-${index}`}
									onClick={action.onClick}
									className={`cchub-chat-error-button ${action.variant === "primary" ? "cchub-chat-error-button--primary" : "cchub-chat-error-button--secondary"}`}
								>
									{action.label}
								</button>
							))}
						</div>
					)}
				</div>
			) : messages.length === 0 ? (
				<div className="cchub-chat-empty-state" aria-hidden="true" />
			) : (
				<>
					{messages.map((message) => (
						<MessageRenderer
							key={message.id}
							message={message}
							plugin={plugin}
							acpClient={acpClient}
							isLatest={message.id === lastMessageId}
							isSending={isSending}
							onApprovePermission={onApprovePermission}
						/>
					))}
					{shouldShowThinkingPlaceholder && (
						<MessageRenderer
							key="cchub-thinking-placeholder"
							message={{
								id: "cchub-thinking-placeholder",
								role: "assistant",
								content: [
									{
										type: "agent_thought",
										text: "",
									},
								],
								timestamp: new Date(),
							}}
							plugin={plugin}
							acpClient={acpClient}
							isLatest={true}
							isSending={true}
							onApprovePermission={onApprovePermission}
						/>
					)}
				</>
			)}
		</div>
	);
}
