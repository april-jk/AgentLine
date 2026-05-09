import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexSessionReader } from "../../src/sessions/codex-reader.js";

describe("CodexSessionReader resume history", () => {
  let testDir: string;
  let reader: CodexSessionReader;

  beforeEach(async () => {
    testDir = join(tmpdir(), `codex-resume-history-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    reader = new CodexSessionReader({ sessionsDir: testDir });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns persisted response items in order", async () => {
    const sessionId = "resume-history-1";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: new Date().toISOString(),
          payload: {
            id: sessionId,
            cwd: "/tmp/project",
            timestamp: new Date().toISOString(),
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "developer prompt" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: '{"cmd":"pwd"}',
            call_id: "call-1",
          },
        }),
      ].join("\n"),
    );

    const history = await reader.getResumeHistory(sessionId);

    expect(history).toEqual([
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "developer prompt" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
      {
        type: "function_call",
        name: "exec_command",
        arguments: '{"cmd":"pwd"}',
        call_id: "call-1",
      },
    ]);
  });

  it("returns the rollout file path for path-based resume", async () => {
    const sessionId = "resume-path-1";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: new Date().toISOString(),
          payload: {
            id: sessionId,
            cwd: "/tmp/project",
            timestamp: new Date().toISOString(),
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }],
          },
        }),
      ].join("\n"),
    );

    await expect(reader.getResumePath(sessionId)).resolves.toBe(filePath);
  });

  it("synthesizes user history from event messages when response items are missing", async () => {
    const sessionId = "resume-history-2";
    const filePath = join(testDir, `${sessionId}.jsonl`);
    await writeFile(
      filePath,
      [
        JSON.stringify({
          type: "session_meta",
          timestamp: new Date().toISOString(),
          payload: {
            id: sessionId,
            cwd: "/tmp/project",
            timestamp: new Date().toISOString(),
            model_provider: "openai",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          timestamp: new Date().toISOString(),
          payload: {
            type: "user_message",
            message: "fallback user text",
          },
        }),
        JSON.stringify({
          type: "response_item",
          timestamp: new Date().toISOString(),
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "assistant reply" }],
          },
        }),
      ].join("\n"),
    );

    const history = await reader.getResumeHistory(sessionId);

    expect(history).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "fallback user text" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "assistant reply" }],
      },
    ]);
  });
});
