# Website Changelog

All notable changes to the AgentLine website and remote relay client will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [site-v1.5.43] - 2026-05-26

### Changed
- Refine the homepage title, description, and hero copy to describe AgentLine as a local-first multi-device control surface for AI coding agents.

## [site-v1.5.42] - 2026-05-25

### Changed
- Point homepage platform download buttons directly at the published v1.0.5 GitHub Release assets for macOS, Windows, Linux, and Android.
- Add homepage GitHub project, issue, release, and pull request links so users can inspect the repo and contribute changes.

## [site-v1.5.41] - 2026-05-24

### Fixed
- Serve the GitHub Pages website from the custom domain root so CSS, images, and the remote client load without the old `/AgentLine/` prefix.

## [site-v1.5.40] - 2026-05-24

### Changed
- Remove ZIP and AAB download calls-to-action from the homepage download center.
- Let homepage download buttons resolve matching assets from the latest GitHub Release when available.
- Clarify Linux download choices with direct AppImage and DEB buttons plus a latest Release fallback for other assets.

## [site-v1.5.39] - 2026-05-23

### Fixed
- Improve the News page layout on small screens with proper header spacing, tighter hero media, and mobile-friendly update cards.

## [site-v1.5.38] - 2026-05-23

### Changed
- Reframe the News page as AgentLine product updates with a smaller Field Notes section.
- Remove stale npm install and old-brand references from linked site articles.

## [site-v1.5.37] - 2026-05-22

### Changed
- Replace the unavailable quickstart npm command with a desktop-first setup path.
- Give the homepage quickstart section a roomier three-step layout.

## [site-v1.5.36] - 2026-05-22

### Changed
- Refine the homepage section progress control into a slimmer desktop rail.
- Add desktop wheel snapping so committed scroll gestures land on the next or previous homepage section.

## [site-v1.5.35] - 2026-05-22

### Changed
- Give homepage sections more viewport-scale breathing room with native scroll snap.
- Add lightweight section anchor dots for desktop homepage navigation.
- Tune mobile and reduced-motion behavior so the landing page remains readable and responsive.

## [site-v1.5.34] - 2026-05-22

### Changed
- Use the current app icon in the website header brand mark.
- Convert the homepage FAQ cards into an expandable accordion list.

## [site-v1.5.33] - 2026-05-22

### Fixed
- Load website CSS, icons, screenshots, and the remote client correctly from the GitHub Pages `/AgentLine/` subpath.

## [site-v1.5.32] - 2026-05-22

### Changed
- Point homepage download calls-to-action at the current public release assets.
- Collapse the marketing navigation back into a single homepage product story.
- Align public website icons with the current app mark.

## [site-v1.5.31] - 2026-04-13

### Fixed
- Prefer persisted provider for session resume and agents

## [site-v1.5.30] - 2026-04-13

### Fixed
- Fix clearing empty server settings

## [site-v1.5.29] - 2026-04-05

### Added
- Lifecycle webhook support
- ToolSearch schema validation
- Relay host upsert on auto-resume for reliable reconnect

### Changed
- Update Claude model selection options
- Move persist-remote-sessions toggle to Remote Access settings

### Fixed
- Avoid new-session remounts on project refresh
- Fix relay host ID race condition during session refresh
- Fix modal title overflow on long names

## [site-v1.5.28] - 2026-04-02

### Added
- Local media preview modal for file paths in markdown
- Prefer recent project for new sessions

## [site-v1.5.27] - 2026-03-29

### Added
- Centralized cross-provider session listing
- Session summary caching for Gemini and Codex providers

### Fixed
- Fix streaming edit patch filenames
- Improve PTY and Codex PTY tool rendering
- Fix mixed-provider session resolution and titles
- Preserve Claude sibling ordering on reload
- Stabilize session replay and queued prompt rendering
- Detect Codex CLI from desktop app sandbox-bin location

## [site-v1.5.26] - 2026-03-27

### Added
- New session defaults: save preferred provider, model, and permission mode
- Local image viewing for Codex imageView events

### Fixed
- Resolve allowed image paths for macOS /tmp symlink
- Deduplicate sessions on Windows caused by mixed-slash cwds

## [site-v1.5.25] - 2026-03-22

### Fixed
- Widen tool_result content type for broader SDK compatibility
- Stabilize Claude persisted session rendering
- Guard localStorage calls in i18n module
- Prevent false unread notifications from late JSONL writes
- Exclude progress messages from DAG to prevent dead branches

## [site-v1.5.24] - 2026-03-21

### Added
- Client-side i18n with lazy-loaded locale bundles (English, Chinese, Spanish, French, German, Japanese)
- Language selector in Appearance settings

## [site-v1.5.23] - 2026-03-15

### Changed
- Update Claude Agent SDK to 0.2.76 with runtime context window detection
- Support SDK 0.2.76+ Agent tool format and subagents directory

## [site-v1.5.22] - 2026-03-15

### Changed
- Update remote device control post to cover iOS Simulator support alongside Android
- Replace device list screenshot to show iOS Simulators section
- Add iOS Simulator stream screenshot

## [site-v1.5.21] - 2026-03-13

### Added
- iOS simulator HID input support in remote client
- `/model` slash command for mid-session model switching
- PDF file previews in Read tool renderer

### Fixed
- Fix inbox race condition
- Prevent Enter key from triggering send during IME composition
- Improve Codex replay deduplication and session reconnect merging
- Fix Codex session cloning in mixed projects
- Keep pending Codex Bash rows collapsed

### Changed
- Reduce routine update checks

## [site-v1.5.20] - 2026-03-03

### Changed
- Remote device control post: clarify zero-dependency architecture (pre-built binaries, downloaded on demand)

## [site-v1.5.19] - 2026-03-03

### Added
- Per-article Open Graph image support in ArticleLayout
- Custom OG image for remote device control blog post

## [site-v1.5.18] - 2026-03-03

### Added
- Blog post: Android Dev Without a Desktop — Remote Device Control
- Device control feature card on homepage
- Device stream screenshot in homepage and README galleries
- Screenshots: device sidebar, device list, device stream, device settings

### Changed
- Homepage announcement banner now promotes remote device control

## [site-v1.5.17] - 2026-02-27

### Added
- New article: "What I Learned from the OpenClaw Guy's AI Coding Workflow"
- All news items now expanded by default on news page

## [site-v1.5.16] - 2026-02-25

### Fixed
- Fix spectrum diagram rendering: use ASCII arrows instead of variable-width em dashes
- Add proper pre/code block styling so text aligns with clean right edge

## [site-v1.5.15] - 2026-02-25

### Fixed
- Fix .html URLs serving blank page (remote SPA 404 fallback instead of actual page)
- Switch Astro to `build.format: "file"` so pages output as .html files directly
- Remove obsolete meta-refresh redirect stubs from public/

## [site-v1.5.14] - 2026-02-25

### Fixed
- Hide Screenshots, Features, and FAQ nav links on mobile to prevent header overflow

## [site-v1.5.13] - 2026-02-25

### Added
- Light/dark mode toggle in header with system theme default
- Light theme CSS variables with proper contrast
- Theme preference persisted to localStorage across page loads

### Fixed
- Hardcoded hex colors in announcement gradient and comparison table now use CSS variables

## [site-v1.5.12] - 2026-02-25

### Fixed
- Thinking mode toggle now persists correctly in localStorage
- Stream reconnects automatically after thinking-mode process restart
- "On" thinking mode uses adaptive + effort (avoids CLI crash on Opus 4.6)

## [site-v1.5.11] - 2026-02-25

### Added
- Blog post: Five Ways to Access AI Subscriptions Programmatically
- News page entry for subscription access approaches article

## [site-v1.5.9] - 2026-02-25

### Changed
- Migrate website from plain HTML to Astro

### Added
- Subscription access approaches page

## [site-v1.5.8] - 2026-02-25

### Changed
- Improve homepage comparison section heading

## [site-v1.5.7] - 2026-02-25

### Added
- Homepage: Remote Control comparison section and updated announcement banner

## [site-v1.5.6] - 2026-02-25

### Changed
- Update connectivity comparison: hosted relay parity, telemetry privacy, no extra install

## [site-v1.5.5] - 2026-02-25

### Added
- Feature comparison table and TLDR summary on Remote Control blog post

## [site-v1.5.4] - 2026-02-24

### Added
- Blog post: Claude Code Remote Control vs AgentLine

## [site-v1.5.3] - 2026-02-23

### Added
- Blog post: Google banning subscribers for using OpenClaw

## [site-v1.5.2] - 2026-02-22

### Added
- Codex shell tool rendering for grep/read workflows

### Fixed
- Fix HTTP LAN access: randomUUID fallback for insecure contexts and non-secure cookie handling
- Lazy-load tssrp6a to fix crash on HTTP LAN access (insecure context)
- Auth disable now clears credentials and simplifies enable flow

## [site-v1.5.1] - 2026-02-22

### Fixed
- Fix send racing ahead of in-flight file uploads
- Improve pending tool render and tighten settings copy

## [site-v1.5.0] - 2026-02-22

### Security
- Harden auth enable flow and add secure recovery path
- Harden relay replay protection for SRP sessions
- Harden session resume replay defenses for untrusted relays
- Patch vulnerable dependencies (bn.js)

### Added
- Legacy relay protocol compatibility for old servers
- Global agent instructions setting for cross-project context
- Permission rules for session bash command filtering
- Safe area insets for Tauri mobile edge-to-edge mode

### Fixed
- Guard SecureConnection send when WebSocket global is unavailable
- Stop reconnect loop on intentional remote disconnect
- Fix stale reconnect race and reduce reconnect noise

### Changed
- Default remote sessions to memory with dev persistence toggle
- Warn relay users about resume protocol mismatch
- Improve server update modal copy and layout

## [site-v1.4.2] - 2026-02-19

### Changed
- Polish value prop copy (disconnect card, approval urgency, encryption claim)
- Brighten feature card link color for better contrast on dark backgrounds

## [site-v1.4.1] - 2026-02-19

### Changed
- Rewrite relay value prop and feature card to highlight free relay access (no Tailscale/VPN needed)
- Restore "Log In to Your Server" as secondary CTA in hero
- Update hero screenshot caption to "Fix issues from anywhere"

### Added
- Desktop remote access settings screenshot

## [site-v1.4.0] - 2026-02-19

### Changed
- Rewrite hero headline and subhead to be outcome-driven ("Walk away. Your agents keep shipping.")
- Make "Get Started" the primary CTA, move "Log In" to nav only
- Rewrite value prop cards to match marketing pillars: seamless handoff, survive disconnects, lock-screen approvals, dashboard, self-hosted encryption
- Tighten all value prop copy

### Added
- Hero showcase with two phone screenshots (approve edit, completed session)
- TOS compliance feature card with link to SDK docs
- README TOS compliance section

## [site-v1.3.2] - 2026-02-19

### Added
- Blog post: The Agent SDK Auth Scare (and Why You're Fine)

### Changed
- Update Jan 11 compliance post to reflect that we don't handle auth at all

## [site-v1.3.1] - 2026-02-18

### Fixed
- Fix Codex provider labeling (CLI, not Desktop)

## [site-v1.3.0] - 2026-02-18

### Changed
- Highlight Codex CLI as fully supported alongside Claude Code
- Update hero, announcement banner, features, and FAQ for multi-provider messaging
- Update page title and meta description to mention Codex

## [site-v1.2.0] - 2026-02-16

### Added
- Blog post: OpenClaw and AgentLine — Two Paths to the Same Future
- News entry linking to the blog post

### Fixed
- Link color in news item metadata now uses green accent

## [site-v1.1.0] - 2025-02-13

### Fixed
- Remove relay login redirect routes that dropped query params and hash fragments

## [site-v1.0.0] - 2025-02-01

### Added
- Initial tagged release
- Landing page, privacy policy, ToS compliance docs
- Remote relay client at /remote
- Public relay documentation
