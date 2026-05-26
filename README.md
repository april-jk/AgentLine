<p align="center">
  <img src="site/public/icon-512.png" alt="AgentLine 应用图标" width="96" height="96">
</p>

<h1 align="center">AgentLine</h1>

<p align="center">
  <strong>本机托管、多设备监督的 AI Agent 控制台。</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <a href="README.en.md">English</a>
  ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://agentline.oneceo.ai/"><img alt="官网" src="https://img.shields.io/badge/Website-agentline.oneceo.ai-111827?style=for-the-badge"></a>
  <a href="https://github.com/april-jk/AgentLine/releases/tag/v1.0.5"><img alt="最新版本" src="https://img.shields.io/github/v/release/april-jk/AgentLine?style=for-the-badge&label=Release&color=2563eb"></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge"></a>
</p>

AgentLine 是一个本机优先的 Agent 监督控制台。它让 Claude Code、Codex、Gemini、OpenCode 这类 AI coding agent 会话继续运行在你自己的开发机上，同时把监督、审批、进度查看和远程接手能力带到桌面、手机和平板。

一句话：Agent 进程留在本机，控制界面可以移动。

适合这些场景：

- 长任务还在跑，你已经离开工位，但仍想看进度或补一句上下文。
- Agent 需要你确认命令、审批文件改动、检查 diff 或处理阻塞。
- 你同时跑着多个项目、多个 provider，不想在终端窗口和设备之间来回切。
- 你希望远程监督自己的本机开发环境，而不是把代码和凭证交给托管式云端执行器。

## 当前状态

- 最新公开版本：[v1.0.5](https://github.com/april-jk/AgentLine/releases/tag/v1.0.5)
- 桌面端下载：macOS DMG、Windows 安装版/便携版、Linux AppImage 和 DEB
- 移动端下载：GitHub Release 提供 Android APK；iOS 当前通过官网收集 TestFlight 内测信息

当前 npm tarball 主要用于发布记录。推荐安装方式是下载 GitHub Release 里的桌面端/移动端产物。

## 能做什么

- **会话由本机托管**：Agent 进程运行在你的开发机上，关闭浏览器或切换设备不会打断任务。
- **多会话总览**：集中查看项目、活跃会话、最近运行和需要注意的任务，不必在终端窗口之间来回切。
- **手机监督**：在手机上看进度、回复提示、审批操作、检查 diff、继续追问。
- **Provider 感知的会话处理**：读取并归一化 Claude、Codex、Gemini、OpenCode 的存储和事件格式。
- **远程设备控制**：把 Android 设备、Android 模拟器、iOS Simulator 串流到手机上，用于移动开发检查。
- **文件和媒体工作流**：从桌面或手机上传截图、照片、PDF 和代码文件到会话。
- **按注意力排序的处理流**：优先显示真正需要你处理的会话，而不只是最近打开的会话。

## 项目定位

AgentLine 不是云端 Agent 托管平台，也不替你保管模型账号。它更像是给本机 Agent 工作流加上一层可移动的控制面：

- **本机优先**：代码、CLI、凭证和长运行任务默认留在你的机器上。
- **多端接力**：桌面端负责常驻和系统集成，手机端负责审批、查看和快速响应。
- **多 Provider 汇总**：把不同 Agent CLI 的会话组织到一个统一视图里。
- **开源可贡献**：功能、下载、路线图和问题反馈都在 GitHub 上透明推进。

## 支持的 Provider

| Provider | 状态 | 说明 |
| --- | --- | --- |
| Claude Code | 主线支持 | 使用 Anthropic 官方 Agent SDK 和用户自己的 Claude 凭证。 |
| Claude Ollama | 可选 | 面向本地模型的 Claude 风格工作流，需要 Ollama。 |
| Codex | 主线支持 | 用于云端模型支持的 Codex Coding 会话。 |
| Codex OSS | 可选 | 通过 Ollama 使用本地模型的 Codex 路径。 |
| Gemini ACP | 实验性 | 使用 Gemini CLI 的 ACP 能力处理交互式 Agent 会话。 |
| OpenCode | 实验性 | 使用 OpenCode server/session 能力接入多 Provider 工作流。 |

Provider 会根据本机已安装的 CLI 和配置自动检测。

## 截图

<p align="center">
  <img src="site/public/screenshots/overview-projects-real.png" width="420" alt="AgentLine 多项目总览">
  <img src="site/public/screenshots/session-running-real.png" width="420" alt="AgentLine 桌面端运行中的会话">
</p>

<p align="center">
  <img src="site/public/screenshots/session-mobile-real.png" width="240" alt="AgentLine 手机会话视图">
  <img src="site/public/screenshots/sessions-list-mobile-real.png" width="240" alt="AgentLine 手机会话列表">
  <img src="site/public/screenshots/session-mobile-complete-real.png" width="240" alt="AgentLine 手机完成状态">
</p>

## 安装

大多数用户直接下载 [最新 GitHub Release](https://github.com/april-jk/AgentLine/releases/tag/v1.0.5) 里的安装包：

| 平台 | 直接下载 |
| --- | --- |
| macOS | [下载 DMG](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/AgentLine.Desktop-1.0.5-arm64.dmg) |
| Windows | [下载安装版](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/AgentLine.Desktop.Setup.1.0.5.exe) / [下载便携版](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/AgentLine.Desktop.1.0.5.exe) |
| Linux | [下载 AppImage](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/agentline-desktop-1.0.5-x86_64.AppImage) / [下载 DEB](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/agentline-desktop-1.0.5-amd64.deb) |
| Android | [下载 APK](https://github.com/april-jk/AgentLine/releases/download/v1.0.5/AgentLine-Mobile-RN-1.0.5-android.apk) |
| iOS | [填写 TestFlight 收集表](https://agentline.oneceo.ai/#install) |
| 其它资产 | [查看完整 Release](https://github.com/april-jk/AgentLine/releases/tag/v1.0.5) |

安装桌面端后，让它运行在真正承载 Agent 会话的机器上。之后可以用 Android App 或手机浏览器从其它设备接手监督。

## 架构

- `packages/server`：Hono server、provider adapters、session readers、push 和 file APIs
- `packages/client`：React Web App 和 remote client bundle
- `packages/desktop-electron`：Electron 桌面壳和发布打包
- `packages/mobile-rn`：React Native 移动端
- `packages/shared`：共享协议、schema、provider 和 relay 常量
- `site`：Astro 官网和 GitHub Pages 部署

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
