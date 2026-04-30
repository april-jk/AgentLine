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

  it("parses JSON even when the custom API wraps it in markdown fences", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"openingText":"这是来自自定义接口的回复。"}\n```',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const llm = new VoiceSecretaryTalkerLlm({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "deepseek-v4-flash",
      timeoutMs: 5000,
    });

    await expect(
      llm.createOpeningText(
        {
          projectPath: "/tmp/project",
          utterance: "最近一次提交是什么",
        },
        "project",
      ),
    ).resolves.toBe("这是来自自定义接口的回复。");
  });

  it("sanitizes markdown and code-like paths into spoken text", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"openingText":"# 标题\\n- 已接入 `/api/voice-secretary`，相关实现主要在 packages/server/src/routes/voice-secretary.ts。"}',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const llm = new VoiceSecretaryTalkerLlm({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      model: "deepseek-v4-flash",
      timeoutMs: 5000,
    });

    await expect(
      llm.createOpeningText(
        {
          projectPath: "/tmp/project",
          utterance: "这个语音模块怎么实现的？",
        },
        "project",
      ),
    ).resolves.toBe(
      "标题 已接入 语音秘书接口，相关实现主要在 服务端相关模块。",
    );
  });

  it("retries without incompatible disable-thinking fields when the provider rejects them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "'reasoning_effort' must be one of: 'low', 'medium', 'high'",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"openingText":"兼容重试后成功。"}',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const llm = new VoiceSecretaryTalkerLlm({
      apiKey: "sk-test",
      baseUrl: "https://example.com/v1",
      disableThinking: true,
      model: "deepseek-v4-flash",
      timeoutMs: 5000,
    });

    await expect(
      llm.createOpeningText(
        {
          projectPath: "/tmp/project",
          utterance: "项目现在怎么样？",
        },
        "project",
      ),
    ).resolves.toBe("兼容重试后成功。");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
