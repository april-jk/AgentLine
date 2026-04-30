import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VoiceSecretaryKnowledgeStore } from "../../src/voice-secretary/knowledge-store.js";

describe("VoiceSecretaryKnowledgeStore", () => {
  let dataDir: string;
  let projectPath: string;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `voice-secretary-data-${randomUUID()}`);
    projectPath = join(tmpdir(), `voice-secretary-project-${randomUUID()}`);
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      join(projectPath, "README.md"),
      [
        "# Demo",
        "",
        "A mobile-first supervisor for AI coding agents.",
        "",
        "## Features",
        "- Mobile supervision",
        "- Multi-session dashboard",
      ].join("\n"),
    );
    await writeFile(
      join(projectPath, "AGENTS.md"),
      "# Rules\nKeep it small.\n",
    );
    execFileSync("git", ["init"], { cwd: projectPath });
    execFileSync("git", ["config", "user.email", "voice@test.local"], {
      cwd: projectPath,
    });
    execFileSync("git", ["config", "user.name", "Voice Test"], {
      cwd: projectPath,
    });
    execFileSync("git", ["add", "."], { cwd: projectPath });
    execFileSync("git", ["commit", "-m", "Seed project"], {
      cwd: projectPath,
    });
  });

  afterEach(async () => {
    await Promise.all([
      rm(dataDir, { recursive: true, force: true }),
      rm(projectPath, { recursive: true, force: true }),
    ]);
  });

  it("creates persistent index and memory files for a project", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);
    const artifacts = await store.ensureProjectArtifacts(projectPath);

    const assistantMemoryContent = JSON.parse(
      await readFile(artifacts.assistantMemoryPath, "utf-8"),
    );
    const indexContent = JSON.parse(
      await readFile(artifacts.indexPath, "utf-8"),
    );
    const memoryContent = JSON.parse(
      await readFile(artifacts.memoryPath, "utf-8"),
    );

    expect(assistantMemoryContent.userProfile.language).toBe("zh-CN");
    expect(assistantMemoryContent.spokenStyleHints[0]).toContain("先给结论");
    expect(indexContent.projectPositioning).toContain("mobile-first");
    expect(indexContent.currentCapabilities).toContain("Mobile supervision");
    expect(indexContent.summary).toContain("项目定位");
    expect(memoryContent.summaryNotes[0]).toContain("Talker记忆已初始化");
    expect(memoryContent.stableFacts[0]).toContain("mobile-first");
    expect(memoryContent.spokenHints[0]).toContain("秘书");
  });

  it("persists recent dialogue into the project memory file", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);
    const memory = await store.recordTalkerTurn(
      projectPath,
      [
        {
          speaker: "user",
          text: "现在这个项目做了什么？",
          at: "2026-04-29T00:00:00.000Z",
        },
        {
          speaker: "talker",
          text: "它现在重点是移动端监督和 Voice Secretary。",
          at: "2026-04-29T00:00:01.000Z",
        },
      ],
      "用户问了当前项目功能，Talker回答了移动端监督和 Voice Secretary。",
    );

    expect(memory.recentTurns).toHaveLength(2);
    expect(memory.summaryNotes.at(-1)).toContain("Voice Secretary");
    expect(memory.openQuestions[0]).toContain("现在这个项目做了什么");
    expect(memory.recentChangesDigest[0]).toContain(
      "移动端监督和 Voice Secretary",
    );

    const assistantMemory = await store.ensureAssistantMemory();
    expect(assistantMemory.recentConversationDigest.at(-1)).toContain(
      "Voice Secretary",
    );
  });

  it("records worker findings into the project memory file", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);
    const memory = await store.recordWorkerUpdate(
      projectPath,
      "最近一次提交主要在修 Voice Secretary 的调试证据和专家回灌。",
      {
        source: "initializer",
        topic: "项目初始化",
        promoteToStableFacts: true,
      },
    );

    expect(memory.latestWorkerMessage).toContain("调试证据");
    expect(memory.workerFindings.at(-1)?.topic).toBe("项目初始化");
    expect(memory.stableFacts[0]).toContain("调试证据");
    expect(memory.recentChangesDigest[0]).toContain("Voice Secretary");

    const artifacts = await store.ensureProjectArtifacts(projectPath);
    const transcriptLines = (await readFile(artifacts.transcriptPath, "utf-8"))
      .trim()
      .split("\n");
    expect(transcriptLines).toHaveLength(1);
    expect(JSON.parse(transcriptLines[0] ?? "{}")).toMatchObject({
      source: "initializer",
      kind: "worker_message",
      topic: "项目初始化",
    });
  });

  it("derives digest fields when raw transcript events are appended", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);

    await store.appendProjectTranscriptEvent(projectPath, {
      at: "2026-04-30T00:00:00.000Z",
      source: "user",
      kind: "turn",
      text: "最近一次提交是什么？",
    });
    await store.appendProjectTranscriptEvent(projectPath, {
      at: "2026-04-30T00:00:01.000Z",
      source: "worker",
      kind: "worker_message",
      text: "最近一次提交主要在修 Voice Secretary 的调试证据。",
      topic: "最近提交",
    });

    const artifacts = await store.ensureProjectArtifacts(projectPath);
    const memory = JSON.parse(await readFile(artifacts.memoryPath, "utf-8"));

    expect(memory.openQuestions[0]).toContain("最近一次提交是什么");
    expect(memory.recentChangesDigest[0]).toContain("最近一次提交主要在修");
  });

  it("rebuilds stale project indexes that are missing structured fields", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);
    const artifacts = await store.ensureProjectArtifacts(projectPath);

    await writeFile(
      artifacts.indexPath,
      JSON.stringify(
        {
          projectName: "Demo",
          projectPath,
          generatedAt: "2026-04-29T00:00:00.000Z",
          topLevelEntries: [],
          notableFiles: [],
          summary: "old",
        },
        null,
        2,
      ),
    );

    const rebuilt = await store.ensureProjectArtifacts(projectPath);
    expect(rebuilt.index.projectPositioning).toContain("mobile-first");
    expect(rebuilt.index.currentCapabilities).toContain("Mobile supervision");
  });

  it("refreshes latest commit details for a previously cached valid index", async () => {
    const store = new VoiceSecretaryKnowledgeStore(dataDir);
    const artifacts = await store.ensureProjectArtifacts(projectPath);

    await writeFile(
      artifacts.indexPath,
      JSON.stringify(
        {
          ...artifacts.index,
          latestCommitSummary:
            "最近一次提交是 old123（2026-04-29），主题是“旧摘要”，涉及 packages/client/src/pages/VoiceSecretaryPage.tsx。",
          latestCommitFiles: [
            "packages/client/src/pages/VoiceSecretaryPage.tsx",
          ],
          summary: artifacts.index.summary.replace(
            /最近提交：.*/u,
            "最近提交：最近一次提交是 old123（2026-04-29），主题是“旧摘要”，涉及 packages/client/src/pages/VoiceSecretaryPage.tsx。",
          ),
        },
        null,
        2,
      ),
    );

    const refreshed = await store.ensureProjectArtifacts(projectPath);
    expect(refreshed.index.latestCommitSummary).toContain("Seed project");
    expect(refreshed.index.latestCommitSummary).not.toContain("涉及");
    expect(refreshed.index.summary).not.toContain("旧摘要");
  });
});
