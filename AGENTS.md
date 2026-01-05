# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains all TypeScript/React source code. Entry point is `src/main.ts`, with lifecycle logic in `src/plugin.ts`.
- UI lives under `src/components/`, domain models and ports under `src/domain/`, adapters under `src/adapters/`, hooks under `src/hooks/`, and shared utilities under `src/shared/`.
- Build artifacts (`main.js`, `styles.css`, `manifest.json`) live at repo root for Obsidian loading.
- Docs and design notes are in `doc/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start esbuild in watch mode for local development.
- `npm run build`: type-check (`tsc -noEmit`) and bundle production output.
- `npm run lint`: run ESLint over the codebase.
- `npm run version`: bump `manifest.json` + `versions.json` for release.

## Coding Style & Naming Conventions

- Language: TypeScript + React; prefer `async/await` and strong typing.
- Indentation: tabs are used across the codebase.
- Naming: React components `PascalCase` (e.g., `ChatView`), hooks `useX`, CSS classes prefixed with `cchub-`.
- Linting: ESLint configuration in `eslint.config.mts`; keep changes lint-clean.

## Testing Guidelines

- No automated test suite is currently configured.
- Use `npm run build` as a smoke check and manually verify in Obsidian.
- Manual install path: `<Vault>/.obsidian/plugins/obsidian-cchub/`.

## Commit & Pull Request Guidelines

- Commit messages follow short, imperative sentences (e.g., “Refactor ACP adapter”, “Rename to CCHub”).
- PRs should include a clear summary, testing notes (manual steps or `npm run build`), and screenshots for UI changes.
- Link related issues if applicable and note any breaking changes to commands/settings.

## Security & Configuration Notes

- The plugin is desktop-only and runs local CLI agents; avoid adding network calls unless documented and user-visible.
- Do not commit generated files or `node_modules/`.
