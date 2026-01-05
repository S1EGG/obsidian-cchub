import * as React from "react";
import { Claude, Gemini, OpenAI } from "@lobehub/icons";
import { HeaderButton } from "./HeaderButton";
import { getAgentModuleById } from "../../domain/agents/agent-modules";

/**
 * Props for ChatHeader component
 */
export interface ChatHeaderProps {
	/** Active agent id */
	agentId: string;
	/** Display name of the active agent */
	agentLabel: string;
	/** Module id for the active agent */
	agentModuleId?: string;
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
	agentModuleId,
	isSessionReady,
	conversationTitle,
	onNewChat,
	onExportChat,
	onOpenSettings,
}: ChatHeaderProps) {
	const badge = buildAgentBadge(
		agentId,
		agentLabel,
		agentModuleId,
		!isSessionReady,
	);
	const statusLabel = isSessionReady
		? conversationTitle?.trim() || "Untitled conversation"
		: "Loading...";
	const statusClass = `cchub-chat-view-header-status${!isSessionReady ? " cchub-chat-view-header-status--loading" : ""}`;
	return (
		<div className="cchub-chat-view-header">
			<div className="cchub-chat-view-header-title">
				{badge}
				<span className={statusClass}>{statusLabel}</span>
			</div>
			<div className="cchub-chat-view-header-actions">
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
	agentModuleId: string | undefined,
	isLoading: boolean,
) {
	const icon = getAgentIcon(agentModuleId);
	const isBuiltin = icon !== null;
	const trimmed = agentLabel.trim();
	const monogram =
		trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : "?";
	const badgeClass = icon
		? "cchub-agent-badge cchub-agent-badge--icon"
		: "cchub-agent-badge";
	const loadingClass = isLoading ? " cchub-agent-badge--loading" : "";

	return (
		<div
			className={`${badgeClass}${loadingClass}`}
			title={trimmed || agentId}
			data-agent-id={agentId}
		>
			{icon ? (
				<span className="cchub-agent-logo" aria-hidden="true">
					{icon}
				</span>
			) : (
				<span className="cchub-agent-monogram">{monogram}</span>
			)}
			{isBuiltin ? (
				<span className="sr-only">{trimmed}</span>
			) : (
				<span className="cchub-agent-label">{trimmed || agentId}</span>
			)}
		</div>
	);
}

function getAgentIcon(agentModuleId?: string) {
	const module = agentModuleId ? getAgentModuleById(agentModuleId) : null;
	const iconId = module?.iconId;
	const iconSize = 16;
	switch (iconId) {
		case "claude":
			return <Claude size={iconSize} />;
		case "openai":
			return <OpenAI size={iconSize} />;
		case "gemini":
			return <Gemini size={iconSize} />;
		default:
			return null;
	}
}
