import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { decideCallback } from "../src/callback.ts";
import { runStubExecutor } from "../src/executor.ts";
import { runLocalLoop, writeLocalLoopRun } from "../src/local-loop.ts";
import { createTaskPacket } from "../src/task-packet.ts";

test("creates a stable structured task packet from a transcript", () => {
  const transcript =
    "Create a new project for a phone-native AI secretary and keep the voice loop low latency.";
  const first = createTaskPacket({ transcript });
  const second = createTaskPacket({ transcript });

  assert.equal(first.id, second.id);
  assert.equal(first.intent, "create_project");
  assert.equal(first.openQuestions.length, 0);
  assert.match(first.summary, /phone-native AI secretary/);
  assert.ok(first.constraints.includes("Keep the live voice loop low-latency."));
});

test("blocks execution and calls back when the transcript is missing", () => {
  const task = createTaskPacket({ transcript: "" });
  const execution = runStubExecutor(task);
  const callback = decideCallback(task, execution);

  assert.equal(execution.status, "blocked");
  assert.equal(callback.type, "call_back");
});

test("runs the local MVP loop and asks background execution to continue", () => {
  const run = runLocalLoop({
    transcript:
      "Implement the MVP loop for AgentLine and keep Codex and Claude Code behind adapters.",
    createdAt: "2026-04-26T13:00:00.000Z",
  });

  assert.equal(run.schemaVersion, "agentline.local-loop.v1");
  assert.equal(run.execution.status, "accepted");
  assert.equal(run.callback.type, "continue_background");
  assert.equal(run.runId, "run_20260426130000_124c0a24");
});

test("writes the full run as inspectable JSON", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "agentline-test-"));

  try {
    const run = runLocalLoop({
      transcript: "Research phone-native AI secretary projects on GitHub.",
      createdAt: "2026-04-26T13:05:00.000Z",
    });
    const outputPath = writeLocalLoopRun(run, outputDir);
    const stored = JSON.parse(readFileSync(outputPath, "utf8"));

    assert.equal(stored.runId, run.runId);
    assert.equal(stored.task.intent, "research");
    assert.equal(stored.callback.type, "continue_background");
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test("can mark a no-action transcript complete", () => {
  const run = runLocalLoop({
    transcript: "Thanks, all good.",
    createdAt: "2026-04-26T13:10:00.000Z",
  });

  assert.equal(run.task.intent, "no_action");
  assert.equal(run.execution.status, "completed");
  assert.equal(run.callback.type, "complete");
});
