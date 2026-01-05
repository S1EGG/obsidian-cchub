import { spawn, execSync, type ChildProcess } from "child_process";
import { Platform } from "obsidian";
import type { Logger } from "../../shared/logger";

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: number;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export interface CodexEventEnvelope {
	method: string;
	params?: unknown;
	id?: number;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId?: NodeJS.Timeout;
}

export interface CodexConnectionError {
	message: string;
	type?: "network" | "stream" | "timeout" | "process";
	details?: unknown;
}

export class CodexConnection {
	private child: ChildProcess | null = null;
	private nextId = 0;
	private pending = new Map<number, PendingRequest>();
	private elicitationMap = new Map<string, number>();
	private detectedVersion: string | null = null;
	private stdoutBuffer = Buffer.alloc(0);

	public onEvent: (evt: CodexEventEnvelope) => void = () => {};
	public onError: (error: CodexConnectionError) => void = () => {};

	constructor(private logger: Logger) {}

	getVersion(): string | null {
		return this.detectedVersion;
	}

	async start(
		cliPath: string,
		cwd: string,
		args: string[] = [],
		env?: NodeJS.ProcessEnv,
	): Promise<void> {
		if (this.child) {
			this.stop();
		}

		const finalArgs =
			args.length > 0 ? args : this.detectMcpCommand(cliPath);
		const isWindows = Platform.isWin;
		const baseEnv: NodeJS.ProcessEnv = {
			...process.env,
			...env,
			CODEX_NO_INTERACTIVE: "1",
			CODEX_AUTO_CONTINUE: "1",
		};
		let spawnCommand = cliPath;
		let spawnArgs = finalArgs;

		// Always use login shell on macOS/Linux to ensure proper PATH and env setup
		// This is necessary because GUI apps (like Obsidian) don't inherit shell environment
		if (!isWindows) {
			const shell = Platform.isMacOS ? "/bin/zsh" : "/bin/bash";
			const commandString = [cliPath, ...finalArgs]
				.map((arg) => "'" + arg.replace(/'/g, "'\\''") + "'")
				.join(" ");
			// Use login shell which will source ~/.zshrc or ~/.bashrc to get proper PATH
			// Don't override PATH - let the login shell set it up properly
			spawnCommand = shell;
			spawnArgs = ["-l", "-c", commandString];
		}

		console.debug("[CodexConnection] Starting with:", {
			spawnCommand,
			spawnArgs,
			cwd,
			cliPath,
			finalArgs,
		});

		return await new Promise((resolve, reject) => {
			try {
				this.child = spawn(spawnCommand, spawnArgs, {
					cwd,
					stdio: ["pipe", "pipe", "pipe"],
					env: baseEnv,
					shell: isWindows,
				});

				this.child.on("error", (error) => {
					reject(
						new Error(
							`Failed to start codex process: ${error.message}`,
						),
					);
				});

				let stderrBuffer = "";
				let hasExited = false;
				let exitCode: number | null = null;
				let exitSignal: string | null = null;

				this.child.on("exit", (code, signal) => {
					console.debug("[CodexConnection] Process exited:", {
						code,
						signal,
					});
					hasExited = true;
					exitCode = code;
					exitSignal = signal as string | null;
					if (code !== 0 && code !== null) {
						this.onError({
							message: `Codex process exited (code: ${code}, signal: ${signal})`,
							type: "process",
							details: { code, signal },
						});
					}
					this.stop();
				});

				this.child.stderr?.on("data", (data: Buffer | string) => {
					const errorMsg = data.toString();
					stderrBuffer += errorMsg;
					console.debug("[CodexConnection] stderr:", errorMsg);
				});

				this.child.stdin?.on("error", (error) => {
					const errno = error as NodeJS.ErrnoException;
					if (errno.code === "EPIPE") {
						this.logger.warn(
							"[CodexConnection] stdin closed (EPIPE)",
						);
						return;
					}
					this.logger.error("[CodexConnection] stdin error:", error);
				});

				this.child.stdout?.on("data", (data: Buffer | string) => {
					this.processStdoutChunk(data);
				});

				// Check process status with longer timeout and better error messages
				const checkInterval = 100;
				const maxWaitTime = 5000;
				let elapsed = 0;

				const checkProcess = () => {
					elapsed += checkInterval;

					if (hasExited) {
						// Process exited - provide detailed error message
						let errorMessage =
							"Codex process failed to start or exited during startup";
						if (exitCode === 127) {
							errorMessage =
								"Codex command not found. Please verify the Codex CLI is installed and the path is correct.";
						} else if (exitCode !== null && exitCode !== 0) {
							errorMessage = `Codex process exited with code ${exitCode}`;
							if (stderrBuffer.trim()) {
								errorMessage += `: ${stderrBuffer.trim().slice(0, 500)}`;
							}
						} else if (exitSignal) {
							errorMessage = `Codex process was killed by signal ${exitSignal}`;
						} else if (stderrBuffer.trim()) {
							errorMessage += `: ${stderrBuffer.trim().slice(0, 500)}`;
						}
						reject(new Error(errorMessage));
						return;
					}

					if (this.child && !this.child.killed) {
						// Process is still running - success
						resolve();
						return;
					}

					if (elapsed >= maxWaitTime) {
						// Timeout - process didn't start properly
						reject(
							new Error(
								"Codex process failed to start within timeout period",
							),
						);
						return;
					}

					// Keep checking
					setTimeout(checkProcess, checkInterval);
				};

				setTimeout(checkProcess, checkInterval);
			} catch (error) {
				reject(error as Error);
			}
		});
	}

	stop(): void {
		if (this.child) {
			this.child.kill();
			this.child = null;
		}
		for (const [id, pending] of this.pending) {
			pending.reject(new Error("Codex connection closed"));
			if (pending.timeoutId) {
				clearTimeout(pending.timeoutId);
			}
			this.pending.delete(id);
		}
		this.elicitationMap.clear();
	}

	request<T = unknown>(
		method: string,
		params?: unknown,
		timeoutMs = 60000,
	): Promise<T> {
		const id = this.nextId++;
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		console.debug("[CodexConnection] Sending request:", { id, method });

		return new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.pending.delete(id);
				const error = new Error(
					`Codex request timed out: ${method} (${timeoutMs}ms)`,
				);
				this.onError({
					message: error.message,
					type: "timeout",
					details: { method, timeoutMs },
				});
				reject(error);
			}, timeoutMs);

			this.pending.set(id, { resolve, reject, timeoutId });

			const line = JSON.stringify(request) + "\n";
			if (
				this.child?.stdin &&
				this.child.stdin.writable &&
				!this.child.stdin.destroyed
			) {
				try {
					this.child.stdin.write(line);
				} catch (error) {
					const errno = error as NodeJS.ErrnoException;
					if (errno.code === "EPIPE") {
						this.logger.warn(
							"[CodexConnection] stdin closed while writing request",
						);
					} else {
						this.logger.error(
							"[CodexConnection] failed to write request:",
							error,
						);
					}
				}
			} else {
				clearTimeout(timeoutId);
				this.pending.delete(id);
				reject(new Error("Codex stdin not available"));
			}
		});
	}

	notify(method: string, params?: unknown): void {
		const msg: JsonRpcRequest = {
			jsonrpc: "2.0",
			method,
			params,
		};
		const line = JSON.stringify(msg) + "\n";
		if (
			this.child?.stdin &&
			this.child.stdin.writable &&
			!this.child.stdin.destroyed
		) {
			try {
				this.child.stdin.write(line);
			} catch (error) {
				const errno = error as NodeJS.ErrnoException;
				if (errno.code === "EPIPE") {
					this.logger.warn(
						"[CodexConnection] stdin closed while sending notify",
					);
				} else {
					this.logger.error(
						"[CodexConnection] failed to send notify:",
						error,
					);
				}
			}
		}
	}

	respondElicitation(
		callId: string,
		decision: "approved" | "approved_for_session" | "denied" | "abort",
	): void {
		const normalized = callId
			.replace(/^patch_/, "")
			.replace(/^elicitation_/, "");
		const reqId =
			this.elicitationMap.get(normalized) ||
			this.elicitationMap.get(callId);
		if (reqId === undefined) {
			return;
		}
		const response: JsonRpcResponse = {
			jsonrpc: "2.0",
			id: reqId,
			result: { decision },
		};
		const line = JSON.stringify(response) + "\n";
		if (
			this.child?.stdin &&
			this.child.stdin.writable &&
			!this.child.stdin.destroyed
		) {
			try {
				this.child.stdin.write(line);
			} catch (error) {
				const errno = error as NodeJS.ErrnoException;
				if (errno.code === "EPIPE") {
					this.logger.warn(
						"[CodexConnection] stdin closed while responding",
					);
				} else {
					this.logger.error(
						"[CodexConnection] failed to respond:",
						error,
					);
				}
			}
		}
		this.elicitationMap.delete(normalized);
		this.elicitationMap.delete(callId);
	}

	async waitForServerReady(timeoutMs = 30000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const isReady = await this.ping(3000);
			if (isReady) {
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
		const error = new Error(
			`Timeout waiting for Codex server to be ready (${timeoutMs}ms)`,
		);
		this.onError({
			message: error.message,
			type: "timeout",
			details: { timeoutMs },
		});
		throw error;
	}

	async ping(timeoutMs = 5000): Promise<boolean> {
		try {
			await this.request("ping", {}, timeoutMs);
			return true;
		} catch {
			return false;
		}
	}

	private processStdoutChunk(data: Buffer | string): void {
		const chunkBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
		this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunkBuffer]);

		while (this.stdoutBuffer.length > 0) {
			const headerIndex = this.stdoutBuffer.indexOf("Content-Length:");
			let hasHeader = false;
			if (headerIndex === 0) {
				hasHeader = true;
			} else if (headerIndex > 0) {
				const prefix = this.stdoutBuffer
					.slice(0, headerIndex)
					.toString("utf8");
				if (/^[\r\n\s]*$/.test(prefix)) {
					this.stdoutBuffer = this.stdoutBuffer.slice(headerIndex);
					hasHeader = true;
				}
			}

			if (hasHeader) {
				const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) {
					return;
				}
				const headerText = this.stdoutBuffer
					.slice(0, headerEnd)
					.toString("utf8");
				const match = /content-length:\s*(\d+)/i.exec(headerText);
				if (!match) {
					this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
					continue;
				}
				const length = Number(match[1]);
				const totalLength = headerEnd + 4 + length;
				if (this.stdoutBuffer.length < totalLength) {
					return;
				}
				const body = this.stdoutBuffer
					.slice(headerEnd + 4, totalLength)
					.toString("utf8");
				this.stdoutBuffer = this.stdoutBuffer.slice(totalLength);
				this.tryHandleRawMessage(body);
				continue;
			}

			const newlineIndex = this.stdoutBuffer.indexOf("\n");
			if (newlineIndex === -1) {
				return;
			}
			const line = this.stdoutBuffer.slice(0, newlineIndex);
			this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
			const trimmed = line.toString("utf8").trim();
			if (!trimmed) {
				continue;
			}
			this.tryHandleRawMessage(trimmed);
		}
	}

	private tryHandleRawMessage(raw: string): void {
		if (!raw.startsWith("{")) {
			return;
		}
		try {
			const msg = JSON.parse(raw) as JsonRpcRequest | JsonRpcResponse;
			this.handleIncoming(msg);
		} catch {
			console.debug(
				"[CodexConnection] Failed to parse JSON:",
				raw.slice(0, 200),
			);
		}
	}

	private handleIncoming(msg: JsonRpcRequest | JsonRpcResponse): void {
		if (msg && typeof msg === "object") {
			if ("id" in msg && ("result" in msg || "error" in msg)) {
				const response = msg;
				console.debug(
					"[CodexConnection] Received response for id:",
					response.id,
					"pending ids:",
					Array.from(this.pending.keys()),
				);
				const pending = this.pending.get(response.id);
				if (!pending) {
					console.debug(
						"[CodexConnection] No pending request for id:",
						response.id,
					);
					return;
				}
				this.pending.delete(response.id);
				if (pending.timeoutId) {
					clearTimeout(pending.timeoutId);
				}

				if (response.error) {
					pending.reject(
						new Error(response.error.message || "Codex error"),
					);
					return;
				}

				pending.resolve(response.result);
				return;
			}

			if ("method" in msg) {
				const envelope = msg as CodexEventEnvelope;
				this.captureElicitationMapping(envelope);
				this.onEvent(envelope);
			}
		}
	}

	private captureElicitationMapping(envelope: CodexEventEnvelope): void {
		if (!envelope.method || envelope.id === undefined) {
			return;
		}

		if (envelope.method.endsWith("elicitation/create")) {
			const params = envelope.params as Record<string, unknown> | null;
			const callId =
				(params?.codex_call_id as string | undefined) ||
				(params?.call_id as string | undefined) ||
				`elicitation_${envelope.id}`;
			if (callId) {
				this.elicitationMap.set(callId, envelope.id);
			}
			return;
		}

		if (envelope.method === "codex/event") {
			const params = envelope.params as Record<string, unknown> | null;
			const msg = params?.msg as Record<string, unknown> | undefined;
			if (!msg) {
				return;
			}
			const msgType = msg.type;
			if (
				msgType === "exec_approval_request" ||
				msgType === "apply_patch_approval_request"
			) {
				const callId = msg.call_id as string | undefined;
				if (callId) {
					this.elicitationMap.set(callId, envelope.id);
				}
			}
		}
	}

	private detectMcpCommand(cliPath: string): string[] {
		try {
			const versionOutput = execSync(`${cliPath} --version`, {
				encoding: "utf8",
				timeout: 5000,
				stdio: ["pipe", "pipe", "ignore"],
			}).trim();

			const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
			if (match) {
				this.detectedVersion = match[0];
				const major = Number(match[1]);
				const minor = Number(match[2]);
				if (major > 0 || (major === 0 && minor >= 40)) {
					return ["mcp-server"];
				}
				return ["mcp", "serve"];
			}
		} catch {
			// Ignore version detection errors
		}

		return ["mcp-server"];
	}
}
