import { accessSync, constants } from "fs";
import { delimiter, join } from "path";
import { Platform } from "obsidian";

export interface DetectedCliCommand {
	command: string;
	detectedFrom: string;
}

export class CliDetector {
	private cache = new Map<string, string | null>();

	detect(commandCandidates: string[]): DetectedCliCommand | null {
		for (const candidate of commandCandidates) {
			const resolved = this.resolveCandidate(candidate);
			if (resolved) {
				return {
					command: resolved,
					detectedFrom: candidate,
				};
			}
		}
		return null;
	}

	private resolveCandidate(candidate: string): string | null {
		const normalized = candidate.trim();
		if (!normalized) {
			return null;
		}
		if (normalized.includes(" ")) {
			return null;
		}

		if (this.cache.has(normalized)) {
			return this.cache.get(normalized) || null;
		}

		const resolved = this.isPathLike(normalized)
			? this.resolveDirectPath(normalized)
			: this.resolveFromPath(normalized);

		this.cache.set(normalized, resolved);
		return resolved;
	}

	private isPathLike(candidate: string): boolean {
		return candidate.includes("/") || candidate.includes("\\");
	}

	private resolveDirectPath(candidate: string): string | null {
		return this.pathExists(candidate) ? candidate : null;
	}

	private resolveFromPath(command: string): string | null {
		const pathValue = process.env.PATH || "";
		const dirs = pathValue.split(delimiter).filter((entry) => entry);
		const extensions = this.getExecutableExtensions(command);

		for (const dir of dirs) {
			for (const ext of extensions) {
				const fullPath = join(dir, `${command}${ext}`);
				if (this.pathExists(fullPath)) {
					return fullPath;
				}
			}
		}

		return null;
	}

	private getExecutableExtensions(command: string): string[] {
		if (!Platform.isWin) {
			return [""];
		}

		const hasExt = /\.[A-Za-z0-9]+$/.test(command);
		if (hasExt) {
			return [""];
		}

		const raw = process.env.PATHEXT || "";
		const extensions = raw
			.split(";")
			.map((ext) => ext.trim())
			.filter((ext) => ext.length > 0);

		if (extensions.length === 0) {
			return [".EXE", ".CMD", ".BAT", ".COM"];
		}

		return extensions;
	}

	private pathExists(target: string): boolean {
		try {
			const mode = Platform.isWin ? constants.F_OK : constants.X_OK;
			accessSync(target, mode);
			return true;
		} catch {
			return false;
		}
	}
}
