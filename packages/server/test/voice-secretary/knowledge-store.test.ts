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

    const indexContent = JSON.parse(
      await readFile(artifacts.indexPath, "utf-8"),
    );
    const memoryContent = JSON.parse(
      await readFile(artifacts.memoryPath, "utf-8"),
    );

    expect(indexContent.projectPositioning).toContain("mobile-first");
    expect(indexContent.currentCapabilities).toContain("Mobile supervision");
    expect(indexContent.summary).toContain("项目定位");
    expect(memoryContent.summaryNotes[0]).toContain("Talker记忆已初始化");
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
});
