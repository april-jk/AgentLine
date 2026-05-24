<p align="center">
  <img src="site/public/icon-512.png" alt="AgentLine 应用图标" width="96" height="96">
</p>

<h1 align="center">AgentLine</h1>

<p align="center">
  <strong>面向长时间运行 Coding Agent 的移动监督中枢。</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <a href="README.en.md">English</a>
  ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://april-jk.github.io/AgentLine/"><img alt="官网" src="https://img.shields.io/badge/Website-GitHub%20Pages-111827?style=for-the-badge"></a>
  <a href="https://github.com/april-jk/AgentLine/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/april-jk/AgentLine?style=for-the-badge&label=Release&color=2563eb"></a>
  <a href="https://relay.oneceo.ai/remote/login"><img alt="远程登录" src="https://img.shields.io/badge/Remote%20Login-relay.oneceo.ai-0f766e?style=for-the-badge"></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge"></a>
</p>

AgentLine 让 Claude Code、Codex、Gemini、OpenCode 这类 Agent 会话继续运行在你自己的机器上，同时把监督界面带到桌面和手机上。它适合这样的场景：任务还在跑，你已经离开工位，但 Agent 需要你审批、补充上下文、查看进度或做一个快速决定。

核心原则很简单：Agent 进程留在本机，控制界面可以移动。

## 当前状态

- 最新公开版本：[v1.0.1](https://github.com/april-jk/AgentLine/releases/tag/v1.0.1)
- 桌面端下载：macOS DMG、Windows 安装版/便携版、Linux AppImage 和 DEB
- 移动端下载：GitHub Release 提供 Android APK；iOS 当前通过官网收集 TestFlight 内测信息
- 远程接入：可选公共中继 `relay.oneceo.ai`，链路端到端加密
- 源码运行：Node.js 20 和 pnpm 9.15.1

当前 npm tarball 主要用于发布记录。推荐安装方式是下载 GitHub Release 里的桌面端/移动端产物，或从源码运行。

## 能做什么

- **会话由本机托管**：Agent 进程运行在你的开发机上，关闭浏览器或切换设备不会打断任务。
- **多会话总览**：集中查看项目、活跃会话、最近运行和需要注意的任务，不必在终端窗口之间来回切。
- **手机监督**：在手机上看进度、回复提示、审批操作、检查 diff、继续追问。
- **Provider 感知的会话处理**：读取并归一化 Claude、Codex、Gemini、OpenCode 的存储和事件格式。
- **多种远程接入方式**：本地/LAN、Tailscale、反向代理、自托管 relay 或公共 relay。
- **端到端加密的 relay 模式**：SRP-6a 负责密码证明，TweetNaCl 加密 relay 流量，中继只转发密文。
- **远程设备控制**：把 Android 设备、Android 模拟器、iOS Simulator 串流到手机上，用于移动开发检查。
- **文件和媒体工作流**：从桌面或手机上传截图、照片、PDF 和代码文件到会话。
- **按注意力排序的处理流**：优先显示真正需要你处理的会话，而不只是最近打开的会话。

## 支持的 Provider

| Provider | 状态 | 说明 |
| --- | --- | --- |
| Claude Code | 主线支持 | 使用 Anthropic 官方 Agent SDK 和用户自己的 Claude 凭证。 |
| Claude Ollama | 可选 | 面向本地模型的 Claude 风格工作流，需要 Ollama。 |
| Codex | 主线支持 | 用于云端模型支持的 Codex Coding 会话。 |
| Codex OSS | 可选 | 通过 Ollama 使用本地模型的 Codex 路径。 |
| Gemini ACP | 实验性 | 使用 Gemini CLI 的 ACP 能力处理交互式 Agent 会话。 |
| OpenCode | 实验性 | 使用 OpenCode server/session 能力接入多 Provider 工作流。 |

Provider 会根据本机已安装的 CLI 和配置自动检测。也可以用 `ENABLED_PROVIDERS` 限制可见入口：

```bash
ENABLED_PROVIDERS=claude,codex pnpm dev
```

## 截图

<p align="center">
  <img src="site/public/screenshots/overview-projects-real.png" width="420" alt="AgentLine 多项目总览">
  <img src="site/public/screenshots/session-running-real.png" width="420" alt="AgentLine 桌面端运行中的会话">
</p>

<p align="center">
  <img src="site/public/screenshots/session-mobile-real.png" width="240" alt="AgentLine 手机会话视图">
  <img src="site/public/screenshots/sessions-list-mobile-real.png" width="240" alt="AgentLine 手机会话列表">
  <img src="site/public/screenshots/device-stream.png" width="240" alt="AgentLine 远程设备控制">
</p>

## 安装

大多数用户直接从 [最新 GitHub Release](https://github.com/april-jk/AgentLine/releases/latest) 开始：

| 平台 | 当前发布产物 |
| --- | --- |
| macOS | Apple Silicon DMG |
| Windows | 安装版和便携版 executable |
| Linux | x86_64 AppImage 和 amd64 DEB |
| Android | APK |
| iOS | 官网的 [TestFlight 收集流程](https://april-jk.github.io/AgentLine/#install) |

安装桌面端后，让它运行在真正承载 Agent 会话的机器上。之后可以用 Android App、手机浏览器或远程登录页从其它设备接手监督。

## 从源码运行

```bash
git clone https://github.com/april-jk/AgentLine.git
cd AgentLine
corepack enable
pnpm install
pnpm dev
```

打开 [http://localhost:3400](http://localhost:3400)。默认端口由 `PORT` 推导：

| 端口 | 用途 |
| --- | --- |
| `PORT` | 主服务，默认 `3400` |
| `PORT + 1` | Maintenance server |
| `PORT + 2` | Vite dev server |

如果要隔离开发环境：

```bash
PORT=4000 AGENTLINE_PROFILE=dev pnpm dev
```

## 远程接入

AgentLine 是 local-first 的。远程接入是可选能力。

最简单的远程路径是公共 relay。桌面端可以在 Settings 里配置；如果是 headless 或源码安装，并且本机有 CLI，也可以运行：

```bash
agentline --setup-remote-access --username myserver --password "secretpass123"
```

然后从 [relay.oneceo.ai/remote/login](https://relay.oneceo.ai/remote/login) 登录。

Relay 模式的设计目标是让中继看不到你的密码和会话内容。Host 和 Client 使用 SRP-6a 完成认证，再通过 relay 交换加密后的流量。自托管和其它接入方式见 [docs/project/remote-access.md](docs/project/remote-access.md)。

## 构建和验证

常用检查：

```bash
pnpm version:check
pnpm lint
pnpm typecheck
pnpm test
```

常用构建：

```bash
pnpm build:desktop-electron
pnpm typecheck:mobile-rn
pnpm --filter @agentline/client build
pnpm --filter @agentline/client build:remote
```

当前版本的打包命令和产物位置见 [docs/releases/1.0.1.md](docs/releases/1.0.1.md)。

## 架构

- `packages/server`：Hono server、provider adapters、session readers、remote-access setup、push 和 file APIs
- `packages/client`：React Web App 和 remote client bundle
- `packages/desktop-electron`：Electron 桌面壳和发布打包
- `packages/mobile-rn`：React Native 移动端
- `packages/relay`：可选的远程接入 relay 服务
- `packages/shared`：共享协议、schema、provider 和 relay 常量
- `site`：Astro 官网和 GitHub Pages 部署

服务端状态默认保存在 `~/.agentline/`，包含日志、上传文件、会话索引、metadata、auth 和远程接入配置。可以用 `AGENTLINE_DATA_DIR` 或 `AGENTLINE_PROFILE` 隔离环境。

## 信任边界

AgentLine 是运行在你机器上的 Agent 会话监督层，不是托管式 Coding 服务。模型 Provider 的认证仍然交给官方 CLI 或 SDK 流程。AgentLine 不伪装 Provider 客户端，不抽取用户 OAuth token，也不把模型流量代理到自己的后端。

更多说明：

- [How we use the Claude SDK](https://april-jk.github.io/AgentLine/tos-compliance.html)
- [Subscription access approaches](https://april-jk.github.io/AgentLine/subscription-access-approaches.html)
- [Remote access design](docs/project/remote-access.md)

## 开发

本地开发、日志、profile 和测试命令见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## Star History

<a href="https://www.star-history.com/#april-jk/AgentLine&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=april-jk/AgentLine&type=date&legend=top-left&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=april-jk/AgentLine&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=april-jk/AgentLine&type=date&legend=top-left" />
  </picture>
</a>

## License

MIT
