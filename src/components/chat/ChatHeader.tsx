import * as React from "react";
import { setIcon } from "obsidian";
import { Claude, Gemini, OpenAI } from "@lobehub/icons";
import { HeaderButton } from "./HeaderButton";
import { getAgentModuleById } from "../../domain/agents/agent-modules";
import type { AgentInfo } from "../../hooks/session/session-helpers";

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
	/** Available agents for new chat selection */
	availableAgents: AgentInfo[];
	/** Default agent id from settings */
	defaultAgentId: string;
	/** Whether the session is ready for user input */
	isSessionReady: boolean;
	/** Conversation title for display (placeholder until wired) */
	conversationTitle?: string;
	/** Callback to create a new chat session */
	onNewChat: (agentId?: string) => void;
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
	availableAgents,
	defaultAgentId,
	isSessionReady,
	conversationTitle,
	onNewChat,
	onExportChat,
	onOpenSettings,
}: ChatHeaderProps) {
	const [isMenuOpen, setIsMenuOpen] = React.useState(false);
	const menuRef = React.useRef<HTMLDivElement>(null);
	const iconRef = React.useRef<HTMLSpanElement>(null);

	React.useEffect(() => {
		if (iconRef.current) {
			setIcon(iconRef.current, "plus");
		}
	}, []);

	React.useEffect(() => {
		if (!isMenuOpen) {
			return;
		}

		const handleClickOutside = (event: MouseEvent) => {
			if (!menuRef.current) {
				return;
			}
			if (!menuRef.current.contains(event.target as Node)) {
				setIsMenuOpen(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsMenuOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isMenuOpen]);

	const handleToggleMenu = React.useCallback(() => {
		setIsMenuOpen((open) => !open);
	}, []);

	const handleSelectAgent = React.useCallback(
		(selectedAgentId: string) => {
			setIsMenuOpen(false);
			onNewChat(selectedAgentId);
		},
		[onNewChat],
	);

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
				<div
					ref={menuRef}
					className={`cchub-header-menu${isMenuOpen ? " cchub-header-menu--open" : ""}`}
				>
					<button
						type="button"
						className="cchub-header-button cchub-header-button--menu"
						title="New chat"
						aria-haspopup="menu"
						aria-expanded={isMenuOpen}
						onClick={handleToggleMenu}
					>
						<span
							ref={iconRef}
							className="cchub-header-button-icon"
							aria-hidden="true"
						/>
					</button>
					{isMenuOpen ? (
						<div className="cchub-header-dropdown" role="menu">
							{availableAgents.length === 0 ? (
								<div className="cchub-header-dropdown-empty">
									No agents configured
								</div>
							) : (
								availableAgents.map((agent) => {
									const label = agent.displayName || agent.id;
									const trimmed = label.trim();
									const monogram =
										trimmed.length > 0
											? trimmed.slice(0, 1).toUpperCase()
											: "?";
									const icon = getAgentIcon(agent.moduleId);
									const isDefault =
										agent.id === defaultAgentId;
									const isCurrent = agent.id === agentId;
									return (
										<button
											key={agent.id}
											role="menuitem"
											type="button"
											className={`cchub-header-dropdown-item${isCurrent ? " cchub-header-dropdown-item--current" : ""}`}
											onClick={() =>
												handleSelectAgent(agent.id)
											}
										>
											<span className="cchub-header-dropdown-icon">
												{icon ? (
													icon
												) : (
													<span className="cchub-header-dropdown-monogram">
														{monogram}
													</span>
												)}
											</span>
											<span className="cchub-header-dropdown-label">
												{label}
											</span>
											<span className="cchub-header-dropdown-tags">
												{isDefault ? (
													<span className="cchub-header-dropdown-tag">
														Default
													</span>
												) : null}
												{isCurrent ? (
													<span className="cchub-header-dropdown-tag cchub-header-dropdown-tag--current">
														Current
													</span>
												) : null}
											</span>
										</button>
									);
								})
							)}
						</div>
					) : null}
				</div>
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
