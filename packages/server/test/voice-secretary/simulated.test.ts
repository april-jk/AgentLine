import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ProjectPlanner,
  SimulatedCallLoop,
  SimulatedTalker,
} from "../../src/voice-secretary/index.js";
import type {
  CallSession,
  PlannerRequest,
} from "../../src/voice-secretary/index.js";

describe("SimulatedCallLoop", () => {
  let projectPath: string;
  const nullCodexTalker = {
    createOpeningText: async () => null,
    createPlannerBrief: async () => null,
    createFinalBrief: async () => null,
  };

  beforeEach(async () => {
    projectPath = join(tmpdir(), `voice-secretary-${randomUUID()}`);
    await mkdir(join(projectPath, "docs", "features", "voice-secretary"), {
      recursive: true,
    });
    await mkdir(join(projectPath, "docs", "roadmap"), {
      recursive: true,
    });
    await writeFile(
      join(projectPath, "AGENTS.md"),
      [
        "# Agent Guide",
        "ProjectPlanner must remain read-only.",
        "ExecutorAgentSession owns all write-capable work.",
      ].join("\n"),
    );
    await writeFile(
      join(projectPath, "CLAUDE.md"),
      "# Project Notes\nRun pnpm lint after source edits.\n",
    );
    await writeFile(
      join(projectPath, "README.md"),
      [
        "# Example Project",
        "",
        "A mobile-first supervisor for AI coding agents.",
        "",
        "## Features",
        "- Mobile supervision",
        "- Multi-session dashboard",
        "- Voice input",
      ].join("\n"),
    );
    await writeFile(
      join(projectPath, "docs", "roadmap", "README.md"),
      [
        "# Roadmap",
        "",
        "### Voice Secretary",
        "### Git Worktrees",
        "### Basic Git Operations",
      ].join("\n"),
    );
    await writeFile(
      join(projectPath, "docs", "features", "voice-secretary", "README.md"),
      [
        "# Voice Secretary",
        "",
        "## First Milestone",
        "- Browser microphone input is transcribed by ASR.",
        "- Talker responds quickly through TTS.",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it("turns one simulated utterance into a planner task and fake executor report", async () => {
    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker),
      new ProjectPlanner(undefined, nullCodexTalker),
    );

    const result = await loop.run({
      projectPath,
      utterance: "Help me understand what this project should do next.",
    });

    expect(result.callSession.status).toBe("waiting_for_user");
    expect(result.callSession.transcript[0]).toMatchObject({
      speaker: "user",
      source: "typed",
    });
    expect(result.callSession.transcript[1]).toMatchObject({
      speaker: "talker",
      source: "tts",
    });
    expect(result.callSession.transcript).toHaveLength(3);
    expect(
      result.callSession.transcript.filter((turn) => turn.speaker === "talker"),
    ).toHaveLength(2);
    expect(result.plannerRequest.projectPath).toBe(projectPath);
    expect(result.plannerResult.recommendedAction).toBe("consult_worker");
    expect(result.plannerResult.executionTask).toMatchObject({
      provider: "codex",
      mode: "read_only",
      projectPath,
    });
    expect(result.executorReport.status).toBe("completed");
    expect(result.executorReport.changedFiles).toEqual([]);
    expect(result.finalBrief.questionsToAsk).toHaveLength(1);
    expect(result.voiceSession.projectIndexSummary).toContain("项目定位");
    expect(result.finalBrief.spokenSummary).toContain(
      "A mobile-first supervisor for AI coding agents",
    );
    expect(result.finalBrief.spokenSummary).toContain("Mobile supervision");
    expect(result.finalBrief.spokenSummary).not.toContain("顶层主要是");
  });

  it("keeps ProjectPlanner read-only while collecting project instructions", async () => {
    const before = await readFile(join(projectPath, "AGENTS.md"), "utf-8");
    const planner = new ProjectPlanner(undefined, nullCodexTalker);
    const talker = new SimulatedTalker(nullCodexTalker);
    const callSession: CallSession = {
      id: randomUUID(),
      channel: "simulated",
      status: "active",
      startedAt: new Date().toISOString(),
      projectPath,
      transcript: [],
      plannerRuns: [],
      callbackRequests: [],
    };
    const request: PlannerRequest = talker.createPlannerRequest(callSession, {
      projectPath,
      utterance: "What should happen next?",
    });

    const result = await planner.plan(request);

    expect(result.relevantInstructions.map((ref) => ref.path)).toEqual(
      expect.arrayContaining(["AGENTS.md", "CLAUDE.md", "README.md"]),
    );
    expect(result.executionTask?.prompt).toContain("ProjectPlanner");
    expect(await readFile(join(projectPath, "AGENTS.md"), "utf-8")).toBe(
      before,
    );
  });
});
