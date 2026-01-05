import {
	App,
	PluginSettingTab,
	Setting,
	DropdownComponent,
	Platform,
} from "obsidian";
import type CCHubPlugin from "../../plugin";
import type {
	AgentEnvVar,
	AgentProfile,
} from "../../domain/models/agent-config";
import { normalizeEnvVars } from "../../shared/settings-utils";
import {
	getAgentModuleById,
	listAgentModules,
	type AgentModuleDefinition,
} from "../../domain/agents/agent-modules";

/* eslint-disable obsidianmd/ui/sentence-case */
export class CCHubSettingTab extends PluginSettingTab {
	plugin: CCHubPlugin;
	private agentSelector: DropdownComponent | null = null;
	private unsubscribe: (() => void) | null = null;
	private newAgentModuleId = "acp:custom";

	constructor(app: App, plugin: CCHubPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		this.agentSelector = null;

		// Cleanup previous subscription if exists
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}

		this.renderAgentSelector(containerEl);

		// Subscribe to settings changes to update agent dropdown
		this.unsubscribe = this.plugin.settingsStore.subscribe(() => {
			this.updateAgentDropdown();
		});

		// Also update immediately on display to sync with current settings
		this.updateAgentDropdown();

		new Setting(containerEl)
			.setName("Node.js path")
			.setDesc(
				'Absolute path to Node.js executable. On macOS/Linux, use "which node", and on Windows, use "where node" to find it.',
			)
			.addText((text) => {
				text.setPlaceholder("Absolute path to node")
					.setValue(this.plugin.settings.nodePath)
					.onChange(async (value) => {
						this.plugin.settings.nodePath = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Working directory")
			.setDesc(
				"Default working directory for agent sessions. Leave empty to use the vault root.",
			)
			.addText((text) =>
				text
					.setPlaceholder("Vault root")
					.setValue(this.plugin.settings.workingDirectory)
					.onChange(async (value) => {
						this.plugin.settings.workingDirectory = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Permissions").setHeading();

		new Setting(containerEl)
			.setName("Auto-approve read")
			.setDesc("Automatically allow read operations from agents.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApproveRead)
					.onChange(async (value) => {
						this.plugin.settings.autoApproveRead = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-approve list")
			.setDesc("Automatically allow list/search operations from agents.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApproveList)
					.onChange(async (value) => {
						this.plugin.settings.autoApproveList = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-approve execute")
			.setDesc("Automatically allow command execution requests.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApproveExecute)
					.onChange(async (value) => {
						this.plugin.settings.autoApproveExecute = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Send message shortcut")
			.setDesc(
				"Choose the keyboard shortcut to send messages. Note: If using Cmd/Ctrl+Enter, you may need to remove any hotkeys assigned to Cmd/Ctrl+Enter (Settings → Hotkeys).",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption(
						"enter",
						"Enter to send, Shift+Enter for newline",
					)
					.addOption(
						"cmd-enter",
						"Cmd/Ctrl+Enter to send, Enter for newline",
					)
					.setValue(this.plugin.settings.sendMessageShortcut)
					.onChange(async (value) => {
						this.plugin.settings.sendMessageShortcut = value as
							| "enter"
							| "cmd-enter";
						await this.plugin.saveSettings();
					}),
			);

		// Windows WSL Settings (Windows only)
		if (Platform.isWin) {
			new Setting(containerEl)
				.setName("Windows Subsystem for Linux")
				.setHeading();

			new Setting(containerEl)
				.setName("Enable WSL mode")
				.setDesc(
					"Run agents inside Windows Subsystem for Linux. Recommended for agents like Codex that don't work well in native Windows environments.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.windowsWslMode)
						.onChange(async (value) => {
							this.plugin.settings.windowsWslMode = value;
							await this.plugin.saveSettings();
							this.display(); // Refresh to show/hide distribution setting
						}),
				);

			if (this.plugin.settings.windowsWslMode) {
				new Setting(containerEl)
					.setName("WSL distribution")
					.setDesc(
						"Specify WSL distribution name (leave empty for default). Example: Ubuntu, Debian",
					)
					.addText((text) =>
						text
							.setPlaceholder("Leave empty for default")
							.setValue(
								this.plugin.settings.windowsWslDistribution ||
									"",
							)
							.onChange(async (value) => {
								this.plugin.settings.windowsWslDistribution =
									value.trim() || undefined;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		new Setting(containerEl).setName("Agents").setHeading();

		this.renderAgents(containerEl);

		new Setting(containerEl).setName("Export").setHeading();

		new Setting(containerEl)
			.setName("Export folder")
			.setDesc("Folder where chat exports will be saved")
			.addText((text) =>
				text
					.setPlaceholder("CCHub")
					.setValue(this.plugin.settings.exportSettings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.defaultFolder =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Filename")
			.setDesc(
				"Template for exported filenames. Use {date} for date and {time} for time",
			)
			.addText((text) =>
				text
					.setPlaceholder("cchub_{date}_{time}")
					.setValue(
						this.plugin.settings.exportSettings.filenameTemplate,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.filenameTemplate =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Include images")
			.setDesc("Include images in exported markdown files")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.exportSettings.includeImages)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.includeImages =
							value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		if (this.plugin.settings.exportSettings.includeImages) {
			new Setting(containerEl)
				.setName("Image location")
				.setDesc("Where to save exported images")
				.addDropdown((dropdown) =>
					dropdown
						.addOption(
							"obsidian",
							"Use Obsidian's attachment setting",
						)
						.addOption("custom", "Save to custom folder")
						.addOption(
							"base64",
							"Embed as Base64 (not recommended)",
						)
						.setValue(
							this.plugin.settings.exportSettings.imageLocation,
						)
						.onChange(async (value) => {
							this.plugin.settings.exportSettings.imageLocation =
								value as "obsidian" | "custom" | "base64";
							await this.plugin.saveSettings();
							this.display();
						}),
				);

			if (
				this.plugin.settings.exportSettings.imageLocation === "custom"
			) {
				new Setting(containerEl)
					.setName("Custom image folder")
					.setDesc(
						"Folder path for exported images (relative to vault root)",
					)
					.addText((text) =>
						text
							.setPlaceholder("CCHub")
							.setValue(
								this.plugin.settings.exportSettings
									.imageCustomFolder,
							)
							.onChange(async (value) => {
								this.plugin.settings.exportSettings.imageCustomFolder =
									value;
								await this.plugin.saveSettings();
							}),
					);
			}
		}

		new Setting(containerEl)
			.setName("Auto-export on new chat")
			.setDesc(
				"Automatically export the current chat when starting a new chat",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.autoExportOnNewChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnNewChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-export on close chat")
			.setDesc(
				"Automatically export the current chat when closing the chat view",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings
							.autoExportOnCloseChat,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.autoExportOnCloseChat =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open note after export")
			.setDesc("Automatically open the exported note after exporting")
			.addToggle((toggle) =>
				toggle
					.setValue(
						this.plugin.settings.exportSettings.openFileAfterExport,
					)
					.onChange(async (value) => {
						this.plugin.settings.exportSettings.openFileAfterExport =
							value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Developer").setHeading();

		new Setting(containerEl)
			.setName("Debug mode")
			.setDesc(
				"Enable debug logging to console. Useful for development and troubleshooting.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugMode)
					.onChange(async (value) => {
						this.plugin.settings.debugMode = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	/**
	 * Update the agent dropdown when settings change.
	 * Only updates if the value is different to avoid infinite loops.
	 */
	private updateAgentDropdown(): void {
		if (!this.agentSelector) {
			return;
		}

		// Get latest settings from store snapshot
		const settings = this.plugin.settingsStore.getSnapshot();
		const currentValue = this.agentSelector.getValue();

		// Only update if different to avoid triggering onChange
		if (settings.activeAgentId !== currentValue) {
			this.agentSelector.setValue(settings.activeAgentId);
		}
	}

	/**
	 * Called when the settings tab is hidden.
	 * Clean up subscriptions to prevent memory leaks.
	 */
	hide(): void {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = null;
		}
	}

	private renderAgentSelector(containerEl: HTMLElement) {
		this.plugin.ensureActiveAgentId();

		new Setting(containerEl)
			.setName("Default agent")
			.setDesc(
				"Choose which agent handles new chat sessions by default. Changes apply when starting a new chat.",
			)
			.addDropdown((dropdown) => {
				this.agentSelector = dropdown;
				this.populateAgentDropdown(dropdown);
				dropdown.setValue(this.plugin.settings.activeAgentId);
				dropdown.onChange(async (value) => {
					const nextSettings = {
						...this.plugin.settings,
						activeAgentId: value,
					};
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettingsAndNotify(nextSettings);
				});
			});
	}

	private populateAgentDropdown(dropdown: DropdownComponent) {
		dropdown.selectEl.empty();
		for (const option of this.getAgentOptions()) {
			dropdown.addOption(option.id, option.label);
		}
	}

	private refreshAgentDropdown() {
		if (!this.agentSelector) {
			return;
		}
		this.populateAgentDropdown(this.agentSelector);
		this.agentSelector.setValue(this.plugin.settings.activeAgentId);
	}

	private getAgentOptions(): { id: string; label: string }[] {
		const options: { id: string; label: string }[] =
			this.getSelectableAgents().map((agent) => ({
				id: agent.id,
				label: `${agent.displayName || agent.id} (${agent.id})`,
			}));
		const seen = new Set<string>();
		return options.filter(({ id }) => {
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
			return true;
		});
	}

	private getSelectableAgents(): AgentProfile[] {
		const enabled = this.plugin.settings.agents.filter(
			(agent) => agent.enabled,
		);
		return enabled.length > 0 ? enabled : this.plugin.settings.agents;
	}

	private renderAgents(containerEl: HTMLElement) {
		if (this.plugin.settings.agents.length === 0) {
			containerEl.createEl("p", {
				text: "No agents configured yet.",
			});
		} else {
			this.plugin.settings.agents.forEach((agent, index) => {
				this.renderAgentProfile(containerEl, agent, index);
			});
		}

		this.renderAddAgentControls(containerEl);
	}

	private renderAgentProfile(
		containerEl: HTMLElement,
		agent: AgentProfile,
		index: number,
	) {
		const getAgentAtIndex = () => this.plugin.settings.agents[index];
		const module = getAgentModuleById(agent.moduleId);
		const moduleLabel = module
			? this.getModuleOptionLabel(module)
			: agent.moduleId;

		const blockEl = containerEl.createDiv({
			cls: "cchub-custom-agent",
		});

		new Setting(blockEl)
			.setName(agent.displayName || agent.id || "Agent")
			.setHeading();

		new Setting(blockEl)
			.setName("Enabled")
			.setDesc("Include this agent in the selection list.")
			.addToggle((toggle) =>
				toggle.setValue(agent.enabled).onChange(async (value) => {
					const current = getAgentAtIndex();
					if (!current) {
						return;
					}
					current.enabled = value;
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.refreshAgentDropdown();
				}),
			);

		const idSetting = new Setting(blockEl)
			.setName("Agent ID")
			.setDesc("Unique identifier used to reference this agent.")
			.addText((text) => {
				text.setPlaceholder(this.makeAgentIdBase(agent.moduleId))
					.setValue(agent.id)
					.onChange(async (value) => {
						const current = getAgentAtIndex();
						if (!current) {
							return;
						}
						const previousId = current.id;
						const nextId = this.ensureUniqueAgentId(
							value.trim(),
							index,
							current.moduleId,
						);
						current.id = nextId;
						if (this.plugin.settings.activeAgentId === previousId) {
							this.plugin.settings.activeAgentId = nextId;
						}
						if (nextId !== value.trim()) {
							text.setValue(nextId);
						}
						this.plugin.ensureActiveAgentId();
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		idSetting.addExtraButton((button) => {
			button
				.setIcon("trash")
				.setTooltip("Delete this agent")
				.onClick(async () => {
					this.plugin.settings.agents.splice(index, 1);
					this.plugin.ensureActiveAgentId();
					await this.plugin.saveSettings();
					this.display();
				});
		});

		new Setting(blockEl)
			.setName("Display name")
			.setDesc("Shown in menus and headers.")
			.addText((text) => {
				text.setPlaceholder(module?.label || "Agent")
					.setValue(agent.displayName || agent.id)
					.onChange(async (value) => {
						const current = getAgentAtIndex();
						if (!current) {
							return;
						}
						const trimmed = value.trim();
						current.displayName =
							trimmed.length > 0 ? trimmed : current.id;
						await this.plugin.saveSettings();
						this.refreshAgentDropdown();
					});
			});

		new Setting(blockEl)
			.setName("Module")
			.setDesc(module?.description || "Select the agent backend module.")
			.addDropdown((dropdown) => {
				for (const moduleOption of listAgentModules()) {
					dropdown.addOption(
						moduleOption.id,
						this.getModuleOptionLabel(moduleOption),
					);
				}
				dropdown.setValue(agent.moduleId);
				dropdown.onChange(async (value) => {
					const current = getAgentAtIndex();
					if (!current) {
						return;
					}
					current.moduleId = value;
					const nextModule = getAgentModuleById(value);
					if (nextModule?.auth && !current.auth) {
						current.auth = { apiKey: "" };
					}
					await this.plugin.saveSettings();
					this.refreshAgentDropdown();
					this.display();
				});
			});

		new Setting(blockEl)
			.setName("Module summary")
			.setDesc(`当前模块: ${moduleLabel}`);

		const auth = module?.auth;
		if (auth?.type === "apiKey") {
			new Setting(blockEl)
				.setName(auth.label)
				.setDesc(`${auth.description} (Stored as plain text)`)
				.addText((text) => {
					text.setPlaceholder(auth.placeholder || "")
						.setValue(agent.auth?.apiKey || "")
						.onChange(async (value) => {
							const current = getAgentAtIndex();
							if (!current) {
								return;
							}
							current.auth = {
								apiKey: value.trim(),
							};
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});
		}

		new Setting(blockEl)
			.setName("Path")
			.setDesc(this.getCommandDesc(module))
			.addText((text) => {
				text.setPlaceholder(this.getCommandPlaceholder(module))
					.setValue(agent.command)
					.onChange(async (value) => {
						const current = getAgentAtIndex();
						if (!current) {
							return;
						}
						current.command = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(blockEl)
			.setName("Arguments")
			.setDesc(this.getArgsDesc(module))
			.addTextArea((text) => {
				text.setPlaceholder("--flag\n--another=value")
					.setValue(this.formatArgs(agent.args))
					.onChange(async (value) => {
						const current = getAgentAtIndex();
						if (!current) {
							return;
						}
						current.args = this.parseArgs(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});

		new Setting(blockEl)
			.setName("Environment variables")
			.setDesc(this.getEnvDesc(module))
			.addTextArea((text) => {
				text.setPlaceholder("KEY=VALUE")
					.setValue(this.formatEnv(agent.env))
					.onChange(async (value) => {
						const current = getAgentAtIndex();
						if (!current) {
							return;
						}
						current.env = this.parseEnv(value);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 3;
			});
	}

	private renderAddAgentControls(containerEl: HTMLElement) {
		new Setting(containerEl)
			.setName("Add agent")
			.setDesc("Create a new agent profile from a module.")
			.addDropdown((dropdown) => {
				const modules = listAgentModules();
				const fallbackModuleId =
					modules[0]?.id || this.newAgentModuleId;
				if (!getAgentModuleById(this.newAgentModuleId)) {
					this.newAgentModuleId = fallbackModuleId;
				}
				for (const moduleOption of modules) {
					dropdown.addOption(
						moduleOption.id,
						this.getModuleOptionLabel(moduleOption),
					);
				}
				dropdown.setValue(this.newAgentModuleId);
				dropdown.onChange((value) => {
					this.newAgentModuleId = value;
				});
			})
			.addButton((button) => {
				button
					.setButtonText("Add agent")
					.setCta()
					.onClick(async () => {
						const profile = this.createAgentProfileForModule(
							this.newAgentModuleId,
						);
						this.plugin.settings.agents.push(profile);
						this.plugin.ensureActiveAgentId();
						await this.plugin.saveSettings();
						this.display();
					});
			});
	}

	private createAgentProfileForModule(moduleId: string): AgentProfile {
		const module = getAgentModuleById(moduleId);
		const baseId = this.makeAgentIdBase(moduleId);
		const id = this.ensureUniqueAgentId(baseId);
		return {
			id,
			displayName: module?.label || "Custom agent",
			moduleId: moduleId,
			enabled: true,
			command: "",
			args: [],
			env: [],
			auth: module?.auth ? { apiKey: "" } : undefined,
		};
	}

	private ensureUniqueAgentId(
		rawId: string,
		excludeIndex?: number,
		moduleId?: string,
	): string {
		const base =
			rawId && rawId.trim().length > 0
				? rawId.trim()
				: this.makeAgentIdBase(moduleId);
		const existing = new Set(
			this.plugin.settings.agents
				.filter((_, index) =>
					typeof excludeIndex === "number"
						? index !== excludeIndex
						: true,
				)
				.map((agent) => agent.id),
		);
		if (!existing.has(base)) {
			return base;
		}
		let counter = 2;
		let candidate = `${base}-${counter}`;
		while (existing.has(candidate)) {
			counter += 1;
			candidate = `${base}-${counter}`;
		}
		return candidate;
	}

	private makeAgentIdBase(moduleId?: string): string {
		if (!moduleId) {
			return "agent";
		}
		const parts = moduleId.split(":");
		const base = parts[1] || parts[0] || "agent";
		return base === "custom" ? "custom-agent" : base;
	}

	private getModuleOptionLabel(module: AgentModuleDefinition): string {
		return `${module.label} (${module.protocol.toUpperCase()})`;
	}

	private getCommandPlaceholder(
		module: AgentModuleDefinition | null,
	): string {
		if (!module || !module.commandCandidates?.length) {
			return "Absolute path to command";
		}
		return `Absolute path to ${module.commandCandidates[0]}`;
	}

	private getCommandDesc(module: AgentModuleDefinition | null): string {
		const base =
			'Absolute path to the agent command. On macOS/Linux use \"which <command>\", and on Windows use \"where <command>\".';
		if (!module?.commandCandidates?.length) {
			return base;
		}
		return `${base} Leave empty to auto-detect: ${module.commandCandidates.join(", ")}.`;
	}

	private getArgsDesc(module: AgentModuleDefinition | null): string {
		const base =
			"Enter one argument per line. Leave empty to run without arguments.";
		if (!module?.requiredArgs?.length) {
			return base;
		}
		const placement =
			module.argsPlacement === "prepend" ? "prepended" : "appended";
		return `${base} Required args will be ${placement}: ${module.requiredArgs.join(" ")}.`;
	}

	private getEnvDesc(module: AgentModuleDefinition | null): string {
		const base =
			"Enter KEY=VALUE pairs, one per line. (Stored as plain text)";
		if (!module?.auth?.envKey) {
			return base;
		}
		return `${base} ${module.auth.envKey} is derived from the API key above.`;
	}

	private formatArgs(args: string[]): string {
		return args.join("\n");
	}

	private parseArgs(value: string): string[] {
		return value
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	}

	private formatEnv(env: AgentEnvVar[]): string {
		return env
			.map((entry) => `${entry.key}=${entry.value ?? ""}`)
			.join("\n");
	}

	private parseEnv(value: string): AgentEnvVar[] {
		const envVars: AgentEnvVar[] = [];

		for (const line of value.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			const delimiter = trimmed.indexOf("=");
			if (delimiter === -1) {
				continue;
			}
			const key = trimmed.slice(0, delimiter).trim();
			const envValue = trimmed.slice(delimiter + 1).trim();
			if (!key) {
				continue;
			}
			envVars.push({ key, value: envValue });
		}

		return normalizeEnvVars(envVars);
	}
}
