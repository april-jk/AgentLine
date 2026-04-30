import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type VolcengineSpeechConfig,
  VolcengineSpeechService,
} from "../../src/voice-secretary/volcengine-speech.js";

const baseConfig: VolcengineSpeechConfig = {
  asrAppId: "asr-app",
  asrAccessToken: "asr-token",
  asrEndpoint:
    "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash",
  ttsAppId: "tts-app",
  ttsAccessToken: "tts-token",
  ttsEndpoint: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
  ttsVoiceType: "voice-a",
  ttsCluster: "volcano_tts",
  ttsEncoding: "mp3",
};

describe("VolcengineSpeechService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits long unidirectional TTS text into multiple requests", async () => {
    const requestTexts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        req_params?: { text?: string };
      };
      const requestText = body.req_params?.text ?? "";
      requestTexts.push(requestText);
      const audioMarker = Buffer.from(
        `chunk-${requestTexts.length}`,
        "utf8",
      ).toString("base64");
      return new Response(
        `{"code":0,"data":"${audioMarker}"}{"code":20000000,"message":"OK","data":null}`,
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const service = new VolcengineSpeechService(baseConfig);
    const longText =
      "AgentLine 现在已经有项目级 Talker 索引、项目记忆复用、Worker hook 回灌、Volcengine ASR/TTS 接通和 typed 对话直答能力。".repeat(
        4,
      );

    const audio = await service.synthesizeText(longText);

    expect(audio).not.toBeNull();
    expect(requestTexts.length).toBeGreaterThan(1);
    expect(requestTexts.join("")).toBe(longText.trim());
    expect(requestTexts.every((text) => text.length <= 140)).toBe(true);
    expect(audio?.audioBase64).toBe(
      Buffer.concat(
        requestTexts.map((_text, index) =>
          Buffer.from(`chunk-${index + 1}`, "utf8"),
        ),
      ).toString("base64"),
    );
  });

  it("streams long unidirectional TTS text chunk by chunk", async () => {
    const requestTexts: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        req_params?: { text?: string };
      };
      const requestText = body.req_params?.text ?? "";
      requestTexts.push(requestText);
      const audioMarker = Buffer.from(
        `part-${requestTexts.length}`,
        "utf8",
      ).toString("base64");
      return new Response(
        `{"code":0,"data":"${audioMarker}"}{"code":20000000,"message":"OK","data":null}`,
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const service = new VolcengineSpeechService(baseConfig);
    const longText =
      "Voice Secretary 会先直接回答项目信息，再按需把更深的问题交给项目专家。".repeat(
        5,
      );

    const chunks = [];
    for await (const chunk of service.synthesizeTextStream(longText)) {
      chunks.push(chunk);
    }

    expect(requestTexts.length).toBeGreaterThan(1);
    expect(chunks).toHaveLength(requestTexts.length);
    expect(chunks.map((chunk) => chunk.text)).toEqual(requestTexts);
    expect(
      chunks.map((chunk) =>
        Buffer.from(chunk.audioBase64, "base64").toString("utf8"),
      ),
    ).toEqual(requestTexts.map((_text, index) => `part-${index + 1}`));
  });
});
