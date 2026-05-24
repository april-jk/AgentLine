<p align="center">
  <img src="site/public/icon-512.png" alt="AgentLine app icon" width="96" height="96">
</p>

<h1 align="center">AgentLine</h1>

<p align="center">
  <strong>長時間動く Coding Agent のためのモバイル監督ハブ。</strong>
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

AgentLine は、Claude Code、Codex、Gemini、OpenCode 形式の Agent セッションを自分のマシン上で動かし続けながら、デスクトップやスマートフォンから監督できるようにするツールです。タスクがまだ走っているのに席を離れたあと、Agent が承認、追加コンテキスト、進捗確認、短い判断を必要とする場面のために作られています。

基本方針はシンプルです。Agent プロセスはローカルに置き、操作画面だけを移動できるようにします。

## 現在の状態

- 最新公開版：[v1.0.1](https://github.com/april-jk/AgentLine/releases/tag/v1.0.1)
- デスクトップ版：macOS DMG、Windows installer/portable executable、Linux AppImage と DEB
- モバイル版：GitHub Release に Android APK を公開中。iOS は現在、公式サイトで TestFlight 情報を収集中
- リモートアクセス：任意で `relay.oneceo.ai` の公開 relay を利用可能。通信はエンドツーエンド暗号化
- ソース実行：Node.js 20 と pnpm 9.15.1

npm tarball は主にリリース記録用です。現在の推奨インストール方法は GitHub Release のデスクトップ/モバイルビルド、またはソースからの実行です。

## できること

- **ローカルで所有されるセッション**：Agent プロセスは開発マシン上で動くため、ブラウザを閉じたりデバイスを切り替えたりしても作業は止まりません。
- **複数セッションの一覧**：プロジェクト、アクティブなセッション、最近の実行、注意が必要な状態をまとめて確認できます。
- **スマートフォンでの監督**：進捗確認、プロンプトへの返信、操作承認、diff 確認、追加メッセージ送信をスマートフォンから行えます。
- **Provider を意識したセッション処理**：Claude、Codex、Gemini、OpenCode の保存形式やイベント形式を読み取り、共通表示に正規化します。
- **複数のリモート接続方式**：local/LAN、Tailscale、reverse proxy、self-hosted relay、public relay を選べます。
- **エンドツーエンド暗号化された relay モード**：SRP-6a でパスワード証明を行い、TweetNaCl で relay 通信を暗号化します。relay は暗号文だけを中継します。
- **リモートデバイス制御**：Android デバイス、Android Emulator、iOS Simulator をスマートフォンへストリーミングし、モバイル開発の確認に使えます。
- **ファイルとメディアのワークフロー**：スクリーンショット、写真、PDF、コードファイルをデスクトップやスマートフォンからセッションへアップロードできます。
- **注意優先のトリアージ**：単に最近開いたセッションではなく、本当に対応が必要なセッションを先に出します。

## 対応 Provider

| Provider | 状態 | メモ |
| --- | --- | --- |
| Claude Code | Primary | Anthropic 公式 Agent SDK とユーザー自身の Claude 認証情報を使います。 |
| Claude Ollama | Optional | Ollama を使うローカルモデル向けの Claude 風ワークフローです。 |
| Codex | Primary | クラウドモデルを使う Codex Coding セッション向けです。 |
| Codex OSS | Optional | Ollama 経由でローカルモデルを使う Codex パスです。 |
| Gemini ACP | Experimental | Gemini CLI の ACP 機能で対話型 Agent セッションを扱います。 |
| OpenCode | Experimental | OpenCode の server/session surface を使って multi-provider ワークフローを扱います。 |

Provider は、インストール済み CLI とローカル設定から自動検出されます。表示する Provider は `ENABLED_PROVIDERS` で制限できます。

```bash
ENABLED_PROVIDERS=claude,codex pnpm dev
```

## スクリーンショット

<p align="center">
  <img src="site/public/screenshots/overview-projects-real.png" width="420" alt="AgentLine project overview">
  <img src="site/public/screenshots/session-running-real.png" width="420" alt="Running AgentLine desktop session">
</p>

<p align="center">
  <img src="site/public/screenshots/session-mobile-real.png" width="240" alt="AgentLine mobile session view">
  <img src="site/public/screenshots/sessions-list-mobile-real.png" width="240" alt="AgentLine mobile sessions list">
  <img src="site/public/screenshots/device-stream.png" width="240" alt="Remote device control stream">
</p>

## インストール

多くの場合は [latest GitHub Release](https://github.com/april-jk/AgentLine/releases/latest) から始めてください。

| Platform | 現在の公開アセット |
| --- | --- |
| macOS | Apple Silicon DMG |
| Windows | Installer と portable executable |
| Linux | x86_64 AppImage と amd64 DEB |
| Android | APK |
| iOS | 公式サイトの [TestFlight 収集フロー](https://april-jk.github.io/AgentLine/#install) |

デスクトップアプリをインストールしたら、Agent セッションを所有するマシンで起動したままにします。その後、Android アプリ、モバイルブラウザ、またはリモートログインページから別デバイスで監督できます。

## ソースから実行

```bash
git clone https://github.com/april-jk/AgentLine.git
cd AgentLine
corepack enable
pnpm install
pnpm dev
```

[http://localhost:3400](http://localhost:3400) を開きます。デフォルトでは `PORT` から各ポートが決まります。

| Port | 用途 |
| --- | --- |
| `PORT` | Main server。デフォルトは `3400` |
| `PORT + 1` | Maintenance server |
| `PORT + 2` | Vite dev server |

開発環境を分けたい場合：

```bash
PORT=4000 AGENTLINE_PROFILE=dev pnpm dev
```

## リモートアクセス

AgentLine は local-first です。リモートアクセスは任意の機能です。

一番簡単なリモート経路は public relay です。デスクトップアプリでは Settings から設定できます。headless またはソース実行で CLI が使える場合は、次のコマンドも利用できます。

```bash
agentline --setup-remote-access --username myserver --password "secretpass123"
```

その後、[relay.oneceo.ai/remote/login](https://relay.oneceo.ai/remote/login) から接続します。

Relay モードでは、relay がパスワードやセッション内容を知ることがないように設計されています。Host と Client は SRP-6a で認証し、その後 relay 経由で暗号化された通信を交換します。self-hosting や別の接続方式については [docs/project/remote-access.md](docs/project/remote-access.md) を参照してください。

## ビルドと検証

よく使うチェック：

```bash
pnpm version:check
pnpm lint
pnpm typecheck
pnpm test
```

よく使うビルド：

```bash
pnpm build:desktop-electron
pnpm typecheck:mobile-rn
pnpm --filter @agentline/client build
pnpm --filter @agentline/client build:remote
```

現在のリリースのパッケージングコマンドと成果物の場所は [docs/releases/1.0.1.md](docs/releases/1.0.1.md) にあります。

## アーキテクチャ

- `packages/server`：Hono server、provider adapters、session readers、remote-access setup、push/file APIs
- `packages/client`：React Web App と remote client bundle
- `packages/desktop-electron`：Electron desktop shell と release packaging
- `packages/mobile-rn`：React Native mobile app
- `packages/relay`：任意の remote access relay service
- `packages/shared`：共有 protocol、schema、provider、relay constants
- `site`：Astro website と GitHub Pages deployment

サーバー状態はデフォルトで `~/.agentline/` に保存されます。logs、uploads、session indexes、metadata、auth、remote-access configuration が含まれます。環境を分けるには `AGENTLINE_DATA_DIR` または `AGENTLINE_PROFILE` を使ってください。

## 信頼境界

AgentLine は、あなたのマシン上で動く Agent セッションの監督レイヤーであり、ホスト型 Coding サービスではありません。モデル Provider への認証は公式 CLI または SDK のフローに任せます。AgentLine は Provider クライアントを偽装せず、ユーザーの OAuth token を抽出せず、モデル通信を自前バックエンドへプロキシしません。

詳しくはこちら：

- [How we use the Claude SDK](https://april-jk.github.io/AgentLine/tos-compliance.html)
- [Subscription access approaches](https://april-jk.github.io/AgentLine/subscription-access-approaches.html)
- [Remote access design](docs/project/remote-access.md)

## 開発

ローカル開発、ログ、profile、テストコマンドについては [DEVELOPMENT.md](DEVELOPMENT.md) を参照してください。

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
