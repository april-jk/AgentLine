import { afterEach, describe, expect, it, vi } from "vitest";
import {
  VoiceSecretaryTalkerLlm,
  getVoiceSecretaryLlmConfigFromSettings,
} from "../../src/voice-secretary/talker-llm.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getVoiceSecretaryLlmConfigFromSettings", () => {
  it("returns null for non-custom Talker providers", () => {
    expect(
      getVoiceSecretaryLlmConfigFromSettings({
        phoneTalkerProvider: "codex",
        phoneTalkerModel: "gpt-5.2",
        phoneTalkerApiBaseUrl: "https://example.com/v1/",
        phoneTalkerApiKey: "sk-test",
      }),
    ).toBeNull();
  });

  it("builds an OpenAI-compatible config for the custom API provider", () => {
    expect(
      getVoiceSecretaryLlmConfigFromSettings(
        {
          phoneTalkerProvider: "custom-api",
          phoneTalkerModel: "qwen-max",
          phoneTalkerApiBaseUrl: "https://example.com/v1/",
          phoneTalkerApiKey: "sk-test",
          phoneTalkerApiDisableThinking: true,
        },
        { VOICE_SECRETARY_LLM_TIMEOUT_MS: "15000" } as NodeJS.ProcessEnv,
      ),
    ).toEqual({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      disableThinking: true,
      model: "qwen-max",
      timeoutMs: 15000,
    });
  });

  it("sends disable-thinking hints when the custom API toggle is enabled", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}"));
        expect(body.reasoning_effort).toBe("none");
        expect(body.reasoning).toEqual({ effort: "none" });
        expect(body.thinking).toEqual({ type: "disabled" });

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"openingText":"收到。"}',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const llm = new VoiceSecretaryTalkerLlm({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      disableThinking: true,
      model: "qwen-max",
      timeoutMs: 5000,
    });

    await expect(
      llm.createOpeningText(
        {
          projectPath: "/tmp/project",
          utterance: "下一步是什么",
        },
        "project",
      ),
    ).resolves.toBe("收到。");
  });
});
