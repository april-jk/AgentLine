# AgentLine 15s HyperFrames Promo

Short product promo for AgentLine, built as a HyperFrames HTML composition.

## Storyboard

| Time | Beat | On-screen copy |
| --- | --- | --- |
| 0-3s | Product hook with running desktop session | Coding agents keep moving, even when you step away. |
| 3-6s | Phone approval moment | Approve, edit, and unblock from your phone. |
| 6-9s | Multi-session dashboard | One dashboard for every active repo. |
| 9-12s | Self-hosted/security positioning | Runs on your machine. Direct or relay, end-to-end encrypted. |
| 12-15s | Finished result and CTA | AgentLine. Supervise from anywhere. |

## Voiceover

`voiceover.txt` contains the lively Chinese voiceover aligned to the five scene beats.
`voiceover-zh.aiff` is generated with the local macOS `Flo (中文（中国大陆）)` voice.
`bgm-active.m4a` is a generated upbeat stereo synth bed, mixed under the voiceover with light ducking so it remains audible.

## Preview

```bash
cd marketing/hyperframes-agentline-15s
npm install
npm run preview
```

## Render

```bash
cd marketing/hyperframes-agentline-15s
npm install
npm run render
```

The final Chinese output is `agentline-15s-zh-bgm.mp4`, with Chinese narration and upbeat BGM mixed in.
`agentline-15s.mp4` is kept as the earlier voiceover-only render.

The composition is `1920x1080`, `60fps`, and exactly `15s`.

## Notes

- The composition entrypoint is `index.html`.
- The video uses existing AgentLine brand assets and real product screenshots copied into `assets/`.
- HyperFrames lint passes with 0 errors and 0 warnings.
- Rendering uses local `ffmpeg-static` and `ffprobe-static` dev dependencies, so it does not require a global FFmpeg install.
- The final audio is post-muxed with FFmpeg, so HyperFrames may warn about standalone audio files not referenced by `<audio>` tags.
- A browser smoke test can still open `index.html` directly for visual inspection.
