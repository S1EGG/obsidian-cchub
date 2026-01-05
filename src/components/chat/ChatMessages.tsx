import * as React from "react";
const { useRef, useState, useEffect, useCallback } = React;

import type { ChatMessage } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type CCHubPlugin from "../../plugin";
import type { ChatView } from "./ChatView";
import { MessageRenderer } from "./MessageRenderer";

/**
 * Error information to display
 */
export interface ErrorInfo {
	title: string;
	message: string;
	suggestion?: string;
}

/**
 * Props for ChatMessages component
 */
export interface ChatMessagesProps {
	/** All messages in the current chat session */
	messages: ChatMessage[];
	/** Whether a message is currently being sent */
	isSending: boolean;
	/** Error information (if any) */
	errorInfo: ErrorInfo | null;
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
	/** Callback to clear the error */
	onClearError: () => void;
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
	errorInfo,
	plugin,
	view,
	acpClient,
	onApprovePermission,
	onClearError,
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

	return (
		<div ref={containerRef} className="cchub-chat-view-messages">
			{errorInfo ? (
				<div className="cchub-chat-error-container">
					<h4 className="cchub-chat-error-title">
						{errorInfo.title}
					</h4>
					<p className="cchub-chat-error-message">
						{errorInfo.message}
					</p>
					{errorInfo.suggestion && (
						<p className="cchub-chat-error-suggestion">
							💡 {errorInfo.suggestion}
						</p>
					)}
					<button
						onClick={onClearError}
						className="cchub-chat-error-button"
					>
						OK
					</button>
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
					{isSending && (
						<div className="cchub-loading-indicator">
							<div className="cchub-loading-pill">
								<span
									className="cchub-loading-spark"
									aria-hidden="true"
								/>
								<span className="cchub-loading-text">
									Thinking
								</span>
								<span
									className="cchub-loading-ellipsis"
									aria-hidden="true"
								>
									<span />
									<span />
									<span />
								</span>
							</div>
						</div>
					)}
				</>
			)}
		</div>
	);
}
