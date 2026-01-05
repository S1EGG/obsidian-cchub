import * as React from "react";
const { useState } = React;
import type AgentClientPlugin from "../../plugin";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface CollapsibleThoughtProps {
	text: string;
	plugin: AgentClientPlugin;
}

export function CollapsibleThought({ text, plugin }: CollapsibleThoughtProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			className="agent-client-collapsible-thought"
			onClick={() => setIsExpanded(!isExpanded)}
		>
			<div className="agent-client-collapsible-thought-header">
				<span
					className="agent-client-collapsible-thought-indicator"
					aria-hidden="true"
				/>
				<span className="agent-client-collapsible-thought-label">
					Thinking
				</span>
				<span className="agent-client-collapsible-thought-icon">
					{isExpanded ? "v" : ">"}
				</span>
			</div>
			{isExpanded && (
				<div className="agent-client-collapsible-thought-content">
					<MarkdownTextRenderer text={text} app={plugin.app} />
				</div>
			)}
		</div>
	);
}
