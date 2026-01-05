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

[English](#-english) • [中文说明](#-中文说明)

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

<div id="chinese"></div>

## 🇨🇳 中文说明

**CCHub** 是一个专为 Obsidian 打造的聊天插件，它将多个 **ACP (Agent Context Protocol)** CLI 助手整合到一个统一的、本地优先的工作流中。它为您带来了基于终端的 AI Agent 的强大能力，并提供了完善的权限控制、工具调用和导出功能。

> **注意**：本插件通过 **ACP** 协议与 CLI 助手通信，不使用 MCP。

### ✨ 核心功能

- **🔌 多模型集成**：支持集成 Claude Code、Codex、Gemini 等多种 ACP CLI 工具。
- **💬 统一交互界面**：提供包含执行计划、工具调用详情和实时终端输出渲染的现代化聊天界面。
- **🛡️ 安全可控**：提供细粒度的权限请求控制，您可以一键批准或拒绝 Agent 的读取、写入或执行操作。
- **🧠 智能上下文**：支持通过 `@mention` 引用笔记内容，以及使用 `/slash` 斜杠命令快速操作。
- **📤 灵活导出**：支持将聊天记录一键导出为 Markdown 文档（支持包含图片）。
- **🪟 WSL 支持**：完美支持在 Windows 系统下通过 WSL 运行 CLI 工具。

### 📦 安装指南

#### 手动安装
1. 下载最新 Release 版本。
2. 将 `main.js`、`manifest.json` 和 `styles.css` 复制到以下目录：
   ```path
   <Vault>/.obsidian/plugins/obsidian-cchub/
   ```
3. 重启 Obsidian。
4. 在 **设置 → 第三方插件** 中启用 **Obsidian CCHub**。

### 🚀 使用方法

1. **开启对话**：点击侧边栏的机器人图标 🤖 或在命令面板运行 **"Open CCHub"**。
2. **配置助手**：进入 **设置 → 第三方插件 → Obsidian CCHub** 配置您的 Agent（如 Node.js 路径、工作目录等）。

### ⚙️ 设置说明

| 设置项 | 说明 |
| :--- | :--- |
| **Active Agent** | 选择当前会话主要使用的 Agent。 |
| **Node.js Path** | 用于运行 CLI 工具的 Node.js 可执行文件绝对路径。 |
| **Working Directory** | 默认工作目录（留空则默认为仓库根目录）。 |
| **Permissions** | 设置是否自动批准 `read`、`list` 或 `execute` 等操作。 |
| **Built-in Agents** | 针对 Claude、Codex、Gemini 的内置参数配置。 |
| **Export** | 自定义导出目录、文件名模板（如 `cchub_{date}`）及图片存储策略。 |

### 🛠️ 开发指南

<details>
<summary>点击展开开发说明</summary>

**环境要求：**
- Obsidian 0.15+ (仅桌面端)
- Node.js 18+

**构建命令：**
```bash
# 安装依赖
npm install

# 开发模式（监听文件变动）
npm run dev

# 生产环境构建
npm run build
```
</details>

### 🔒 隐私与安全

- **本地优先**：插件不包含任何隐藏的遥测代码。
- **网络透明**：网络访问完全取决于您配置的 CLI 工具。
- **读写可控**：仅在工具调用或您执行导出操作时，才会对文件系统进行读写。

---

<div align="center">

**[⬆ Back to Top](#obsidian-cchub)**

<br>

MIT License © 2026 Obsidian CCHub Team

</div>