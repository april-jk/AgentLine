import { describe, expect, it, vi } from "vitest";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import { AgentLineExecutorAgentAdapter } from "../../src/voice-secretary/index.js";
import type { ExecutionTask } from "../../src/voice-secretary/index.js";

function createTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: "task-1",
    projectPath: "/tmp/project",
    provider: "codex",
    mode: "read_only",
    prompt: "Read the project and recommend the next step.",
    acceptanceCriteria: [],
    riskNotes: [],
    requiredVerification: [],
    ...overrides,
  };
}

describe("AgentLineExecutorAgentAdapter", () => {
  it("starts a read-only execution task as a Codex plan-mode session", async () => {
    const startSession = vi.fn(async () => ({
      id: "process-1",
      sessionId: "codex-session-1",
      projectId: "project-1",
      permissionMode: "plan",
      modeVersion: 1,
    }));
    const adapter = new AgentLineExecutorAgentAdapter({
      supervisor: { startSession } as unknown as Supervisor,
    });

    const ref = await adapter.createSession(createTask());
    const report = await adapter.getReport(ref.id);

    expect(ref).toMatchObject({
      id: "codex-session-1",
      processId: "process-1",
      provider: "codex",
      taskId: "task-1",
    });
    expect(report).toMatchObject({
      executionTaskId: "task-1",
      providerSessionId: "codex-session-1",
      status: "started",
      changedFiles: [],
    });
    expect(startSession).toHaveBeenCalledWith(
      "/tmp/project",
      { text: "Read the project and recommend the next step." },
      "plan",
      { providerName: "codex" },
    );
  });

  it("reports queued AgentLine sessions without pretending work completed", async () => {
    const startSession = vi.fn(async () => ({
      queued: true,
      queueId: "queue-1",
      position: 2,
    }));
    const adapter = new AgentLineExecutorAgentAdapter({
      supervisor: { startSession } as unknown as Supervisor,
    });

    const ref = await adapter.createSession(createTask());
    const report = await adapter.getReport(ref.id);

    expect(ref).toMatchObject({
      id: "queued-queue-1",
      queued: true,
      queueId: "queue-1",
      position: 2,
    });
    expect(report).toMatchObject({
      status: "queued",
      providerSessionId: "queued-queue-1",
      changedFiles: [],
    });
  });
});
