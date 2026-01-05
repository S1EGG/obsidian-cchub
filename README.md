<div align="center">

<!-- You can replace this with your actual banner image path like docs/banner.png or a URL -->
<!-- <img src="docs/banner.png" alt="Obsidian CCHub Banner" width="100%" /> -->

# 🤖 Obsidian CCHub

**The Unified ACP Agent Interface for Obsidian**
<br>
*Connect Claude Code, Codex, Gemini, and local CLI agents directly within your vault.*

[![Release](https://img.shields.io/github/v/release/obsidian-cchub/obsidian-cchub?style=for-the-badge&color=blueviolet)](https://github.com/obsidian-cchub/obsidian-cchub/releases)
[![License](https://img.shields.io/github/license/obsidian-cchub/obsidian-cchub?style=for-the-badge&color=orange)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/obsidian-cchub/obsidian-cchub/total?style=for-the-badge&color=success)](https://github.com/obsidian-cchub/obsidian-cchub/releases)

[English](#-english) • [中文说明](docs/README_CN.md)

</div>

---

<div id="english"></div>

## 🇬🇧 English

**CCHub** is a powerful Obsidian chat plugin that unifies multiple **ACP (Agent Context Protocol)** CLI agents into a single, local-first workflow. It brings the power of terminal-based AI agents into your note-taking environment with robust permissions, tool integration, and chat export capabilities.

> **Note:** This plugin speaks **ACP** to CLI agents and does not use MCP.

### ✨ Features

- **🔌 Universal Integration**: Seamlessly integrates Claude Code, Codex, Gemini, and other ACP-compliant CLI agents.
- **💬 Unified Chat UI**: Experience a consistent interface with rich support for execution plans, tool calls, and live terminal output.
- **🛡️ Secure & Controlled**: Granular permission requests allow you to approve or deny agent actions (read/write/execute).
- **🧠 Context Aware**: Use `@mention` to pull notes into context and `/slash` commands for quick actions.
- **📤 Easy Export**: Export entire chat sessions to Markdown, complete with images and formatting.
- **🪟 WSL Support**: First-class support for running agents via WSL on Windows.

### 📦 Installation

#### Manual Install
1. Download the latest release.
2. Copy `main.js`, `manifest.json`, and `styles.css` to your vault folder:
   ```path
   <Vault>/.obsidian/plugins/obsidian-cchub/
   ```
3. Reload Obsidian.
4. Enable **Obsidian CCHub** in **Settings → Community plugins**.

### 🚀 Usage

1. **Start a Chat**: Click the ribbon icon 🤖 or run the command **"Open CCHub"**.
2. **Configure Agents**: Go to **Settings → Community plugins → Obsidian CCHub** to set up your preferred CLI agents (Node.js path, working directory, etc.).

### ⚙️ Configuration

| Setting | Description |
| :--- | :--- |
| **Active Agent** | Select which agent powers the current chat session. |
| **Node.js Path** | Absolute path to the Node.js executable for running CLI agents. |
| **Working Directory** | Default execution context (leaves empty for vault root). |
| **Permissions** | Toggle auto-approve for specific actions like `read`, `list`, or `execute`. |
| **Built-in Agents** | Pre-configured settings for Claude, Codex, and Gemini. |
| **Export Settings** | Customize export path, filename templates (`cchub_{date}`), and image handling. |

### 🛠️ Development

<details>
<summary>Click to expand development instructions</summary>

**Requirements:**
- Obsidian 0.15+ (Desktop)
- Node.js 18+

**Setup:**
```bash
# Install dependencies
npm install

# Watch mode (hot-reload)
npm run dev

# Production build
npm run build
```
</details>

### 🔒 Privacy

- **Local-First**: No hidden telemetry. Your data stays on your machine.
- **Controlled Access**: Network access is strictly managed by the CLI agent you configure.
- **Transparent**: File reads/writes only occur when explicitly requested by tools or export actions.

---

## 📈 Star History

<a href="https://star-history.com/#obsidian-cchub/obsidian-cchub&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=obsidian-cchub/obsidian-cchub&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=obsidian-cchub/obsidian-cchub&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=obsidian-cchub/obsidian-cchub&type=Date" />
 </picture>
</a>

<div align="center">

**[⬆ Back to Top](#obsidian-cchub)**

<br>

MIT License © 2026 Obsidian CCHub Team

</div>
