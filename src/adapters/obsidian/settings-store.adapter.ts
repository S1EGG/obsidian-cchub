/**
 * Settings Store Adapter
 *
 * Reactive settings store implementing ISettingAccess port.
 * Manages plugin settings state with observer pattern for React integration
 * via useSyncExternalStore, and handles persistence to Obsidian's data.json.
 */

import type { ISettingsAccess } from "../../domain/ports/settings-access.port";
import type { CCHubPluginSettings } from "../../plugin";
import type CCHubPlugin from "../../plugin";

/** Listener callback invoked when settings change */
type Listener = () => void;

/**
 * Observable store for plugin settings implementing ISettingsAccess port.
 *
 * Manages plugin settings state and notifies subscribers of changes.
 * Designed to work with React's useSyncExternalStore hook for
 * automatic re-rendering when settings update.
 *
 * Pattern: Observer/Publisher-Subscriber
 */
export class SettingsStore implements ISettingsAccess {
	/** Current settings state */
	private state: CCHubPluginSettings;

	/** Set of registered listeners */
	private listeners = new Set<Listener>();

	/** Plugin instance for persistence */
	private plugin: CCHubPlugin;

	/**
	 * Create a new settings store.
	 *
	 * @param initial - Initial settings state
	 * @param plugin - Plugin instance for saving settings
	 */
	constructor(initial: CCHubPluginSettings, plugin: CCHubPlugin) {
		this.state = initial;
		this.plugin = plugin;
	}

	/**
	 * Get current settings snapshot.
	 *
	 * Used by React's useSyncExternalStore to read current state.
	 *
	 * @returns Current plugin settings
	 */
	getSnapshot = (): CCHubPluginSettings => this.state;

	/**
	 * Update plugin settings.
	 *
	 * Merges the provided updates with existing settings, notifies subscribers,
	 * and persists changes to disk.
	 *
	 * @param updates - Partial settings object with properties to update
	 * @returns Promise that resolves when settings are saved
	 */
	async updateSettings(
		updates: Partial<CCHubPluginSettings>,
	): Promise<void> {
		const next = { ...this.state, ...updates };
		this.state = next;
		this.plugin.settings = next;

		// Notify all subscribers
		for (const listener of this.listeners) {
			listener();
		}

		// Persist to disk without triggering store recursion
		await this.plugin.saveData(next);
	}

	/**
	 * Subscribe to settings changes.
	 *
	 * The listener will be called whenever settings are updated via updateSettings().
	 * Used by React's useSyncExternalStore to detect changes.
	 *
	 * @param listener - Callback to invoke on settings changes
	 * @returns Unsubscribe function to remove the listener
	 */
	subscribe = (listener: Listener): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/**
	 * Set entire settings object (legacy method).
	 *
	 * For backward compatibility with existing code.
	 * Delegates to updateSettings() for async persistence.
	 *
	 * @param next - New settings object
	 */
	set(next: CCHubPluginSettings): void {
		this.state = next;
		this.plugin.settings = next;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

/**
 * Create a new settings store instance.
 *
 * Factory function for creating settings stores with initial state.
 *
 * @param initial - Initial plugin settings
 * @param plugin - Plugin instance for persistence
 * @returns New SettingsStore instance
 */
export const createSettingsStore = (
	initial: CCHubPluginSettings,
	plugin: CCHubPlugin,
) => new SettingsStore(initial, plugin);
