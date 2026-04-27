import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceSecretaryRoutes } from "../../src/routes/voice-secretary.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";

describe("Voice Secretary routes", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = join(tmpdir(), `voice-secretary-route-${randomUUID()}`);
    await mkdir(projectPath, { recursive: true });
    await writeFile(join(projectPath, "AGENTS.md"), "# Rules\nRead only.\n");
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it("runs a simulated call fixture", async () => {
    const routes = createVoiceSecretaryRoutes();
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
    expect(json.result.callSession.status).toBe("completed");
    expect(json.result.callSession.transcript).toHaveLength(2);
    expect(json.result.plannerResult.executionTask.mode).toBe("read_only");
    expect(json.result.executorReport.changedFiles).toEqual([]);
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
      status: "completed",
    });
    expect(json.result.callSession.transcript).toHaveLength(2);
    expect(json.result.callSession.transcript[0]).toMatchObject({
      speaker: "user",
      source: "asr",
    });
    expect(json.result.executorReport.status).toBe("started");
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

  it("rejects AgentLine executor mode when no supervisor is available", async () => {
    const routes = createVoiceSecretaryRoutes();
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
    const routes = createVoiceSecretaryRoutes();
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
    const routes = createVoiceSecretaryRoutes();
    const response = await routes.request("/simulate", {
      method: "POST",
      body: JSON.stringify({ projectPath }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
  });
});
