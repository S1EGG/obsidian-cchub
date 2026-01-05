import * as React from "react";
const { useState } = React;
import type CCHubPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";
import { ToolIcon } from "./ToolIcon";

interface CollapsibleThoughtProps {
	text: string;
	plugin: CCHubPlugin;
	isActive?: boolean;
}

export function CollapsibleThought({
	text,
	plugin,
	isActive = false,
}: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const iconClass = `cchub-tool-icon${isActive ? " cchub-tool-icon--active" : ""}`;

	return (
		<div
			className="cchub-collapsible-thought"
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div className="cchub-collapsible-thought-header cchub-tool-row">
				<span className={iconClass} aria-hidden="true">
					<ToolIcon kind="think" />
				</span>
				<span className="cchub-tool-label">Thinking</span>
				<span className="cchub-collapsible-thought-icon">
					<ToolIcon kind="chevron-down" />
				</span>
			</div>
			{isExpanded && (
				<div className="cchub-collapsible-thought-content">
					<MarkdownTextRenderer text={text} app={plugin.app} />
				</div>
			)}
		</div>
	);
}
