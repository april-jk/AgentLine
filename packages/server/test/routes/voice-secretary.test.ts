import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoiceSecretaryRoutes } from "../../src/routes/voice-secretary.js";

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
    expect(json.result.plannerResult.executionTask.mode).toBe("read_only");
    expect(json.result.executorReport.changedFiles).toEqual([]);
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
