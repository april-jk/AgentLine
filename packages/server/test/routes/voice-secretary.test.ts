import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceSecretaryRoutes } from "../../src/routes/voice-secretary.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { VoiceProviderCatalog } from "../../src/voice-secretary/types.js";

describe("Voice Secretary routes", () => {
  let projectPath: string;
  let providerCatalog: VoiceProviderCatalog;

  beforeEach(async () => {
    projectPath = join(tmpdir(), `voice-secretary-route-${randomUUID()}`);
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, "AGENTS.md"), "# Rules\nRead only.\n");
    providerCatalog = {
      listAvailableProviders: vi.fn(async () => [
        {
          name: "codex",
          displayName: "Codex",
          installed: true,
          authenticated: true,
          enabled: true,
        },
      ]),
    };
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("runs a simulated call fixture", async () => {
    const routes = createVoiceSecretaryRoutes({ providerCatalog });
    const response = await routes.request("/simulate", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        utterance: "Help me understand this project.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result.callSession.status).toBe("waiting_for_user");
    expect(json.result.callSession.transcript).toHaveLength(3);
    expect(json.result.plannerResult.executionTask.mode).toBe("read_only");
    expect(json.result.executorReport.changedFiles).toEqual([]);
    expect(json.result.voiceSession.workerSessionId).toBeTruthy();
  });

  it("can hand off the simulated task packet to a formal AgentLine executor session", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const setProvider = vi.fn(async () => undefined);
    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession } as unknown as Supervisor,
      sessionMetadataService: { setProvider } as never,
      providerCatalog,
    });

    const response = await routes.request("/simulate", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        utterance: "Prepare the next implementation step.",
        executorMode: "agentline",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result.executorReport).toMatchObject({
      providerSessionId: "codex-session-1",
      status: "started",
      changedFiles: [],
    });
    expect(startSession).toHaveBeenCalledWith(
      projectPath,
      expect.objectContaining({
        text: expect.stringContaining("Prepare the next implementation step."),
      }),
      "plan",
      { providerName: "codex" },
    );
    expect(setProvider).toHaveBeenCalledWith("codex-session-1", "codex");
  });

  it("starts a real voice secretary call by creating an AgentLine executor session", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession } as unknown as Supervisor,
      providerCatalog,
    });

    const response = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        utterance: "Read the project and prepare the next handoff.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result.callSession).toMatchObject({
      channel: "web-voice",
      status: "waiting_for_user",
    });
    expect(json.result.callSession.transcript).toHaveLength(3);
    expect(json.result.callSession.transcript[0]).toMatchObject({
      speaker: "user",
      source: "asr",
    });
    expect(json.result.executorReport.status).toBe("started");
    expect(json.result.voiceSession.workerSessionId).toBe("codex-session-1");
    expect(startSession).toHaveBeenCalledWith(
      projectPath,
      expect.objectContaining({
        text: expect.stringContaining(
          "Read the project and prepare the next handoff.",
        ),
      }),
      "plan",
      { providerName: "codex" },
    );
  });

  it("reuses the same worker session for follow-up turns in one voice session", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const resumeSession = vi.fn(async () => ({
      id: "process-2",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession, resumeSession } as unknown as Supervisor,
      providerCatalog,
    });

    const first = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        voiceSessionId: "voice-1",
        projectPath,
        utterance: "What is this project about?",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(first.status).toBe(200);

    const second = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        voiceSessionId: "voice-1",
        projectPath,
        utterance: "Please inspect the implementation details next.",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(second.status).toBe(200);

    expect(startSession).toHaveBeenCalledTimes(1);
    expect(resumeSession).toHaveBeenCalledTimes(1);
    expect(resumeSession).toHaveBeenCalledWith(
      "codex-session-1",
      projectPath,
      expect.objectContaining({
        text: expect.stringContaining("implementation details"),
      }),
      "plan",
      { providerName: "codex" },
    );
  });

  it("publishes a speaker hook after the worker completes", async () => {
    let listener:
      | ((event: {
          type: "message" | "complete";
          message?: {
            type: string;
            message?: { content: string; role: string };
          };
        }) => void)
      | undefined;
    const process = {
      subscribe: vi.fn((next) => {
        listener = next;
        return () => undefined;
      }),
    };
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const routes = createVoiceSecretaryRoutes({
      supervisor: {
        startSession,
        getProcess: vi.fn(() => process),
      } as unknown as Supervisor,
      providerCatalog,
    });

    const response = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        voiceSessionId: "voice-hook",
        projectPath,
        utterance: "Give me the project overview.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    listener?.({
      type: "message",
      message: {
        type: "assistant",
        message: { content: "Worker found more details.", role: "assistant" },
      },
    });
    listener?.({ type: "complete" });

    const statusResponse = await routes.request("/calls/voice-hook");
    expect(statusResponse.status).toBe(200);
    const json = await statusResponse.json();
    expect(json.snapshot.latestWorkerMessage).toBe(
      "Worker found more details.",
    );
    expect(json.hook.text).toContain("项目专家");
  });

  it("runs an audio call through Volcengine ASR and TTS", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/recognize/flash")) {
          return new Response(
            JSON.stringify({
              result: {
                text: "Help me understand what this project should do next.",
              },
            }),
            {
              status: 200,
              headers: {
                "X-Api-Status-Code": "20000000",
              },
            },
          );
        }
        if (url.includes("/api/v1/tts")) {
          return new Response(
            JSON.stringify({
              code: 3000,
              data: "SUQz",
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch url: ${url}`);
      });

    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession } as unknown as Supervisor,
      providerCatalog,
      serverSettingsService: {
        getSettings: () => ({
          phoneVolcengineAsrAppId: "asr-app",
          phoneVolcengineAsrAccessToken: "asr-token",
          phoneVolcengineTtsAppId: "tts-app",
          phoneVolcengineTtsAccessToken: "tts-token",
          phoneVolcengineTtsVoiceType: "voice-a",
        }),
      } as never,
    });

    const formData = new FormData();
    formData.set("projectPath", projectPath);
    formData.set(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "turn.wav", { type: "audio/wav" }),
    );

    const response = await routes.request("/calls/audio", {
      method: "POST",
      body: formData,
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.transcript).toBe(
      "Help me understand what this project should do next.",
    );
    expect(json.audioBase64).toBe("SUQz");
    expect(json.result.callSession.channel).toBe("web-voice");
    expect(json.result.callSession.status).toBe("waiting_for_user");
    expect(startSession).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Volcengine TTS v3 async submit/query flow", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/recognize/flash")) {
          return new Response(
            JSON.stringify({
              result: {
                text: "What should this project do next?",
              },
            }),
            {
              status: 200,
              headers: {
                "X-Api-Status-Code": "20000000",
              },
            },
          );
        }
        if (url.includes("/api/v3/tts/submit")) {
          expect(init?.headers).toMatchObject({
            "X-Api-App-Id": "tts-app",
            "X-Api-Access-Key": "tts-token",
            "X-Api-Resource-Id": "seed-tts-2.0",
          });
          return new Response(
            JSON.stringify({
              code: 20000000,
              data: {
                task_id: "task-1",
                task_status: 1,
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/api/v3/tts/query")) {
          return new Response(
            JSON.stringify({
              code: 20000000,
              data: {
                task_id: "task-1",
                task_status: 2,
                audio_url: "https://audio.example.com/task-1.wav",
              },
            }),
            { status: 200 },
          );
        }
        if (url.includes("https://audio.example.com/task-1.wav")) {
          return new Response(Buffer.from("RIFF", "utf8"), {
            status: 200,
            headers: {
              "content-type": "audio/wav",
            },
          });
        }
        throw new Error(`Unexpected fetch url: ${url}`);
      });

    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession } as unknown as Supervisor,
      providerCatalog,
      serverSettingsService: {
        getSettings: () => ({
          phoneVolcengineAsrAppId: "asr-app",
          phoneVolcengineAsrAccessToken: "asr-token",
          phoneVolcengineTtsAppId: "tts-app",
          phoneVolcengineTtsAccessToken: "tts-token",
          phoneVolcengineTtsSecretKey: "tts-secret",
          phoneVolcengineTtsVoiceType: "voice-a",
          phoneVolcengineTtsEndpoint:
            "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
        }),
      } as never,
    });

    const formData = new FormData();
    formData.set("projectPath", projectPath);
    formData.set(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "turn.wav", { type: "audio/wav" }),
    );

    const response = await routes.request("/calls/audio", {
      method: "POST",
      body: formData,
      headers: { "X-AgentLine-Request": "true" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.audioBase64).toBe(
      Buffer.from("RIFF", "utf8").toString("base64"),
    );
    expect(startSession).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries Volcengine ASR with X-Api-Key auth when legacy auth fails", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));

    let asrAttempt = 0;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("/recognize/flash")) {
          asrAttempt += 1;
          if (asrAttempt === 1) {
            expect(init?.headers).toMatchObject({
              "X-Api-App-Key": "asr-app",
              "X-Api-Access-Key": "asr-token",
            });
            return new Response(null, {
              status: 403,
              headers: {
                "X-Api-Status-Code": "45000030",
                "X-Api-Message": "Access denied",
              },
            });
          }

          expect(init?.headers).toMatchObject({
            "X-Api-Key": "asr-secret",
          });
          return new Response(
            JSON.stringify({
              result: {
                text: "Help me understand what this project should do next.",
              },
            }),
            {
              status: 200,
              headers: {
                "X-Api-Status-Code": "20000000",
              },
            },
          );
        }
        if (url.includes("/api/v1/tts")) {
          return new Response(
            JSON.stringify({
              code: 3000,
              data: "SUQz",
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch url: ${url}`);
      });

    const routes = createVoiceSecretaryRoutes({
      supervisor: { startSession } as unknown as Supervisor,
      providerCatalog,
      serverSettingsService: {
        getSettings: () => ({
          phoneVolcengineAsrAppId: "asr-app",
          phoneVolcengineAsrAccessToken: "asr-token",
          phoneVolcengineAsrSecretKey: "asr-secret",
          phoneVolcengineTtsAppId: "tts-app",
          phoneVolcengineTtsAccessToken: "tts-token",
          phoneVolcengineTtsVoiceType: "voice-a",
        }),
      } as never,
    });

    const formData = new FormData();
    formData.set("projectPath", projectPath);
    formData.set(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "turn.wav", { type: "audio/wav" }),
    );

    const response = await routes.request("/calls/audio", {
      method: "POST",
      body: formData,
      headers: { "X-AgentLine-Request": "true" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.transcript).toBe(
      "Help me understand what this project should do next.",
    );
    expect(startSession).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses a selected conversation as the Worker context", async () => {
    const resumeSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "existing-codex-session",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const setProvider = vi.fn(async () => undefined);
    const routes = createVoiceSecretaryRoutes({
      supervisor: { resumeSession } as unknown as Supervisor,
      sessionMetadataService: { setProvider } as never,
      providerCatalog,
    });

    const response = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        conversationSessionId: "existing-codex-session",
        conversationProvider: "claude",
        utterance: "Use this conversation to fix the next bug.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.result.callSession.conversationSessionId).toBe(
      "existing-codex-session",
    );
    expect(json.result.executorReport).toMatchObject({
      providerSessionId: "existing-codex-session",
      status: "started",
    });
    expect(resumeSession).toHaveBeenCalledWith(
      "existing-codex-session",
      projectPath,
      expect.objectContaining({
        text: expect.stringContaining("already-bound Worker for this speaker"),
      }),
      "default",
      { providerName: "claude" },
    );
    expect(setProvider).toHaveBeenCalledWith(
      "existing-codex-session",
      "claude",
    );
  });

  it("rejects AgentLine executor mode when no supervisor is available", async () => {
    const routes = createVoiceSecretaryRoutes({ providerCatalog });
    const response = await routes.request("/simulate", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        utterance: "Prepare the next implementation step.",
        executorMode: "agentline",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(503);
  });

  it("rejects real calls when no supervisor is available", async () => {
    const routes = createVoiceSecretaryRoutes({ providerCatalog });
    const response = await routes.request("/calls", {
      method: "POST",
      body: JSON.stringify({
        projectPath,
        utterance: "Prepare the next implementation step.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(503);
  });

  it("rejects missing required input", async () => {
    const routes = createVoiceSecretaryRoutes({ providerCatalog });
    const response = await routes.request("/simulate", {
      method: "POST",
      body: JSON.stringify({ projectPath }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
  });
});
