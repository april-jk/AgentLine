import { execFileSync } from "node:child_process";
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
import { VoiceSecretaryKnowledgeStore } from "../../src/voice-secretary/knowledge-store.js";

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
    execFileSync("git", ["init"], { cwd: projectPath });
    execFileSync("git", ["config", "user.email", "voice@test.local"], {
      cwd: projectPath,
    });
    execFileSync("git", ["config", "user.name", "Voice Test"], {
      cwd: projectPath,
    });
    execFileSync("git", ["add", "."], { cwd: projectPath });
    execFileSync("git", ["commit", "-m", "Seed test project"], {
      cwd: projectPath,
    });
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
    expect(result.finalBrief.spokenSummary).not.toContain("顶层主要是");
    expect(result.finalBrief.spokenSummary.length).toBeLessThanOrEqual(145);
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

  it("prefers the configured llm summary over the deterministic fallback text for non-index questions", async () => {
    const llmTalker = {
      createOpeningText: async () => "我已经接上项目上下文了。",
      createPlannerBrief: async () => ({
        spokenSummary: "我先直接回答你当前最关心的项目问题。",
        suggestedNextUtterance: "你想继续问最近一次提交，还是问当前进展？",
        factsToAvoidOverstating: [],
        questionsToAsk: ["你想继续问最近一次提交，还是问当前进展？"],
      }),
      createFinalBrief: async () => ({
        spokenSummary:
          "最近一次提交主要是在修 Voice Secretary 的文本与调试链路。",
        suggestedNextUtterance: "要我继续展开这次提交改了哪些文件吗？",
        factsToAvoidOverstating: [],
        questionsToAsk: ["要我继续展开这次提交改了哪些文件吗？"],
      }),
    };

    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker, llmTalker, "llm-first"),
      new ProjectPlanner(undefined, nullCodexTalker, llmTalker, "llm-first"),
    );

    const result = await loop.run({
      projectPath,
      utterance: "更详细说一下 Voice Secretary 的文本与调试链路。",
    });

    expect(result.finalBrief.spokenSummary).toBe(
      "最近一次提交主要是在修 Voice Secretary 的文本与调试链路。",
    );
    expect(result.plannerResult.recommendedAction).toBe("consult_worker");
    expect(result.finalBrief.suggestedNextUtterance).toBe(
      "要我继续展开这次提交改了哪些文件吗？",
    );
  });

  it("answers latest-commit questions directly from the project index", async () => {
    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker),
      new ProjectPlanner(undefined, nullCodexTalker),
    );

    const result = await loop.run({
      projectPath,
      utterance: "最近一次代码提交是什么？",
    });

    expect(result.plannerResult.recommendedAction).toBe("answer_directly");
    expect(result.plannerResult.executionTask).toBeUndefined();
    expect(result.executorReport.providerSessionId).toBe("speaker-direct");
    expect(result.finalBrief.spokenSummary).toContain("最近一次提交是");
    expect(result.finalBrief.spokenSummary).toContain("主要动的是");
    expect(result.finalBrief.spokenSummary).not.toContain("docs/");
    expect(result.finalBrief.spokenSummary).not.toContain("packages/");
    expect(result.finalBrief.spokenSummary).not.toContain("前端页面相关模块");
  });

  it("starts a background project initializer when the first direct-answer turn has no worker yet", async () => {
    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker),
      new ProjectPlanner(undefined, nullCodexTalker),
    );

    const result = await loop.run({
      projectPath,
      utterance: "给我介绍一下这个项目的背景信息。",
    });

    expect(result.plannerResult.recommendedAction).toBe("answer_directly");
    expect(result.voiceSession.workerSessionId).toMatch(/^fake-executor-/);
    expect(result.voiceSession.workerStatus).toBe("running");
    expect(result.callSession.callbackRequests.at(-1)?.script).toContain(
      "项目初始化背景",
    );
  });

  it("answers speech-stack questions in a short spoken style", async () => {
    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker),
      new ProjectPlanner(undefined, nullCodexTalker),
    );

    const result = await loop.run({
      projectPath,
      utterance: "嗯，你看一下现在这个语音识别模块用的是什么实现的？",
    });

    expect(result.plannerResult.recommendedAction).toBe("answer_directly");
    expect(result.plannerResult.executionTask).toBeUndefined();
    expect(result.finalBrief.spokenSummary).toContain("Web Speech API");
    expect(result.finalBrief.spokenSummary).toContain("火山语音识别");
    expect(result.finalBrief.spokenSummary).not.toContain("packages/");
    expect(result.finalBrief.spokenSummary).not.toContain(
      "/api/voice-secretary",
    );
  });

  it("keeps speech-stack answers complete even when project memory already has a long worker note", async () => {
    const knowledgeStore = new VoiceSecretaryKnowledgeStore(
      join(projectPath, ".voice-memory"),
    );
    await knowledgeStore.recordWorkerUpdate(
      projectPath,
      [
        "现在这块是双层实现，不是单一路径。",
        "前端这一层主要负责实时字幕预览，会启用浏览器的 Web Speech API。",
        "服务端这一层才是正式转写，录音结束后会走火山语音识别。",
        "服务端同时兼容 HTTP 和 WebSocket 两种识别模式。",
      ].join(" "),
    );

    const loop = new SimulatedCallLoop(
      new SimulatedTalker(nullCodexTalker),
      new ProjectPlanner(undefined, nullCodexTalker),
      undefined,
      { knowledgeStore },
    );

    const result = await loop.run({
      projectPath,
      utterance: "那语音识别这一块现在具体是怎么实现的？",
    });

    expect(result.finalBrief.spokenSummary).toContain("Web Speech API");
    expect(result.finalBrief.spokenSummary).toContain("火山语音识别");
    expect(result.finalBrief.spokenSummary).not.toContain("packages/");
    expect(result.finalBrief.spokenSummary).not.toContain("/calls/audio");
  });
});
