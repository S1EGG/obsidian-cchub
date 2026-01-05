import * as React from "react";
import type { ToolKind } from "../../domain/models/chat-message";

type ToolIconKind = ToolKind | "other";

interface ToolIconProps {
	kind?: ToolIconKind;
}

const iconMap: Record<ToolIconKind, React.ReactNode> = {
	read: (
		<>
			<path d="M2 5h7a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2z" />
			<path d="M22 5h-7a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h8z" />
		</>
	),
	edit: (
		<>
			<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
			<path d="m15 5 4 4" />
		</>
	),
	delete: (
		<>
			<path d="M3 6h18" />
			<path d="M8 6V4h8v2" />
			<path d="M19 6l-1 14H6L5 6" />
			<path d="M10 11v6" />
			<path d="M14 11v6" />
		</>
	),
	move: (
		<>
			<path d="M7 7l-4 4 4 4" />
			<path d="M3 11h18" />
			<path d="M17 7l4 4-4 4" />
		</>
	),
	list: (
		<>
			<path d="M9 6h12" />
			<path d="M9 12h12" />
			<path d="M9 18h12" />
			<path d="M3 6h.01" />
			<path d="M3 12h.01" />
			<path d="M3 18h.01" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="M21 21l-4.35-4.35" />
		</>
	),
	execute: (
		<>
			<path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
			<path d="M6 9l3 3-3 3" />
			<path d="M11 15h4" />
		</>
	),
	think: (
		<>
			<path d="M9 18h6" />
			<path d="M10 22h4" />
			<path d="M12 2a7 7 0 0 0-4 12c1 1 1 2 1 3h6c0-1 0-2 1-3a7 7 0 0 0-4-12z" />
		</>
	),
	fetch: (
		<>
			<path d="M12 3v12" />
			<path d="M8 11l4 4 4-4" />
			<path d="M5 21h14" />
		</>
	),
	switch_mode: (
		<>
			<path d="M17 1l4 4-4 4" />
			<path d="M3 11V9a4 4 0 0 1 4-4h14" />
			<path d="M7 23l-4-4 4-4" />
			<path d="M21 13v2a4 4 0 0 1-4 4H3" />
		</>
	),
	other: (
		<>
			<circle cx="12" cy="12" r="7" />
			<path d="M12 8v4" />
			<path d="M12 16h.01" />
		</>
	),
};

export function ToolIcon({ kind }: ToolIconProps): React.ReactElement {
	const icon = iconMap[kind ?? "other"] ?? iconMap.other;
	return (
		<svg
			viewBox="0 0 24 24"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
		>
			{icon}
		</svg>
	);
}
