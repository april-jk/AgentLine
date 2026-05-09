import type { UrlProjectId } from "@agentline/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import { createSessionsRoutes } from "../../src/routes/sessions.js";
import type { CodexSessionReader } from "../../src/sessions/codex-reader.js";
import type { ISessionReader } from "../../src/sessions/types.js";
import type { Supervisor } from "../../src/supervisor/Supervisor.js";
import type { Project } from "../../src/supervisor/types.js";

describe("Sessions routes Codex resume", () => {
  it("passes the persisted Codex rollout path into supervisor resume", async () => {
    const project = {
      id: "proj-1" as UrlProjectId,
      path: "/tmp/project",
      name: "project",
      sessionCount: 1,
      sessionDir: "/tmp/project/.sessions",
      activeOwnedCount: 0,
      activeExternalCount: 1,
      lastActivity: null,
      provider: "claude",
    } satisfies Project;

    const codexResumePath = "/tmp/codex/rollout-codex-session-1.jsonl";

    const resumeSession = vi.fn(async () => ({
      id: "proc-1",
      permissionMode: "default",
      modeVersion: 0,
    }));

    const routes = createSessionsRoutes({
      supervisor: {
        resumeSession,
        getProcessForSession: vi.fn(() => null),
      } as unknown as Supervisor,
      scanner: {
        getOrCreateProject: vi.fn(async () => project),
      } as unknown as ProjectScanner,
      readerFactory: vi.fn(
        () =>
          ({
            getSessionSummary: vi.fn(async () => null),
          }) as unknown as ISessionReader,
      ),
      codexReaderFactory: vi.fn(
        () =>
          ({
            getResumePath: vi.fn(async () => codexResumePath),
            getResumeHistory: vi.fn(async () => null),
          }) as unknown as CodexSessionReader,
      ),
      sessionMetadataService: {
        getProvider: vi.fn(() => undefined),
        getExecutor: vi.fn(() => undefined),
      } as never,
      serverSettingsService: {
        getSetting: vi.fn(() => undefined),
      } as never,
    });

    const response = await routes.request(
      "/projects/proj-1/sessions/codex-session-1/resume",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "continue",
          provider: "codex",
          model: "gpt-5.4",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(resumeSession).toHaveBeenCalledWith(
      "codex-session-1",
      "/tmp/project",
      expect.objectContaining({ text: "continue" }),
      undefined,
      expect.objectContaining({
        providerName: "codex",
        model: "gpt-5.4",
        codexResumePath,
      }),
    );
  });
});
