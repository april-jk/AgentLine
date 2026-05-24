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
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge"></a>
</p>

AgentLine は、Claude Code、Codex、Gemini、OpenCode 形式の Agent セッションを自分のマシン上で動かし続けながら、デスクトップやスマートフォンから監督できるようにするツールです。タスクがまだ走っているのに席を離れたあと、Agent が承認、追加コンテキスト、進捗確認、短い判断を必要とする場面のために作られています。

基本方針はシンプルです。Agent プロセスはローカルに置き、操作画面だけを移動できるようにします。

## 現在の状態

- 最新公開版：[v1.0.1](https://github.com/april-jk/AgentLine/releases/tag/v1.0.1)
- デスクトップ版：macOS DMG、Windows installer/portable executable、Linux AppImage と DEB
- モバイル版：GitHub Release に Android APK を公開中。iOS は現在、公式サイトで TestFlight 情報を収集中

npm tarball は主にリリース記録用です。現在の推奨インストール方法は GitHub Release のデスクトップ/モバイルビルドです。

## できること

- **ローカルで所有されるセッション**：Agent プロセスは開発マシン上で動くため、ブラウザを閉じたりデバイスを切り替えたりしても作業は止まりません。
- **複数セッションの一覧**：プロジェクト、アクティブなセッション、最近の実行、注意が必要な状態をまとめて確認できます。
- **スマートフォンでの監督**：進捗確認、プロンプトへの返信、操作承認、diff 確認、追加メッセージ送信をスマートフォンから行えます。
- **Provider を意識したセッション処理**：Claude、Codex、Gemini、OpenCode の保存形式やイベント形式を読み取り、共通表示に正規化します。
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

Provider は、インストール済み CLI とローカル設定から自動検出されます。

## スクリーンショット

<p align="center">
  <img src="site/public/screenshots/overview-projects-real.png" width="420" alt="AgentLine project overview">
  <img src="site/public/screenshots/session-running-real.png" width="420" alt="Running AgentLine desktop session">
</p>

<p align="center">
  <img src="site/public/screenshots/session-mobile-real.png" width="240" alt="AgentLine mobile session view">
  <img src="site/public/screenshots/sessions-list-mobile-real.png" width="240" alt="AgentLine mobile sessions list">
  <img src="site/public/screenshots/session-mobile-complete-real.png" width="240" alt="AgentLine mobile completed session">
</p>

## インストール

多くの場合は [latest GitHub Release](https://github.com/april-jk/AgentLine/releases/latest) から直接ダウンロードしてください。

| Platform | 直接ダウンロード |
| --- | --- |
| macOS | [DMG をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/AgentLine.Desktop-1.0.1-arm64.dmg) |
| Windows | [Installer をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/AgentLine.Desktop.Setup.1.0.1.exe) / [Portable をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/AgentLine.Desktop.1.0.1.exe) |
| Linux | [AppImage をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/agentline-desktop-1.0.1-x86_64.AppImage) / [DEB をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/agentline-desktop-1.0.1-amd64.deb) |
| Android | [APK をダウンロード](https://github.com/april-jk/AgentLine/releases/latest/download/AgentLine-Mobile-RN-1.0.1-android.apk) |
| iOS | [TestFlight 収集フローに参加](https://april-jk.github.io/AgentLine/#install) |
| その他のアセット | [Release 全体を見る](https://github.com/april-jk/AgentLine/releases/latest) |

デスクトップアプリをインストールしたら、Agent セッションを所有するマシンで起動したままにします。その後、Android アプリまたはモバイルブラウザから別デバイスで監督できます。

## アーキテクチャ

- `packages/server`：Hono server、provider adapters、session readers、push/file APIs
- `packages/client`：React Web App と remote client bundle
- `packages/desktop-electron`：Electron desktop shell と release packaging
- `packages/mobile-rn`：React Native mobile app
- `packages/shared`：共有 protocol、schema、provider、relay constants
- `site`：Astro website と GitHub Pages deployment

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
