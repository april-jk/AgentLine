import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexEphemeralTalker } from "../../src/voice-secretary/codex-ephemeral.js";

describe("CodexEphemeralTalker", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  it("creates an isolated CODEX_HOME, copies auth materials, and parses JSON output", async () => {
    const baseCodexHome = await mkdtemp(join(tmpdir(), "codex-home-fixture-"));
    tempDirs.push(baseCodexHome);
    await mkdir(baseCodexHome, { recursive: true });
    await writeFile(join(baseCodexHome, "auth.json"), '{"token":"abc"}');
    await writeFile(
      join(baseCodexHome, "config.toml"),
      'model = "gpt-5.3-codex"\n',
    );

    let capturedHome = "";
    let capturedSessions = "";

    const talker = new CodexEphemeralTalker({
      enabled: true,
      reuseIsolatedProfile: false,
      baseCodexHomeDir: baseCodexHome,
      provider: {
        startSession: async (options) => {
          capturedHome = options.processEnv?.CODEX_HOME ?? "";
          capturedSessions = options.processEnv?.CODEX_SESSIONS_DIR ?? "";

          const copiedAuth = await readFile(
            join(capturedHome, "auth.json"),
            "utf-8",
          );
          const copiedConfig = await readFile(
            join(capturedHome, "config.toml"),
            "utf-8",
          );

          expect(copiedAuth).toContain('"token":"abc"');
          expect(copiedConfig).toContain("gpt-5.3-codex");
          expect(options.cwd).toContain("agentline-voice-codex-");
          expect(options.codexThreadEphemeral).toBe(true);
          expect(options.codexExperimentalRawEvents).toBe(false);

          async function* iterator() {
            yield {
              type: "assistant",
              uuid: "assistant-1",
              message: {
                role: "assistant",
                content:
                  '{"openingText":"收到，我先整理一下，再给你一个简短答复。"}',
              },
            };
            yield {
              type: "result",
            };
          }

          return {
            iterator: iterator(),
            queue: {} as never,
            abort: () => undefined,
          };
        },
      },
    });

    const text = await talker.createOpeningText(
      {
        projectPath: "/tmp/project",
        utterance: "请帮我看看接下来做什么",
      },
      "project",
    );

    expect(text).toBe("收到，我先整理一下，再给你一个简短答复。");
    expect(capturedHome).toContain("agentline-voice-codex-");
    expect(capturedSessions).toBe(join(capturedHome, "sessions"));

    await expect(stat(capturedHome)).rejects.toThrow();
  });

  it("captures start, first assistant text, and completion timing metrics", async () => {
    const nowValues = [1000, 1015, 1040, 1085];
    let nowIndex = 0;

    const talker = new CodexEphemeralTalker({
      enabled: true,
      reuseIsolatedProfile: false,
      now: () => nowValues[nowIndex++] ?? nowValues[nowValues.length - 1] ?? 0,
      provider: {
        startSession: async () => {
          async function* iterator() {
            yield {
              type: "assistant",
              uuid: "assistant-1",
              message: {
                role: "assistant",
                content: '{"openingText":"先把主流程跑通。"}',
              },
            };
            yield {
              type: "result",
            };
          }

          return {
            iterator: iterator(),
            queue: {} as never,
            abort: () => undefined,
          };
        },
      },
    });

    const result = await talker.createOpeningTextWithMetrics(
      {
        projectPath: "/tmp/project",
        utterance: "下一步做什么",
      },
      "project",
    );

    expect(result.text).toBe("先把主流程跑通。");
    expect(result.metrics).toEqual({
      model: undefined,
      effort: "low",
      startSessionMs: 15,
      firstAssistantTextMs: 40,
      completedMs: 85,
    });
  });
});
