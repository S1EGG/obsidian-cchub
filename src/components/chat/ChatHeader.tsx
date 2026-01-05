import * as React from "react";
import { Claude, Gemini, OpenAI } from "@lobehub/icons";
import { HeaderButton } from "./HeaderButton";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Active agent id */
	agentId: string;
	/** Display name of the active agent */
	agentLabel: string;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Conversation title for display (placeholder until wired) */
	conversationTitle?: string;
	/** Callback to create a new chat session */
	onNewChat: () => void;
	/** Callback to export the chat */
	onExportChat: () => void;
	/** Callback to open settings */
	onOpenSettings: () => void;
}

/**
 * Header component for the chat view.
 *
 * Displays:
 * - Agent name
 * - Update notification (if available)
 * - Action buttons (new chat, export, settings)
 */
export function ChatHeader({
	agentId,
	agentLabel,
	isSessionReady,
	conversationTitle,
	onNewChat,
	onExportChat,
	onOpenSettings,
}: ChatHeaderProps) {
	const badge = buildAgentBadge(agentId, agentLabel, !isSessionReady);
	const statusLabel = isSessionReady
		? conversationTitle?.trim() || "Untitled conversation"
		: "Loading...";
	const statusClass = `agent-client-chat-view-header-status${!isSessionReady ? " agent-client-chat-view-header-status--loading" : ""}`;
	return (
		<div className="agent-client-chat-view-header">
			<div className="agent-client-chat-view-header-title">
				{badge}
				<span className={statusClass}>{statusLabel}</span>
			</div>
			<div className="agent-client-chat-view-header-actions">
				<HeaderButton
					iconName="plus"
					tooltip="New chat"
					onClick={onNewChat}
				/>
				<HeaderButton
					iconName="save"
					tooltip="Export chat to Markdown"
					onClick={onExportChat}
				/>
				<HeaderButton
					iconName="settings"
					tooltip="Settings"
					onClick={onOpenSettings}
				/>
			</div>
		</div>
	);
}

function buildAgentBadge(
	agentId: string,
	agentLabel: string,
	isLoading: boolean,
) {
	const icon = getAgentIcon(agentId);
	const isBuiltin = icon !== null;
	const trimmed = agentLabel.trim();
	const monogram =
		trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
	const badgeClass = icon
		? "agent-client-agent-badge agent-client-agent-badge--icon"
		: "agent-client-agent-badge";
	const loadingClass = isLoading ? " agent-client-agent-badge--loading" : "";

	return (
		<div
			className={`${badgeClass}${loadingClass}`}
			title={trimmed || agentId}
			data-agent-id={agentId}
		>
			{icon ? (
				<span className="agent-client-agent-logo" aria-hidden="true">
					{icon}
				</span>
			) : (
				<span className="agent-client-agent-monogram">{monogram}</span>
			)}
			{isBuiltin ? (
				<span className="sr-only">{trimmed}</span>
			) : (
				<span className="agent-client-agent-label">
					{trimmed || agentId}
				</span>
			)}
		</div>
	);
}

function getAgentIcon(agentId: string) {
	const iconSize = 16;
	switch (agentId) {
		case "claude-code-acp":
			return <Claude size={iconSize} />;
		case "codex-acp":
			return <OpenAI size={iconSize} />;
		case "gemini-cli":
			return <Gemini size={iconSize} />;
		default:
			return null;
	}
}
