# Obsidian CCHub

CCHub 是一个将多个 ACP CLI 助手整合到 Obsidian 中的聊天插件，提供统一的对话界面、权限控制与导出能力，专注于本地、可控的工作流。

## 功能

- 集成 Claude Code、Codex、Gemini 等 ACP CLI 工具，并支持自定义 Agent
- 统一聊天界面，支持计划/工具调用/终端输出渲染
- 权限请求与一键批准/拒绝
- @mention 笔记引用与 Slash 命令
- 聊天记录导出为 Markdown（可含图片）
- Windows WSL 模式支持

## 环境

- Obsidian 0.15+（仅桌面端）
- Node.js 18+（开发与构建）
- npm + esbuild（项目默认工具链）

## 安装与开发

安装依赖：

```bash
npm install
```

开发模式（自动构建）：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

## 在 Obsidian 中使用

1. 将 `main.js`、`manifest.json`、`styles.css` 复制到：
   `<Vault>/.obsidian/plugins/obsidian-cchub/`
2. 重载 Obsidian
3. 在 **Settings → Community plugins** 启用
4. 点击侧边栏图标或运行命令 **Open CCHub**

## 设置说明

主要设置项如下（位置：**Settings → Community plugins → Obsidian CCHub**）：

- **Active agent**：选择当前会话使用的 Agent
- **Node.js path**：CLI 运行所需 Node.js 路径
- **Working directory**：默认工作目录（留空使用库根目录）
- **Permissions**：自动批准 read/list/execute
- **Behavior**：自动引用当前笔记、发送快捷键
- **Built-in agents**：配置 Claude/Codex/Gemini 的路径、参数与环境变量
- **Custom agents**：添加自定义 ACP CLI
- **Export**：导出目录、文件名模板、图片保存策略
- **Windows WSL**：在 Windows 下通过 WSL 运行 CLI

## 导出

- 默认导出目录：`CCHub`
- 默认文件名模板：`cchub_{date}_{time}`
- 可选导出图片到 Obsidian 附件目录、自定义目录或 Base64
- 导出的 Markdown 含前置信息与 `tags: [cchub]`

## 隐私与安全

- 插件不包含隐藏遥测
- 网络访问仅由你配置的 CLI 工具决定
- 仅在需要时读写库内文件，不访问库外路径

## 项目结构

```
src/
  main.ts                 # 插件入口
  plugin.ts               # 生命周期与命令
  adapters/               # ACP 与 Obsidian 适配层
  components/             # UI 组件
  domain/                 # 领域模型与端口
  hooks/                  # React hooks
  shared/                 # 通用工具与服务
```

## 发布流程

1. 更新 `manifest.json` 的 `version`
2. 更新 `versions.json` 对应版本
3. 执行 `npm run build`
4. 发布 GitHub Release（tag 与版本号一致且不含 `v`）
5. 附加 `manifest.json`、`main.js`、`styles.css`

## 许可证

见 `LICENSE`
