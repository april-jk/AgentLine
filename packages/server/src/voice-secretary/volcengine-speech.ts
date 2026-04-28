import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { WebSocket } from "ws";
import type { ServerSettings } from "../services/ServerSettingsService.js";

const DEFAULT_ASR_ENDPOINT =
  "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const DEFAULT_TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v1/tts";
const DEFAULT_ASR_RESOURCE_ID = "volc.bigasr.auc_turbo";
const DEFAULT_ASR_WS_RESOURCE_IDS = [
  "volc.bigasr.sauc.duration",
  "volc.bigasr.sauc.concurrent",
  "volc.seedasr.sauc.duration",
  "volc.seedasr.sauc.concurrent",
];
const DEFAULT_TTS_CLUSTER = "volcano_tts";
const DEFAULT_TTS_V3_RESOURCE_IDS = ["seed-tts-2.0", "volc.service_type.10029"];

export interface VolcengineSpeechConfig {
  asrAppId: string;
  asrAccessToken: string;
  asrSecretKey?: string;
  asrEndpoint: string;
  ttsAppId: string;
  ttsAccessToken: string;
  ttsSecretKey?: string;
  ttsEndpoint: string;
  ttsVoiceType: string;
  ttsCluster: string;
  ttsEncoding: "mp3" | "wav";
}

interface VolcengineAsrResponse {
  result?: {
    text?: string;
    utterances?: Array<{
      text?: string;
      words?: Array<{ confidence?: number }>;
    }>;
  };
}

interface VolcengineTtsResponse {
  code?: number;
  message?: string;
  data?: string;
}

export interface VolcengineSpeechTurnAudio {
  audioBase64: string;
  contentType: string;
  text: string;
}

function normalizeSpeechEndpoint(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return /^(https?|wss?):\/\//i.test(trimmed) ? trimmed : fallback;
}

export function getVolcengineSpeechConfigFromSettings(
  settings?: Pick<
    ServerSettings,
    | "phoneVolcengineAsrAppId"
    | "phoneVolcengineAsrAccessToken"
    | "phoneVolcengineAsrSecretKey"
    | "phoneVolcengineSpeechSecretKey"
    | "phoneVolcengineAsrEndpoint"
    | "phoneVolcengineTtsAppId"
    | "phoneVolcengineTtsAccessToken"
    | "phoneVolcengineTtsSecretKey"
    | "phoneVolcengineSpeechSecretKey"
    | "phoneVolcengineTtsEndpoint"
    | "phoneVolcengineTtsVoiceType"
  >,
): VolcengineSpeechConfig | null {
  const asrAppId = settings?.phoneVolcengineAsrAppId?.trim();
  const asrAccessToken = settings?.phoneVolcengineAsrAccessToken?.trim();
  const ttsAppId = settings?.phoneVolcengineTtsAppId?.trim();
  const ttsAccessToken = settings?.phoneVolcengineTtsAccessToken?.trim();
  const ttsVoiceType = settings?.phoneVolcengineTtsVoiceType?.trim();

  if (
    !asrAppId ||
    !asrAccessToken ||
    !ttsAppId ||
    !ttsAccessToken ||
    !ttsVoiceType
  ) {
    return null;
  }

  return {
    asrAppId,
    asrAccessToken,
    asrSecretKey:
      settings?.phoneVolcengineAsrSecretKey?.trim() ||
      settings?.phoneVolcengineSpeechSecretKey?.trim() ||
      undefined,
    asrEndpoint: normalizeSpeechEndpoint(
      settings?.phoneVolcengineAsrEndpoint,
      DEFAULT_ASR_ENDPOINT,
    ),
    ttsAppId,
    ttsAccessToken,
    ttsSecretKey:
      settings?.phoneVolcengineTtsSecretKey?.trim() ||
      settings?.phoneVolcengineSpeechSecretKey?.trim() ||
      undefined,
    ttsEndpoint: normalizeSpeechEndpoint(
      settings?.phoneVolcengineTtsEndpoint,
      DEFAULT_TTS_ENDPOINT,
    ),
    ttsVoiceType,
    ttsCluster: DEFAULT_TTS_CLUSTER,
    ttsEncoding: "mp3",
  };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function isVolcengineTtsV3Endpoint(endpoint: string): boolean {
  return endpoint.includes("/api/v3/tts/");
}

function isWebSocketEndpoint(endpoint: string): boolean {
  return /^wss?:\/\//i.test(endpoint);
}

function parseWavePcmS16Le(input: Uint8Array): Uint8Array {
  if (input.length < 12) {
    return input;
  }

  const riff = String.fromCharCode(...input.slice(0, 4));
  const wave = String.fromCharCode(...input.slice(8, 12));
  if (riff !== "RIFF" || wave !== "WAVE") {
    return input;
  }

  let offset = 12;
  while (offset + 8 <= input.length) {
    const chunkHeader = input.slice(offset, offset + 8);
    if (chunkHeader.length < 8) {
      break;
    }
    const chunkId = String.fromCharCode(
      chunkHeader[0] ?? 0,
      chunkHeader[1] ?? 0,
      chunkHeader[2] ?? 0,
      chunkHeader[3] ?? 0,
    );
    const chunkSize =
      (chunkHeader[4] ?? 0) |
      ((chunkHeader[5] ?? 0) << 8) |
      ((chunkHeader[6] ?? 0) << 16) |
      ((chunkHeader[7] ?? 0) << 24);
    const dataOffset = offset + 8;
    if (chunkId === "data" && dataOffset + chunkSize <= input.length) {
      return input.slice(dataOffset, dataOffset + chunkSize);
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return input;
}

function createProtocolHeader(
  messageType: number,
  flags: number,
  serialization: number,
  compression: number,
): Uint8Array {
  return Uint8Array.from([
    0x11,
    ((messageType & 0x0f) << 4) | (flags & 0x0f),
    ((serialization & 0x0f) << 4) | (compression & 0x0f),
    0x00,
  ]);
}

function createWsFrame(
  header: Uint8Array,
  payload: Uint8Array,
  sequence?: number,
): Uint8Array {
  const extraBytes = sequence === undefined ? 0 : 4;
  const frame = new Uint8Array(header.length + extraBytes + 4 + payload.length);
  frame.set(header, 0);
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = header.length;
  if (sequence !== undefined) {
    view.setInt32(offset, sequence, false);
    offset += 4;
  }
  view.setUint32(offset, payload.length, false);
  offset += 4;
  frame.set(payload, offset);
  return frame;
}

function decodeWsJsonPayload(
  payload: Uint8Array,
  compression: number,
): Record<string, unknown> {
  const bytes =
    compression === 1 ? gunzipSync(Buffer.from(payload)) : Buffer.from(payload);
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

function extractAsrResult(
  payload: Record<string, unknown>,
): { text: string; confidence?: number } | null {
  const result = payload.result as
    | {
        text?: string;
        utterances?: Array<{
          text?: string;
          words?: Array<{ confidence?: number }>;
        }>;
      }
    | undefined;
  const text = result?.text?.trim();
  if (!text) return null;

  const confidence = result?.utterances?.[0]?.words?.[0]?.confidence;
  return {
    text,
    confidence: Number.isFinite(confidence) ? confidence : undefined,
  };
}

export class VolcengineSpeechService {
  constructor(private readonly config: VolcengineSpeechConfig | null) {}

  get enabled(): boolean {
    return this.config !== null;
  }

  async transcribeAudio(
    audioBytes: Uint8Array,
  ): Promise<{ text: string; confidence?: number } | null> {
    if (!this.config) return null;
    if (isWebSocketEndpoint(this.config.asrEndpoint)) {
      return this.transcribeAudioWithWs(audioBytes);
    }
    return this.transcribeAudioWithHttp(audioBytes);
  }

  private async transcribeAudioWithHttp(
    audioBytes: Uint8Array,
  ): Promise<{ text: string; confidence?: number } | null> {
    if (!this.config) return null;

    const sharedHeaders = {
      "Content-Type": "application/json",
      "X-Api-Resource-Id": DEFAULT_ASR_RESOURCE_ID,
      "X-Api-Request-Id": randomUUID(),
      "X-Api-Sequence": "-1",
    };
    const requestBody = JSON.stringify({
      user: { uid: "agentline-voice-secretary" },
      audio: { data: toBase64(audioBytes) },
      request: { model_name: "bigmodel" },
    });

    const authVariants: Array<Record<string, string>> = [
      {
        "X-Api-App-Key": this.config.asrAppId,
        "X-Api-Access-Key": this.config.asrAccessToken,
      },
    ];
    if (this.config.asrSecretKey) {
      authVariants.push({
        "X-Api-Key": this.config.asrSecretKey,
      });
    }

    const errors: string[] = [];
    for (const authHeaders of authVariants) {
      const response = await fetch(this.config.asrEndpoint, {
        method: "POST",
        headers: {
          ...sharedHeaders,
          ...authHeaders,
        },
        body: requestBody,
      });

      const statusCode = response.headers.get("X-Api-Status-Code");
      const statusMessage = response.headers.get("X-Api-Message");
      if (!response.ok || statusCode !== "20000000") {
        const authLabel = "X-Api-Key" in authHeaders ? "x-api-key" : "legacy";
        errors.push(
          `${authLabel}${statusCode ? ` (${statusCode})` : ""}${statusMessage ? `: ${statusMessage}` : ""}`,
        );
        continue;
      }

      const payload = (await response.json()) as VolcengineAsrResponse;
      const text = payload.result?.text?.trim();
      const firstConfidence =
        payload.result?.utterances?.[0]?.words?.[0]?.confidence;
      if (!text) {
        throw new Error("Volcengine ASR returned empty text");
      }

      return {
        text,
        confidence: Number.isFinite(firstConfidence)
          ? firstConfidence
          : undefined,
      };
    }

    throw new Error(
      `Volcengine ASR failed${errors.length > 0 ? `: ${errors.join(" | ")}` : ""}`,
    );
  }

  private async transcribeAudioWithWs(
    audioBytes: Uint8Array,
  ): Promise<{ text: string; confidence?: number } | null> {
    if (!this.config) return null;
    const config = this.config;

    const pcmBytes = parseWavePcmS16Le(audioBytes);
    const requestPayload = gzipSync(
      Buffer.from(
        JSON.stringify({
          user: { uid: "agentline-voice-secretary" },
          audio: {
            format: "pcm",
            codec: "raw",
            rate: 16000,
            bits: 16,
            channel: 1,
            language: "zh-CN",
          },
          request: {
            model_name: "bigmodel",
            enable_itn: true,
            enable_punc: true,
            enable_ddc: false,
            show_utterances: true,
            result_type: "full",
          },
        }),
        "utf8",
      ),
    );

    const fullClientHeader = createProtocolHeader(0x1, 0x0, 0x1, 0x1);
    const audioOnlyFinalHeader = createProtocolHeader(0x2, 0x2, 0x0, 0x1);
    const audioPayload = gzipSync(Buffer.from(pcmBytes));

    const errors: string[] = [];
    for (const resourceId of DEFAULT_ASR_WS_RESOURCE_IDS) {
      try {
        const connectId = randomUUID();
        const result = await new Promise<{ text: string; confidence?: number }>(
          (resolve, reject) => {
            const ws = new WebSocket(config.asrEndpoint, {
              headers: {
                "X-Api-App-Key": config.asrAppId,
                "X-Api-Access-Key": config.asrAccessToken,
                "X-Api-Resource-Id": resourceId,
                "X-Api-Connect-Id": connectId,
              },
            });

            let settled = false;
            let sentAudio = false;
            const finish = (callback: () => void) => {
              if (settled) return;
              settled = true;
              try {
                ws.close();
              } catch {}
              callback();
            };

            ws.once("error", (error) => {
              finish(() =>
                reject(
                  new Error(
                    `${resourceId}: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                ),
              );
            });

            ws.once("open", () => {
              ws.send(createWsFrame(fullClientHeader, requestPayload));
            });

            ws.on("message", (data) => {
              const bytes = Buffer.isBuffer(data)
                ? new Uint8Array(data)
                : typeof data === "string"
                  ? new Uint8Array(Buffer.from(data))
                  : new Uint8Array(data as ArrayBuffer);
              if (bytes.length < 8) {
                return;
              }

              const byte0 = bytes[0];
              const byte1 = bytes[1];
              const byte2 = bytes[2];
              if (
                byte0 === undefined ||
                byte1 === undefined ||
                byte2 === undefined
              ) {
                return;
              }

              const version = byte0 >> 4;
              const headerSize = (byte0 & 0x0f) * 4;
              const messageType = byte1 >> 4;
              const flags = byte1 & 0x0f;
              const compression = byte2 & 0x0f;
              if (version !== 1 || headerSize > bytes.length) {
                return;
              }

              const view = new DataView(
                bytes.buffer,
                bytes.byteOffset,
                bytes.byteLength,
              );

              if (messageType === 0x9) {
                let offset = headerSize;
                if (flags === 0x1 || flags === 0x3) {
                  offset += 4;
                }
                const payloadSize = view.getUint32(offset, false);
                offset += 4;
                const payload = bytes.slice(offset, offset + payloadSize);
                const json = decodeWsJsonPayload(payload, compression);
                if (!sentAudio) {
                  sentAudio = true;
                  ws.send(createWsFrame(audioOnlyFinalHeader, audioPayload));
                }
                const extracted = extractAsrResult(json);
                if (extracted && flags === 0x3) {
                  finish(() => resolve(extracted));
                }
                return;
              }

              if (messageType === 0xf) {
                const errorCode = view.getUint32(headerSize, false);
                const payloadSize = view.getUint32(headerSize + 4, false);
                const payload = bytes.slice(
                  headerSize + 8,
                  headerSize + 8 + payloadSize,
                );
                let message = "";
                try {
                  message = JSON.stringify(
                    decodeWsJsonPayload(payload, compression),
                  );
                } catch {
                  message = Buffer.from(payload).toString("utf8");
                }
                finish(() =>
                  reject(
                    new Error(
                      `${resourceId}: ${errorCode}${message ? ` ${message}` : ""}`,
                    ),
                  ),
                );
              }
            });

            ws.once("close", () => {
              if (!settled) {
                settled = true;
                reject(
                  new Error(
                    `${resourceId}: websocket closed before final ASR result`,
                  ),
                );
              }
            });
          },
        );

        return result;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(
      `Volcengine ASR failed${errors.length > 0 ? `: ${errors.join(" | ")}` : ""}`,
    );
  }

  async synthesizeText(
    text: string,
  ): Promise<VolcengineSpeechTurnAudio | null> {
    if (!this.config) return null;

    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error("Volcengine TTS requires non-empty text");
    }

    if (isVolcengineTtsV3Endpoint(this.config.ttsEndpoint)) {
      return this.synthesizeTextV3(trimmedText);
    }

    return this.synthesizeTextV1(trimmedText);
  }

  private async synthesizeTextV1(
    trimmedText: string,
  ): Promise<VolcengineSpeechTurnAudio> {
    if (!this.config) {
      throw new Error("Volcengine TTS is not configured");
    }

    const response = await fetch(this.config.ttsEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer; ${this.config.ttsAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app: {
          appid: this.config.ttsAppId,
          token: this.config.ttsAccessToken,
          cluster: this.config.ttsCluster,
        },
        user: {
          uid: "agentline-voice-secretary",
        },
        audio: {
          voice_type: this.config.ttsVoiceType,
          encoding: this.config.ttsEncoding,
          rate: 24000,
          speed_ratio: 1,
        },
        request: {
          reqid: randomUUID(),
          text: trimmedText,
          operation: "query",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Volcengine TTS failed (${response.status})`);
    }

    const payload = (await response.json()) as VolcengineTtsResponse;
    if (payload.code !== 3000 || !payload.data) {
      throw new Error(
        `Volcengine TTS returned code ${payload.code ?? "unknown"}${payload.message ? `: ${payload.message}` : ""}`,
      );
    }

    return {
      audioBase64: payload.data,
      contentType:
        this.config.ttsEncoding === "wav" ? "audio/wav" : "audio/mpeg",
      text: trimmedText,
    };
  }

  private async synthesizeTextV3(
    trimmedText: string,
  ): Promise<VolcengineSpeechTurnAudio> {
    if (!this.config) {
      throw new Error("Volcengine TTS is not configured");
    }

    const errors: string[] = [];
    const endpointUrl = new URL(this.config.ttsEndpoint);
    const submitUrl = new URL(
      "/api/v3/tts/submit",
      endpointUrl.origin,
    ).toString();
    const queryUrl = new URL(
      "/api/v3/tts/query",
      endpointUrl.origin,
    ).toString();

    for (const resourceId of DEFAULT_TTS_V3_RESOURCE_IDS) {
      const submitRequestId = randomUUID();
      const submitResponse = await fetch(submitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-App-Id": this.config.ttsAppId,
          "X-Api-Access-Key": this.config.ttsAccessToken,
          "X-Api-Resource-Id": resourceId,
          "X-Api-Request-Id": submitRequestId,
        },
        body: JSON.stringify({
          user: { uid: "agentline-voice-secretary" },
          unique_id: submitRequestId,
          req_params: {
            text: trimmedText,
            speaker: this.config.ttsVoiceType,
            audio_params: {
              format: this.config.ttsEncoding,
              sample_rate: this.config.ttsEncoding === "wav" ? 16000 : 24000,
            },
          },
        }),
      });

      const submitJson = (await submitResponse.json().catch(() => null)) as {
        code?: number;
        message?: string;
        data?: { task_id?: string };
      } | null;
      const taskId = submitJson?.data?.task_id;
      if (!submitResponse.ok || submitJson?.code !== 20000000 || !taskId) {
        errors.push(
          `${resourceId}: submit failed${submitJson?.message ? ` ${submitJson.message}` : ""}`,
        );
        continue;
      }

      let audioUrl: string | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const queryResponse = await fetch(queryUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Api-App-Id": this.config.ttsAppId,
            "X-Api-Access-Key": this.config.ttsAccessToken,
            "X-Api-Resource-Id": resourceId,
            "X-Api-Request-Id": randomUUID(),
          },
          body: JSON.stringify({ task_id: taskId }),
        });
        const queryJson = (await queryResponse.json().catch(() => null)) as {
          code?: number;
          message?: string;
          data?: {
            task_status?: number;
            audio_url?: string;
          };
        } | null;
        if (!queryResponse.ok || queryJson?.code !== 20000000) {
          errors.push(
            `${resourceId}: query failed${queryJson?.message ? ` ${queryJson.message}` : ""}`,
          );
          break;
        }
        if (queryJson.data?.audio_url) {
          audioUrl = queryJson.data.audio_url;
          break;
        }
        if (queryJson.data?.task_status === 3) {
          errors.push(`${resourceId}: task failed`);
          break;
        }
      }

      if (!audioUrl) {
        continue;
      }

      const audioResponse = await fetch(audioUrl);
      if (!audioResponse.ok) {
        errors.push(
          `${resourceId}: audio download failed (${audioResponse.status})`,
        );
        continue;
      }
      const audioBytes = new Uint8Array(await audioResponse.arrayBuffer());
      return {
        audioBase64: toBase64(audioBytes),
        contentType:
          audioResponse.headers.get("content-type") ??
          (this.config.ttsEncoding === "wav" ? "audio/wav" : "audio/mpeg"),
        text: trimmedText,
      };
    }

    throw new Error(
      `Volcengine TTS v3 failed${errors.length > 0 ? `: ${errors.join(" | ")}` : ""}`,
    );
  }
}
