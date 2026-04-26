import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { decideCallback } from "./callback.ts";
import { runStubExecutor } from "./executor.ts";
import { createTaskPacket, normalizeTranscript } from "./task-packet.ts";
import type { Caller, LocalLoopRun } from "./types.ts";

export type LocalLoopInput = {
  transcript: string;
  caller?: Partial<Caller>;
  createdAt?: string;
};

export function runLocalLoop(input: LocalLoopInput): LocalLoopRun {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const normalized = normalizeTranscript(input.transcript);
  const task = createTaskPacket({
    transcript: input.transcript,
    source: "transcript",
    caller: input.caller,
  });
  const execution = runStubExecutor(task);
  const callback = decideCallback(task, execution);

  return {
    schemaVersion: "agentline.local-loop.v1",
    runId: createRunId(task.id, createdAt),
    createdAt,
    transcript: {
      raw: input.transcript,
      normalized,
    },
    task,
    execution,
    callback,
  };
}

export function writeLocalLoopRun(run: LocalLoopRun, outputDir: string): string {
  const absoluteOutputDir = resolve(outputDir);
  mkdirSync(absoluteOutputDir, { recursive: true });

  const outputPath = resolve(absoluteOutputDir, `${run.runId}.json`);
  writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return outputPath;
}

function createRunId(taskId: string, createdAt: string): string {
  const digest = createHash("sha256")
    .update(`${taskId}:${createdAt}`)
    .digest("hex")
    .slice(0, 8);
  const timestamp = createdAt.replace(/[^0-9]/g, "").slice(0, 14);

  return `run_${timestamp}_${digest}`;
}

