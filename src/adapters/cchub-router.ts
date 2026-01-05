import type {
	AgentConfig,
	ICCHubClient,
	InitializeResult,
	NewSessionResult,
} from "../domain/ports/cchub.port";
import type { SessionUpdate } from "../domain/models/session-update";
import type { AgentError } from "../domain/models/agent-error";
import type { PromptContent } from "../domain/models/prompt-content";
import type CCHubPlugin from "../plugin";
import { AcpAdapter } from "./acp/acp.adapter";
import { CodexAdapter } from "./codex/codex.adapter";

export class CCHubRouter implements ICCHubClient {
	private activeClient: ICCHubClient | null = null;

	constructor(
		private plugin: CCHubPlugin,
		private acpAdapter: AcpAdapter,
		private codexAdapter: CodexAdapter,
	) {}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		const selected = this.selectClient(config);
		if (this.activeClient && this.activeClient !== selected) {
			await this.activeClient.disconnect();
		}
		this.activeClient = selected;
		return await selected.initialize(config);
	}

	async newSession(workingDirectory: string): Promise<NewSessionResult> {
		return await this.getActiveClient().newSession(workingDirectory);
	}

	async authenticate(methodId: string): Promise<boolean> {
		return await this.getActiveClient().authenticate(methodId);
	}

	async sendPrompt(
		sessionId: string,
		content: PromptContent[],
	): Promise<void> {
		return await this.getActiveClient().sendPrompt(sessionId, content);
	}

	async cancel(sessionId: string): Promise<void> {
		return await this.getActiveClient().cancel(sessionId);
	}

	async disconnect(): Promise<void> {
		if (!this.activeClient) {
			return;
		}
		await this.activeClient.disconnect();
		this.activeClient = null;
	}

	onSessionUpdate(callback: (update: SessionUpdate) => void): void {
		this.acpAdapter.onSessionUpdate(callback);
		this.codexAdapter.onSessionUpdate(callback);
	}

	onError(callback: (error: AgentError) => void): void {
		this.acpAdapter.onError(callback);
		this.codexAdapter.onError(callback);
	}

	async respondToPermission(
		requestId: string,
		optionId: string,
	): Promise<void> {
		return await this.getActiveClient().respondToPermission(
			requestId,
			optionId,
		);
	}

	isInitialized(): boolean {
		return this.activeClient?.isInitialized() ?? false;
	}

	getCurrentAgentId(): string | null {
		return this.activeClient?.getCurrentAgentId() ?? null;
	}

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		return await this.getActiveClient().setSessionMode(sessionId, modeId);
	}

	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		return await this.getActiveClient().setSessionModel(sessionId, modelId);
	}

	private getActiveClient(): ICCHubClient {
		if (!this.activeClient) {
			throw new Error("No active agent client initialized");
		}
		return this.activeClient;
	}

	private selectClient(config: AgentConfig): ICCHubClient {
		console.debug("[CCHubRouter] selectClient:", {
			configId: config.id,
			codexId: this.plugin.settings.codex.id,
			command: config.command,
			isCodexAcp: this.isCodexAcpCommand(config.command),
		});
		if (config.id === this.plugin.settings.codex.id) {
			if (this.isCodexAcpCommand(config.command)) {
				console.debug(
					"[CCHubRouter] Using AcpAdapter for Codex (codex-acp command)",
				);
				return this.acpAdapter;
			}
			console.debug("[CCHubRouter] Using CodexAdapter");
			return this.codexAdapter;
		}
		console.debug("[CCHubRouter] Using AcpAdapter (default)");
		return this.acpAdapter;
	}

	private isCodexAcpCommand(command: string): boolean {
		const normalized = command.trim().toLowerCase();
		return normalized.includes("codex-acp");
	}
}
