import * as React from "react";
const { useState } = React;
import type CCHubPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: CCHubPlugin;
}

export function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			className="cchub-collapsible-thought"
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div className="cchub-collapsible-thought-header">
				<span
					className="cchub-collapsible-thought-indicator"
					aria-hidden="true"
				/>
				<span className="cchub-collapsible-thought-label">
					Thinking
				</span>
				<span className="cchub-collapsible-thought-icon">
					{isExpanded ? "v" : ">"}
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
