# Volcengine Speech Integration

Voice Secretary uses Volcengine for speech input and speech output:

- ASR: streaming speech recognition.
- TTS: speech synthesis. If product notes say "STS" in this feature area, treat
  it as speech synthesis unless a separate security-token flow is explicitly
  requested.

The first integration should stay behind adapters. Business code should depend
on `ASRAdapter` and `TTSAdapter`, not on Volcengine request details.

## Official Interfaces Checked

- Streaming ASR: `wss://openspeech.bytedance.com/api/v2/asr`
- Online TTS WebSocket: `wss://openspeech.bytedance.com/api/v1/tts/ws_binary`
- Speech auth: Doubao Speech 2.0 exposes separate service authentication
  blocks per capability. ASR and TTS can have different `AppID`,
  `Access Token`, and `Secret Key`; do not assume one shared key works for
  both.
- ASR 2.0 uses WebSocket V3 headers: `X-Api-App-Key`,
  `X-Api-Access-Key`, `X-Api-Resource-Id`, and a connect/request id.
- TTS 2.0 HTTP single-direction streaming uses HTTP V3 headers:
  `X-Api-App-Id`, `X-Api-Access-Key`, `X-Api-Resource-Id`, and request id.

Keep these links as the source of truth when implementation begins:

- https://www.volcengine.com/docs/6561/80818
- https://www.volcengine.com/docs/6561/79821
- https://www.volcengine.com/docs/6561/1105162

## Environment Variables

Real secrets belong only in local `.env` files. This repository currently keeps
the variable shape in `.env.example`.

```dotenv
VOLCENGINE_SPEECH_APP_ID=
VOLCENGINE_SPEECH_ACCESS_TOKEN=

VOLCENGINE_ASR_APP_ID=
VOLCENGINE_ASR_ACCESS_TOKEN=
VOLCENGINE_ASR_SECRET_KEY=
VOLCENGINE_ASR_ENDPOINT=wss://openspeech.bytedance.com/api/v2/asr
VOLCENGINE_ASR_CLUSTER=
VOLCENGINE_ASR_LANGUAGE=zh-CN

VOLCENGINE_TTS_APP_ID=
VOLCENGINE_TTS_ACCESS_TOKEN=
VOLCENGINE_TTS_SECRET_KEY=
VOLCENGINE_TTS_ENDPOINT=wss://openspeech.bytedance.com/api/v1/tts/ws_binary
VOLCENGINE_TTS_CLUSTER=
VOLCENGINE_TTS_VOICE_TYPE=
VOLCENGINE_TTS_AUDIO_ENCODING=mp3
```

`VOLCENGINE_SPEECH_*` is a legacy shared fallback. New integrations should
prefer the capability-specific `VOLCENGINE_ASR_*` and `VOLCENGINE_TTS_*`
variables. Access tokens should be stored without a `Bearer;` prefix; adapters
add provider-specific headers when constructing requests.

## ASR Adapter Behavior

`VolcengineASRAdapter` should:

1. Open a WebSocket connection to `VOLCENGINE_ASR_ENDPOINT`.
2. Send auth with `Authorization: Bearer; ${token}`.
3. Include the configured `appid` and `cluster` in the request payload according
   to the Volcengine binary protocol.
4. Stream microphone audio in small chunks.
5. Yield partial and final `TranscriptTurn` objects.
6. Preserve provider metadata such as request id, confidence, and final/partial
   flags in an internal debug field, but expose only normalized transcripts to
   Talker.

Recommended normalized output:

```ts
interface ASRTranscriptEvent {
  type: "partial" | "final" | "error";
  text: string;
  confidence?: number;
  providerRequestId?: string;
}
```

The Talker can react to partial transcripts for responsiveness, but only final
transcripts should create planner requests.

## TTS Adapter Behavior

`VolcengineTTSAdapter` should:

1. Open a WebSocket connection to `VOLCENGINE_TTS_ENDPOINT`.
2. Send auth with `Authorization: Bearer; ${token}`.
3. Include `appid`, `cluster`, `voice_type`, and audio encoding in the request.
4. Accept short Talker text and return playable audio bytes or a stream.
5. Keep speech output short enough for phone turns.

Recommended options:

```ts
interface VolcengineTTSOptions {
  voiceType?: string;
  encoding?: "mp3" | "wav" | "pcm" | "ogg_opus";
  speedRatio?: number;
  volumeRatio?: number;
  pitchRatio?: number;
}
```

The default voice should be configured through `.env`, not hard-coded, because
voice selection is a product decision.

## Error Handling

Adapters should convert provider-specific failures into normalized errors:

```ts
type SpeechErrorCode =
  | "missing_credentials"
  | "auth_failed"
  | "connection_failed"
  | "provider_rejected_audio"
  | "provider_rejected_text"
  | "timeout"
  | "unknown";
```

During a call, Talker should give a short user-facing fallback such as "I did
not catch that, please say it again" for ASR failures and "I can continue by
text" for TTS failures.

## Security Notes

- Do not send Volcengine tokens to the browser.
- Browser microphone audio should stream to the AgentLine server, then the
  server talks to Volcengine.
- Store real credentials in `.env` only.
- Keep `.env.example` limited to placeholders.
- If a future implementation needs Volcengine IAM STS temporary credentials,
  add a separate server-side token service. Do not mix IAM STS token handling
  with speech synthesis configuration.
