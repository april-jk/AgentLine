<p align="center">
  <img src="site/public/icon-512.png" alt="AgentLine app icon" width="96" height="96">
</p>

<h1 align="center">AgentLine</h1>

<p align="center">
  <strong>Mobile supervisor for long-running coding agents.</strong>
</p>

<p align="center">
  <a href="README.md">简体中文</a>
  ·
  <a href="README.en.md">English</a>
  ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://april-jk.github.io/AgentLine/"><img alt="Website" src="https://img.shields.io/badge/Website-GitHub%20Pages-111827?style=for-the-badge"></a>
  <a href="https://github.com/april-jk/AgentLine/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/april-jk/AgentLine?style=for-the-badge&label=Release&color=2563eb"></a>
  <a href="https://relay.oneceo.ai/remote/login"><img alt="Remote login" src="https://img.shields.io/badge/Remote%20Login-relay.oneceo.ai-0f766e?style=for-the-badge"></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge"></a>
</p>

AgentLine keeps Claude Code, Codex, Gemini, and OpenCode-style agent sessions running on your own machine while you supervise them from desktop or phone. It is built for the moment when a task is still running, you have left the desk, and the agent needs approval, context, or a quick decision.

The core idea is simple: the agent process stays local; the control surface can move.

## Current Status

- Latest public release: [v1.0.1](https://github.com/april-jk/AgentLine/releases/tag/v1.0.1)
- Desktop downloads: macOS DMG, Windows installer/portable executable, Linux AppImage and DEB
- Mobile downloads: Android APK in the GitHub Release; iOS is currently distributed through TestFlight collection on the website
- Remote access: optional public relay at `relay.oneceo.ai`, with end-to-end encrypted traffic
- Source build: available with Node.js 20 and pnpm 9.15.1

The npm package tarball exists for release bookkeeping, but the recommended install path today is the GitHub Release desktop/mobile builds or running from source.

## What It Does

- **Server-owned sessions**: agent processes run on your development machine, so closing a browser or switching devices does not stop the work.
- **Multi-session overview**: see projects, active sessions, recent runs, and attention states without cycling through terminal windows.
- **Mobile supervision**: review progress, answer prompts, approve actions, inspect diffs, and send follow-up messages from a phone.
- **Provider-aware session handling**: read and normalize sessions from Claude, Codex, Gemini, and OpenCode storage/event formats.
- **Remote access options**: use local/LAN access, Tailscale, a reverse proxy, a self-hosted relay, or the public relay.
- **End-to-end encrypted relay mode**: SRP-6a handles password proof, and TweetNaCl encrypts the relay traffic so the relay moves opaque ciphertext.
- **Remote device control**: stream Android devices, Android emulators, and iOS Simulators for mobile development checks.
- **File and media workflow**: upload screenshots, photos, PDFs, and code files into sessions from mobile or desktop.
- **Push-oriented triage**: surface the sessions that need attention before the ones that are merely recent.

## Supported Providers

| Provider | Status | Notes |
| --- | --- | --- |
| Claude Code | Primary | Uses the official Anthropic Agent SDK and the user's own Claude credentials. |
| Claude Ollama | Optional | Local-model path for Claude-style workflows through Ollama. |
| Codex | Primary | Uses the Codex integration for cloud-backed coding sessions. |
| Codex OSS | Optional | Uses Codex with local models via Ollama. |
| Gemini ACP | Experimental | Uses Gemini CLI ACP support for interactive agent sessions. |
| OpenCode | Experimental | Uses OpenCode server/session surfaces for multi-provider workflows. |

Provider availability is detected from the installed CLIs and local configuration. You can restrict visible providers with `ENABLED_PROVIDERS`, for example:

```bash
ENABLED_PROVIDERS=claude,codex pnpm dev
```

## Screenshots

<p align="center">
  <img src="site/public/screenshots/overview-projects-real.png" width="420" alt="Project overview with multiple AgentLine sessions">
  <img src="site/public/screenshots/session-running-real.png" width="420" alt="Running AgentLine desktop session">
</p>

<p align="center">
  <img src="site/public/screenshots/session-mobile-real.png" width="240" alt="AgentLine mobile session view">
  <img src="site/public/screenshots/sessions-list-mobile-real.png" width="240" alt="AgentLine mobile sessions list">
  <img src="site/public/screenshots/device-stream.png" width="240" alt="Remote device control stream">
</p>

## Install

For most users, start from the [latest GitHub Release](https://github.com/april-jk/AgentLine/releases/latest):

| Platform | Current release assets |
| --- | --- |
| macOS | Apple Silicon DMG |
| Windows | Installer and portable executable |
| Linux | x86_64 AppImage and amd64 DEB |
| Android | APK |
| iOS | TestFlight collection flow on the [website](https://april-jk.github.io/AgentLine/#install) |

After installing the desktop app, keep it running on the machine that should own the agent sessions. Use the Android app, mobile browser, or remote login page to supervise from another device.

## Run From Source

```bash
git clone https://github.com/april-jk/AgentLine.git
cd AgentLine
corepack enable
pnpm install
pnpm dev
```

Open [http://localhost:3400](http://localhost:3400). By default, ports are derived from `PORT`:

| Port | Purpose |
| --- | --- |
| `PORT` | Main server, default `3400` |
| `PORT + 1` | Maintenance server |
| `PORT + 2` | Vite dev server |

To run a separate development profile:

```bash
PORT=4000 AGENTLINE_PROFILE=dev pnpm dev
```

## Remote Access

AgentLine is local-first. Remote access is optional.

The easiest remote path is the public relay. In the desktop app, configure it from Settings. In a headless or source-based install with the CLI available, you can also run:

```bash
agentline --setup-remote-access --username myserver --password "secretpass123"
```

Then connect at [relay.oneceo.ai/remote/login](https://relay.oneceo.ai/remote/login).

Relay mode is designed so the relay does not learn your password or session contents. The host and client authenticate using SRP-6a, then exchange encrypted traffic through the relay. For self-hosting or alternative setups, see [docs/project/remote-access.md](docs/project/remote-access.md).

## Build And Verify

Common checks:

```bash
pnpm version:check
pnpm lint
pnpm typecheck
pnpm test
```

Useful build commands:

```bash
pnpm build:desktop-electron
pnpm typecheck:mobile-rn
pnpm --filter @agentline/client build
pnpm --filter @agentline/client build:remote
```

Packaging commands and artifact locations for the current release are documented in [docs/releases/1.0.1.md](docs/releases/1.0.1.md).

## Architecture

- `packages/server`: Hono server, provider adapters, session readers, remote-access setup, push and file APIs
- `packages/client`: React web app and remote client bundle
- `packages/desktop-electron`: Electron desktop shell and release packaging
- `packages/mobile-rn`: React Native mobile app
- `packages/relay`: optional relay service for remote access
- `packages/shared`: shared protocol, schema, provider, and relay constants
- `site`: Astro marketing site and GitHub Pages deployment

Server state defaults to `~/.agentline/`, including logs, upload storage, session indexes, metadata, auth, and remote-access configuration. Use `AGENTLINE_DATA_DIR` or `AGENTLINE_PROFILE` to isolate environments.

## Trust Boundary

AgentLine is a supervisor for agent sessions running on your machine, not a hosted coding service. Authentication with model providers stays with the provider's official CLI or SDK flow. AgentLine does not spoof provider clients, extract consumer OAuth tokens, or proxy model traffic through its own backend.

Read more:

- [How we use the Claude SDK](https://april-jk.github.io/AgentLine/tos-compliance.html)
- [Subscription access approaches](https://april-jk.github.io/AgentLine/subscription-access-approaches.html)
- [Remote access design](docs/project/remote-access.md)

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local development notes, logging, profile setup, and test commands.

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
