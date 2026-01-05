import * as acp from "@agentclientprotocol/sdk";
import type {
	PermissionOption,
	ToolCallLocation,
	ToolCallStatus,
	ToolKind,
} from "../../domain/models/chat-message";
import type { Logger } from "../../shared/logger";
import type CCHubPlugin from "../../plugin";

/**
 * Pending permission request entry in the queue.
 */
interface PendingPermissionEntry {
	requestId: string;
	toolCallId: string;
	options: PermissionOption[];
}

/**
 * Stored permission request with resolver.
 */
interface StoredPermissionRequest {
	resolve: (response: acp.RequestPermissionResponse) => void;
	toolCallId: string;
	options: PermissionOption[];
}

/**
 * Callback to update tool call message content in the UI.
 */
export type UpdateMessageCallback = (
	toolCallId: string,
	content: {
		type: "tool_call";
		toolCallId: string;
		title?: string;
		kind?: ToolKind;
		status?: ToolCallStatus;
		locations?: ToolCallLocation[] | null;
		permissionRequest?: {
			requestId: string;
			options: PermissionOption[];
			selectedOptionId?: string;
			isActive?: boolean;
			isCancelled?: boolean;
		};
	},
) => void;

/**
 * Handles permission request logic for ACP adapter.
 *
 * This class manages:
 * - Permission request queueing (only one active at a time)
 * - Auto-approval based on plugin settings
 * - User response handling
 * - Cancellation of pending requests
 */
export class AcpPermissionHandler {
	private pendingPermissionRequests = new Map<
		string,
		StoredPermissionRequest
	>();
	private pendingPermissionQueue: PendingPermissionEntry[] = [];
	private updateMessageCallback: UpdateMessageCallback;

	constructor(
		private plugin: CCHubPlugin,
		private logger: Logger,
	) {
		// Initialize with no-op callback
		this.updateMessageCallback = () => {};
	}

	/**
	 * Set the callback for updating message UI.
	 */
	setUpdateMessageCallback(callback: UpdateMessageCallback): void {
		this.updateMessageCallback = callback;
	}

	/**
	 * Handle a permission request from the agent.
	 *
	 * @param params - Permission request parameters from ACP
	 * @returns Promise that resolves when user responds or auto-approves
	 */
	async handlePermissionRequest(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		this.logger.log("[PermissionHandler] Permission request:", params);

		// Check if auto-approve is enabled
		if (this.shouldAutoApprove(params)) {
			return this.autoApprove(params);
		}

		// Manual approval required - add to queue
		return this.queuePermissionRequest(params);
	}

	/**
	 * Handle user's response to a permission request.
	 *
	 * @param requestId - ID of the permission request
	 * @param optionId - ID of the selected option
	 */
	handleUserResponse(requestId: string, optionId: string): void {
		const request = this.pendingPermissionRequests.get(requestId);
		if (!request) {
			this.logger.warn(
				"[PermissionHandler] Request not found:",
				requestId,
			);
			return;
		}

		const { resolve, toolCallId, options } = request;

		// Update UI to show selection
		this.updateMessageCallback(toolCallId, {
			type: "tool_call",
			toolCallId,
			permissionRequest: {
				requestId,
				options,
				selectedOptionId: optionId,
				isActive: false,
			},
		});

		// Resolve the promise
		resolve({
			outcome: {
				outcome: "selected",
				optionId,
			},
		});

		// Clean up
		this.pendingPermissionRequests.delete(requestId);
		this.pendingPermissionQueue = this.pendingPermissionQueue.filter(
			(entry) => entry.requestId !== requestId,
		);

		// Activate next permission in queue
		this.activateNextPermission();
	}

	/**
	 * Cancel all pending permission requests.
	 */
	cancelAll(): void {
		this.logger.log(
			`[PermissionHandler] Cancelling ${this.pendingPermissionRequests.size} pending requests`,
		);

		this.pendingPermissionRequests.forEach(
			({ resolve, toolCallId, options }, requestId) => {
				// Update UI to show cancelled state
				this.updateMessageCallback(toolCallId, {
					type: "tool_call",
					toolCallId,
					status: "completed",
					permissionRequest: {
						requestId,
						options,
						isCancelled: true,
						isActive: false,
					},
				});

				// Resolve with cancelled outcome
				resolve({
					outcome: {
						outcome: "cancelled",
					},
				});
			},
		);

		this.pendingPermissionRequests.clear();
		this.pendingPermissionQueue = [];
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Check if permission should be auto-approved based on settings.
	 */
	private shouldAutoApprove(params: acp.RequestPermissionRequest): boolean {
		const kind = params.toolCall?.kind;
		if (!kind) {
			return false;
		}
		const kindValue = String(kind);

		const { autoApproveRead, autoApproveList, autoApproveExecute } =
			this.plugin.settings;

		if (autoApproveRead && kindValue === "read") {
			return true;
		}
		if (
			autoApproveList &&
			(kindValue === "list" || kindValue === "search")
		) {
			return true;
		}
		if (autoApproveExecute && kindValue === "execute") {
			return true;
		}
		return false;
	}

	/**
	 * Auto-approve a permission request.
	 */
	private autoApprove(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		// Find the first allow option
		const allowOption =
			params.options.find(
				(option) =>
					option.kind === "allow_once" ||
					option.kind === "allow_always" ||
					(!option.kind &&
						option.name.toLowerCase().includes("allow")),
			) || params.options[0];

		if (!allowOption) {
			return Promise.resolve({
				outcome: {
					outcome: "cancelled",
				},
			});
		}

		this.logger.log(
			"[PermissionHandler] Auto-approving:",
			allowOption.name,
		);

		return Promise.resolve({
			outcome: {
				outcome: "selected",
				optionId: allowOption.optionId,
			},
		});
	}

	/**
	 * Queue a permission request for user approval.
	 */
	private queuePermissionRequest(
		params: acp.RequestPermissionRequest,
	): Promise<acp.RequestPermissionResponse> {
		const requestId = crypto.randomUUID();
		const toolCallId = params.toolCall?.toolCallId || crypto.randomUUID();
		const toolCall = params.toolCall;
		const kind = toolCall?.kind
			? (String(toolCall.kind) as ToolKind)
			: undefined;
		const status = (toolCall?.status || "pending") as ToolCallStatus;
		const title =
			typeof toolCall?.title === "string" ? toolCall.title : undefined;
		const locations = toolCall?.locations ?? undefined;

		// Normalize options
		const normalizedOptions: PermissionOption[] = params.options.map(
			(option) => {
				const normalizedKind =
					option.kind === "reject_always"
						? "reject_once"
						: option.kind;
				const kind: PermissionOption["kind"] = normalizedKind
					? normalizedKind
					: option.name.toLowerCase().includes("allow")
						? "allow_once"
						: "reject_once";

				return {
					optionId: option.optionId,
					name: option.name,
					kind,
				};
			},
		);

		const isFirstRequest = this.pendingPermissionQueue.length === 0;

		// Add to queue
		this.pendingPermissionQueue.push({
			requestId,
			toolCallId,
			options: normalizedOptions,
		});

		// Emit to UI (only first request is active)
		const permissionRequestData = {
			requestId,
			options: normalizedOptions,
			isActive: isFirstRequest,
		};

		this.updateMessageCallback(toolCallId, {
			type: "tool_call",
			toolCallId,
			title,
			kind,
			status,
			locations,
			permissionRequest: permissionRequestData,
		});

		// Return a Promise that will be resolved when user responds
		return new Promise((resolve) => {
			this.pendingPermissionRequests.set(requestId, {
				resolve,
				toolCallId,
				options: normalizedOptions,
			});
		});
	}

	/**
	 * Activate the next permission request in the queue.
	 */
	private activateNextPermission(): void {
		if (this.pendingPermissionQueue.length === 0) {
			return;
		}

		const next = this.pendingPermissionQueue[0];
		if (!next) {
			return;
		}

		const pending = this.pendingPermissionRequests.get(next.requestId);
		if (!pending) {
			return;
		}

		// Update UI to show as active
		this.updateMessageCallback(next.toolCallId, {
			type: "tool_call",
			toolCallId: next.toolCallId,
			permissionRequest: {
				requestId: next.requestId,
				options: pending.options,
				isActive: true,
			},
		});
	}
}
