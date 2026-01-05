import * as React from "react";
const { useState, useMemo } = React;
import type { MessageContent } from "../../domain/models/chat-message";
import type { IAcpClient } from "../../adapters/acp/acp.adapter";
import type CCHubPlugin from "../../plugin";
import { TerminalRenderer } from "./TerminalRenderer";
import { PermissionRequestSection } from "./PermissionRequestSection";
import * as Diff from "diff";
import { ToolIcon } from "./ToolIcon";
import { MarkdownTextRenderer } from "./MarkdownTextRenderer";

interface ToolCallRendererProps {
	content: Extract<MessageContent, { type: "tool_call" }>;
	plugin: CCHubPlugin;
	acpClient?: IAcpClient;
	/** Callback to approve a permission request */
	onApprovePermission?: (
		requestId: string,
		optionId: string,
	) => Promise<void>;
}

export function ToolCallRenderer({
	content,
	plugin,
	acpClient,
	onApprovePermission,
}: ToolCallRendererProps) {
	const {
		kind,
		title,
		toolCallId,
		permissionRequest,
		content: toolContent,
	} = content;

	// Local state for selected option (for immediate UI feedback)
	const [selectedOptionId, setSelectedOptionId] = useState<
		string | undefined
	>(permissionRequest?.selectedOptionId);

	// Update selectedOptionId when permissionRequest changes
	React.useEffect(() => {
		if (permissionRequest?.selectedOptionId !== selectedOptionId) {
			setSelectedOptionId(permissionRequest?.selectedOptionId);
		}
	}, [permissionRequest?.selectedOptionId]);

	const kindLabel = getKindLabel(kind);
	const trimmedTitle = title?.trim() || "";
	const headerLabel =
		trimmedTitle.length > 0
			? kind
				? trimmedTitle.startsWith(kindLabel)
					? trimmedTitle
					: `${kindLabel} ${trimmedTitle}`
				: trimmedTitle
			: kindLabel;

	return (
		<div className="cchub-message-tool-call">
			{/* Header */}
			<div className="cchub-message-tool-call-header cchub-tool-row">
				<span className="cchub-tool-icon" aria-hidden="true">
					<ToolIcon kind={kind || "other"} />
				</span>
				<span className="cchub-tool-label">{headerLabel}</span>
			</div>

			{/* Kind-specific details */}
			{/* kind && (
				<div className="cchub-message-tool-call-details">
					<ToolCallDetails
						kind={kind}
						locations={locations}
						rawInput={rawInput}
						plugin={plugin}
					/>
				</div>
			)*/}

			{/* Tool call content (diffs, terminal output, etc.) */}
			{toolContent && toolContent.length > 0 && (
				<div className="cchub-tool-details">
					{toolContent.map((item, index) => {
						if (item.type === "terminal") {
							return (
								<TerminalRenderer
									key={index}
									terminalId={item.terminalId}
									acpClient={acpClient || null}
									plugin={plugin}
								/>
							);
						}
						if (item.type === "diff") {
							return (
								<DiffRenderer
									key={index}
									diff={item}
									plugin={plugin}
								/>
							);
						}
						if (item.type === "content") {
							if (item.content.type === "text") {
								return (
									<div
										key={index}
										className="cchub-tool-call-content"
									>
										<MarkdownTextRenderer
											text={item.content.text}
											app={plugin.app}
										/>
									</div>
								);
							}
							if (item.content.type === "image") {
								return (
									<div
										key={index}
										className="cchub-tool-call-content"
									>
										<div className="cchub-message-image">
											<img
												src={`data:${item.content.mimeType};base64,${item.content.data}`}
												alt="Tool output image"
												className="cchub-message-image-thumbnail"
											/>
										</div>
									</div>
								);
							}
						}
						return null;
					})}
				</div>
			)}

			{/* Permission request section */}
			{permissionRequest && (
				<div className="cchub-tool-details">
					<PermissionRequestSection
						permissionRequest={{
							...permissionRequest,
							selectedOptionId: selectedOptionId,
						}}
						toolCallId={toolCallId}
						plugin={plugin}
						onApprovePermission={onApprovePermission}
						onOptionSelected={setSelectedOptionId}
					/>
				</div>
			)}
		</div>
	);
}

function getKindLabel(kind?: string) {
	switch (kind) {
		case "read":
			return "Read";
		case "edit":
			return "Edit";
		case "delete":
			return "Delete";
		case "move":
			return "Move";
		case "search":
			return "Search";
		case "execute":
			return "Execute";
		case "think":
			return "Thinking";
		case "fetch":
			return "Fetch";
		case "switch_mode":
			return "Switch mode";
		default:
			return "Tool";
	}
}

/*
// Details component that switches based on kind
interface ToolCallDetailsProps {
	kind: string;
	locations?: { path: string; line?: number | null }[];
	rawInput?: { [k: string]: unknown };
	plugin: CCHubPlugin;
}

function ToolCallDetails({
	kind,
	locations,
	rawInput,
	plugin,
}: ToolCallDetailsProps) {
	switch (kind) {
		case "read":
			return <ReadDetails locations={locations} plugin={plugin} />;
		case "edit":
			return <EditDetails locations={locations} plugin={plugin} />;
		case "delete":
			return <DeleteDetails locations={locations} plugin={plugin} />;
		case "move":
			return <MoveDetails rawInput={rawInput} plugin={plugin} />;
		case "search":
			return <SearchDetails rawInput={rawInput} plugin={plugin} />;
		case "execute":
			return <ExecuteDetails rawInput={rawInput} plugin={plugin} />;
		case "fetch":
			return <FetchDetails rawInput={rawInput} plugin={plugin} />;
		default:
			return null;
	}
}

// Individual detail components for each kind
function ReadDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: CCHubPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="cchub-tool-call-read-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="cchub-tool-call-location">
					📄 {loc.path}
					{loc.line !== null && loc.line !== undefined && (
						<span className="cchub-tool-call-line">:{loc.line}</span>
					)}
				</div>
			))}
		</div>
	);
}

function EditDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: CCHubPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="cchub-tool-call-edit-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="cchub-tool-call-location">
					📝 Editing: {loc.path}
				</div>
			))}
		</div>
	);
}

function DeleteDetails({
	locations,
	plugin,
}: {
	locations?: { path: string; line?: number | null }[];
	plugin: CCHubPlugin;
}) {
	if (!locations || locations.length === 0) return null;

	return (
		<div className="cchub-tool-call-delete-details">
			{locations.map((loc, idx) => (
				<div key={idx} className="cchub-tool-call-location">
					🗑️ Deleting: {loc.path}
				</div>
			))}
		</div>
	);
}

function MoveDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: CCHubPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.from) {
		elements.push(<div key="from">From: {String(rawInput.from)}</div>);
	}
	if (rawInput.to) {
		elements.push(<div key="to">To: {String(rawInput.to)}</div>);
	}

	return <div className="cchub-tool-call-move-details">{elements}</div>;
}

function SearchDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: CCHubPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.query) {
		elements.push(
			<div key="query" className="cchub-tool-call-search-query">
				🔍 Query: "{String(rawInput.query)}"
			</div>,
		);
	}
	if (rawInput.pattern) {
		elements.push(
			<div key="pattern" className="cchub-tool-call-search-pattern">
				Pattern: {String(rawInput.pattern)}
			</div>,
		);
	}

	return <div className="cchub-tool-call-search-details">{elements}</div>;
}

function ExecuteDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: CCHubPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.command) {
		elements.push(
			<div key="command" className="cchub-tool-call-execute-command">
				💻 Command: <code>{String(rawInput.command)}</code>
			</div>,
		);
	}
	if (rawInput.cwd) {
		elements.push(
			<div key="cwd" className="cchub-tool-call-execute-cwd">
				Directory: {String(rawInput.cwd)}
			</div>,
		);
	}

	return <div className="cchub-tool-call-execute-details">{elements}</div>;
}

function FetchDetails({
	rawInput,
	plugin,
}: {
	rawInput?: { [k: string]: unknown };
	plugin: CCHubPlugin;
}) {
	if (!rawInput) return null;

	const elements = [];
	if (rawInput.url) {
		elements.push(
			<div key="url" className="cchub-tool-call-fetch-url">
				🌐 URL: {String(rawInput.url)}
			</div>,
		);
	}
	if (rawInput.query) {
		elements.push(
			<div key="query" className="cchub-tool-call-fetch-query">
				🔍 Search: "{String(rawInput.query)}"
			</div>,
		);
	}

	return <div className="cchub-tool-call-fetch-details">{elements}</div>;
}
*/

// Diff renderer component
interface DiffRendererProps {
	diff: {
		type: "diff";
		path: string;
		oldText?: string | null;
		newText: string;
	};
	plugin: CCHubPlugin;
}

/**
 * Represents a single line in a diff view
 * @property type - The type of change: added, removed, or unchanged context
 * @property oldLineNumber - Line number in the old file (undefined for added lines)
 * @property newLineNumber - Line number in the new file (undefined for removed lines)
 * @property content - The text content of the line
 * @property wordDiff - Optional word-level diff for lines that were modified (adjacent removed+added pairs)
 */
interface DiffLine {
	type: "added" | "removed" | "context";
	oldLineNumber?: number;
	newLineNumber?: number;
	content: string;
	wordDiff?: { type: "added" | "removed" | "context"; value: string }[];
}

/**
 * Check if the diff represents a new file (no old content)
 */
function isNewFile(diff: DiffRendererProps["diff"]): boolean {
	return (
		diff.oldText === null ||
		diff.oldText === undefined ||
		diff.oldText === ""
	);
}

// Helper function to map diff parts to our internal format
function mapDiffParts(
	parts: Diff.Change[],
): { type: "added" | "removed" | "context"; value: string }[] {
	return parts.map((part) => ({
		type: part.added ? "added" : part.removed ? "removed" : "context",
		value: part.value,
	}));
}

// Helper function to render word-level diffs
function renderWordDiff(
	wordDiff: { type: "added" | "removed" | "context"; value: string }[],
	lineType: "added" | "removed",
) {
	// Filter parts based on line type to avoid rendering null elements
	const filteredParts = wordDiff.filter((part) => {
		// For removed lines, skip added parts
		if (lineType === "removed" && part.type === "added") {
			return false;
		}
		// For added lines, skip removed parts
		if (lineType === "added" && part.type === "removed") {
			return false;
		}
		return true;
	});

	return (
		<>
			{filteredParts.map((part, partIdx) => {
				if (part.type === "added") {
					return (
						<span key={partIdx} className="cchub-diff-word-added">
							{part.value}
						</span>
					);
				} else if (part.type === "removed") {
					return (
						<span key={partIdx} className="cchub-diff-word-removed">
							{part.value}
						</span>
					);
				}
				return <span key={partIdx}>{part.value}</span>;
			})}
		</>
	);
}

// Number of context lines to show around changes
const CONTEXT_LINES = 3;

function DiffRenderer({ diff }: DiffRendererProps) {
	// Generate diff using the diff library
	const diffLines = useMemo(() => {
		if (isNewFile(diff)) {
			// New file - all lines are added
			const lines = diff.newText.split("\n");
			return lines.map(
				(line, idx): DiffLine => ({
					type: "added",
					newLineNumber: idx + 1,
					content: line,
				}),
			);
		}

		// Use structuredPatch to get a proper unified diff
		// At this point, oldText is guaranteed to be a non-empty string (checked by isNewFile)
		const oldText = diff.oldText || "";
		const patch = Diff.structuredPatch(
			"old",
			"new",
			oldText,
			diff.newText,
			"",
			"",
			{ context: CONTEXT_LINES },
		);

		const result: DiffLine[] = [];
		let oldLineNum = 0;
		let newLineNum = 0;

		// Process hunks
		for (const hunk of patch.hunks) {
			// Add hunk header only if there are multiple hunks
			// (helps users see gaps between different sections of changes)
			if (patch.hunks.length > 1) {
				result.push({
					type: "context",
					content: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
				});
			}

			oldLineNum = hunk.oldStart;
			newLineNum = hunk.newStart;

			for (const line of hunk.lines) {
				const marker = line[0];
				const content = line.substring(1);

				if (marker === "+") {
					result.push({
						type: "added",
						newLineNumber: newLineNum++,
						content,
					});
				} else if (marker === "-") {
					result.push({
						type: "removed",
						oldLineNumber: oldLineNum++,
						content,
					});
				} else {
					// Context line (unchanged)
					result.push({
						type: "context",
						oldLineNumber: oldLineNum++,
						newLineNumber: newLineNum++,
						content,
					});
				}
			}
		}

		// Add word-level diff for modified lines that are adjacent
		for (let i = 0; i < result.length - 1; i++) {
			const current = result[i];
			const next = result[i + 1];
			if (!current || !next) {
				continue;
			}

			// If we have a removed line followed by an added line, compute word diff
			if (current.type === "removed" && next.type === "added") {
				const wordDiff = Diff.diffWords(current.content, next.content);
				const mappedDiff = mapDiffParts(wordDiff);
				current.wordDiff = mappedDiff;
				next.wordDiff = mappedDiff;
			}
		}

		return result;
	}, [diff.oldText, diff.newText]);

	const renderLine = (line: DiffLine, idx: number) => {
		const isHunkHeader =
			line.type === "context" && line.content.startsWith("@@");

		if (isHunkHeader) {
			return (
				<div key={idx} className="cchub-diff-hunk-header">
					{line.content}
				</div>
			);
		}

		let lineClass = "cchub-diff-line";
		let marker = " ";

		if (line.type === "added") {
			lineClass += " cchub-diff-line-added";
			marker = "+";
		} else if (line.type === "removed") {
			lineClass += " cchub-diff-line-removed";
			marker = "-";
		} else {
			lineClass += " cchub-diff-line-context";
		}

		return (
			<div key={idx} className={lineClass}>
				<span className="cchub-diff-line-number cchub-diff-line-number-old">
					{line.oldLineNumber ?? ""}
				</span>
				<span className="cchub-diff-line-number cchub-diff-line-number-new">
					{line.newLineNumber ?? ""}
				</span>
				<span className="cchub-diff-line-marker">{marker}</span>
				<span className="cchub-diff-line-content">
					{line.wordDiff &&
					(line.type === "added" || line.type === "removed")
						? renderWordDiff(line.wordDiff, line.type)
						: line.content}
				</span>
			</div>
		);
	};

	return (
		<div className="cchub-tool-call-diff">
			{isNewFile(diff) ? (
				<div className="cchub-diff-line-info">New file</div>
			) : null}
			<div className="cchub-tool-call-diff-content">
				{diffLines.map((line, idx) => renderLine(line, idx))}
			</div>
		</div>
	);
}
