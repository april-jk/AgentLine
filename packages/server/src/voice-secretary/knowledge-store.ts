import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { getDataDir } from "../config.js";
import { encodeProjectId } from "../projects/paths.js";
import { applyTranscriptEventToMemory } from "./transcript-digestor.js";
import type {
  AssistantMemory,
  ProjectKnowledgeIndex,
  ProjectTranscriptEvent,
  ProjectWorkerFinding,
  TalkerContextTurn,
  TalkerProjectMemory,
} from "./types.js";

const ASSISTANT_MEMORY_VERSION = 1;
const MAX_RECENT_TURNS = 12;
const MAX_SUMMARY_NOTES = 16;
const MAX_STABLE_FACTS = 12;
const MAX_WORKER_FINDINGS = 12;
const MAX_DIGEST_ITEMS = 10;
const MAX_TOP_LEVEL_ENTRIES = 12;
const MAX_NOTABLE_FILES = 10;
const MAX_SNIPPET_CHARS = 320;
const MAX_LIST_ITEMS = 6;
const TALKER_INDEX_VERSION = 3;
const execFile = promisify(execFileCallback);

function nowIso(): string {
  return new Date().toISOString();
}

function summarizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, MAX_SNIPPET_CHARS);
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueItems(items: string[], limit = MAX_LIST_ITEMS): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const normalized = cleanMarkdown(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function findSectionLines(text: string, heading: string): string[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const normalizedHeading = heading.toLowerCase();
  const startIndex = lines.findIndex(
    (line) =>
      line.trim().toLowerCase().startsWith(`# ${normalizedHeading}`) ||
      line.trim().toLowerCase().startsWith(`## ${normalizedHeading}`) ||
      line.trim().toLowerCase().startsWith(`### ${normalizedHeading}`),
  );
  if (startIndex === -1) return [];

  const section: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (/^#{1,3}\s/.test(line)) break;
    section.push(line);
  }
  return section;
}

function extractBulletsFromSection(text: string, heading: string): string[] {
  const lines = findSectionLines(text, heading);
  return uniqueItems(
    lines
      .filter((line) => /^[-*]\s+/.test(line.trim()))
      .map((line) =>
        line
          .replace(/^[-*]\s+/, "")
          .replace(/\*\*/g, "")
          .replace(/\|/g, " ")
          .trim(),
      ),
  );
}

function humanizeFeature(item: string): string {
  const normalized = cleanMarkdown(item);
  const lower = normalized.toLowerCase();
  if (lower.startsWith("interop")) {
    return "可查看并续接 CLI、VS Code 等来源的会话";
  }
  if (lower.startsWith("file uploads")) {
    return "支持从手机上传截图、照片、PDF 和代码文件";
  }
  if (lower.startsWith("push notifications")) {
    return "支持审批提醒和锁屏回复";
  }
  if (lower.startsWith("e2e encrypted remote access")) {
    return "支持通过 relay 的端到端加密远程访问";
  }
  if (lower.startsWith("fork/clone conversations")) {
    return "支持从任意消息点 fork 或 clone 会话";
  }
  if (lower.startsWith("tiered inbox")) {
    return "支持按 Needs Attention、Active、Recent、Unread 分层管理会话";
  }
  if (lower.startsWith("global activity stream")) {
    return "支持查看所有 agent 的全局活动流";
  }
  if (lower.startsWith("remote device control")) {
    return "支持通过 WebRTC 远程控制 Android 设备和模拟器";
  }
  if (lower.startsWith("server-owned processes")) {
    return "Agent 进程由服务端持有，客户端断开也不会中断任务";
  }
  if (lower.startsWith("voice input")) {
    return "支持语音输入和 Voice Secretary 入口";
  }
  if (lower.startsWith("fast on mobile")) {
    return "移动端渲染和高亮在服务端完成，手机体验更轻";
  }
  return normalized;
}

function extractRoadmapHeadings(text: string): string[] {
  return uniqueItems(
    text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line) => line.startsWith("### "))
      .map((line) =>
        line
          .replace(/^###\s+/, "")
          .replace(/^\d+\.\s*/, "")
          .trim(),
      ),
  );
}

function extractFirstMeaningfulParagraph(text: string): string | null {
  const paragraphs = text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => cleanMarkdown(paragraph))
    .filter(
      (paragraph) =>
        paragraph.length > 20 &&
        !paragraph.startsWith("<") &&
        !paragraph.includes("srcset="),
    );
  return paragraphs[0] ?? null;
}

function buildCoreModules(topLevelEntries: string[]): string[] {
  const modules: string[] = [];
  if (topLevelEntries.some((entry) => entry === "packages/")) {
    modules.push("packages/client 负责 React 客户端与移动端界面");
    modules.push("packages/server 负责 Hono 服务端、provider 集成和实时会话");
    modules.push("packages/relay 负责远程访问中继");
  }
  if (topLevelEntries.some((entry) => entry === "site/")) {
    modules.push("site 负责官网与 remote 入口");
  }
  if (topLevelEntries.some((entry) => entry === "docs/")) {
    modules.push("docs 负责项目、功能与 roadmap 文档");
  }
  return uniqueItems(modules);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function listTopLevelEntries(projectPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, MAX_TOP_LEVEL_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  } catch {
    return [];
  }
}

async function readLatestCommit(projectPath: string): Promise<{
  summary?: string;
  files: string[];
}> {
  try {
    const [{ stdout: metaStdout }, { stdout: filesStdout }] = await Promise.all(
      [
        execFile(
          "git",
          [
            "-C",
            projectPath,
            "log",
            "-1",
            "--date=short",
            "--pretty=format:%h%n%s%n%ad",
          ],
          { timeout: 5000 },
        ),
        execFile(
          "git",
          ["-C", projectPath, "show", "--name-only", "--format=", "-1", "HEAD"],
          { timeout: 5000 },
        ),
      ],
    );

    const [hash = "", subject = "", date = ""] = metaStdout
      .split("\n")
      .map((line) => line.trim());
    const files = filesStdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_LIST_ITEMS);

    if (!hash || !subject) {
      return { files };
    }

    const summary = `最近一次提交是 ${hash}（${date || "日期未知"}），主题是“${subject}”。`;
    return { summary, files };
  } catch {
    return { files: [] };
  }
}

interface TalkerKnowledgeArtifacts {
  projectId: string;
  projectDir: string;
  indexPath: string;
  memoryPath: string;
  transcriptPath: string;
  assistantMemoryPath: string;
  assistantMemory: AssistantMemory;
  index: ProjectKnowledgeIndex;
  memory: TalkerProjectMemory;
}

function isProjectKnowledgeIndex(
  value: ProjectKnowledgeIndex | null,
): value is ProjectKnowledgeIndex {
  return Boolean(
    value &&
      value.indexVersion === TALKER_INDEX_VERSION &&
      typeof value.projectName === "string" &&
      typeof value.projectPath === "string" &&
      typeof value.projectPositioning === "string" &&
      Array.isArray(value.currentCapabilities) &&
      Array.isArray(value.voiceSecretaryStatus) &&
      Array.isArray(value.coreModules) &&
      Array.isArray(value.recentFocus) &&
      Array.isArray(value.knownNextSteps) &&
      (value.latestCommitSummary === undefined ||
        typeof value.latestCommitSummary === "string") &&
      (value.latestCommitFiles === undefined ||
        Array.isArray(value.latestCommitFiles)) &&
      Array.isArray(value.topLevelEntries) &&
      Array.isArray(value.notableFiles) &&
      typeof value.summary === "string",
  );
}

function isAssistantMemory(
  value: AssistantMemory | null,
): value is AssistantMemory {
  return Boolean(
    value &&
      value.version === ASSISTANT_MEMORY_VERSION &&
      typeof value.updatedAt === "string" &&
      typeof value.memoryFilePath === "string" &&
      typeof value.userProfile?.language === "string" &&
      Array.isArray(value.userProfile?.style) &&
      Array.isArray(value.relationshipSummary) &&
      Array.isArray(value.recentConversationDigest) &&
      Array.isArray(value.spokenStyleHints),
  );
}

function isProjectMemory(
  value: TalkerProjectMemory | null,
): value is TalkerProjectMemory {
  return Boolean(
    value &&
      typeof value.projectPath === "string" &&
      typeof value.updatedAt === "string" &&
      typeof value.memoryFilePath === "string" &&
      Array.isArray(value.recentTurns) &&
      Array.isArray(value.summaryNotes) &&
      (value.latestWorkerMessage === undefined ||
        typeof value.latestWorkerMessage === "string"),
  );
}

function inferWorkerFindingTopic(message: string): string {
  const normalized = cleanMarkdown(message);
  if (/提交|commit/i.test(normalized)) return "最近提交";
  if (/语音|asr|tts/i.test(normalized)) return "语音链路";
  if (/项目.*(进展|现状|状态)/.test(normalized)) return "项目进展";
  if (/worker|项目专家/.test(normalized)) return "项目专家补充";
  return "项目细节";
}

export class VoiceSecretaryKnowledgeStore {
  private readonly rootDir: string;
  private readonly projectsRootDir: string;

  constructor(dataDir?: string) {
    const resolvedDataDir =
      dataDir ??
      (process.env.VITEST
        ? path.join(tmpdir(), "agentline-voice-secretary-test")
        : getDataDir());
    this.rootDir = path.join(resolvedDataDir, "voice-secretary");
    this.projectsRootDir = path.join(this.rootDir, "projects");
  }

  async ensureAssistantMemory(): Promise<AssistantMemory> {
    await fs.mkdir(this.rootDir, { recursive: true });
    const memoryPath = path.join(this.rootDir, "assistant-memory.json");
    const cachedMemory = await this.readJson<AssistantMemory>(memoryPath);
    const memory = isAssistantMemory(cachedMemory)
      ? cachedMemory
      : this.createAssistantMemory(memoryPath);
    await this.writeJson(memoryPath, memory);
    return memory;
  }

  async ensureProjectArtifacts(
    projectPath: string,
  ): Promise<TalkerKnowledgeArtifacts> {
    const assistantMemoryPath = path.join(
      this.rootDir,
      "assistant-memory.json",
    );
    const assistantMemory = await this.ensureAssistantMemory();
    const projectId = encodeProjectId(projectPath);
    const projectDir = await this.resolveProjectDir(projectId);
    const indexPath = path.join(projectDir, "talker-index.json");
    const memoryPath = path.join(projectDir, "talker-memory.json");
    const transcriptPath = path.join(projectDir, "project-transcript.jsonl");

    await fs.mkdir(projectDir, { recursive: true });

    const cachedIndex = await this.readJson<ProjectKnowledgeIndex>(indexPath);
    const index = isProjectKnowledgeIndex(cachedIndex)
      ? await this.refreshProjectIndex(projectPath, cachedIndex)
      : await this.buildProjectIndex(projectPath);
    const cachedMemory = await this.readJson<TalkerProjectMemory>(memoryPath);
    const memory = this.normalizeProjectMemory(
      cachedMemory,
      projectPath,
      memoryPath,
      index,
    );

    await Promise.all([
      this.writeJson(indexPath, index),
      this.writeJson(memoryPath, memory),
    ]);

    return {
      projectId,
      projectDir,
      indexPath,
      memoryPath,
      transcriptPath,
      assistantMemoryPath,
      assistantMemory,
      index,
      memory,
    };
  }

  async recordTalkerTurn(
    projectPath: string,
    turns: TalkerContextTurn[],
    note?: string,
  ): Promise<TalkerProjectMemory> {
    const artifacts = await this.ensureProjectArtifacts(projectPath);
    const mergedTurns = artifacts.memory.recentTurns
      .concat(turns)
      .slice(-MAX_RECENT_TURNS);
    const summaryNotes = [...artifacts.memory.summaryNotes];
    const trimmedNote = note?.trim();
    if (trimmedNote) {
      summaryNotes.push(trimmedNote);
    }
    const latestDigest = trimmedNote ?? this.buildTurnDigest(turns);
    let memory: TalkerProjectMemory = {
      ...artifacts.memory,
      updatedAt: nowIso(),
      recentTurns: mergedTurns,
      summaryNotes: summaryNotes.slice(-MAX_SUMMARY_NOTES),
    };
    const assistantMemory = this.appendAssistantDigest(
      artifacts.assistantMemory,
      latestDigest,
    );
    const digestEvent = {
      at: nowIso(),
      source: "system",
      kind: "memory_note",
      text: latestDigest,
    } as const;
    memory = applyTranscriptEventToMemory(memory, digestEvent);
    await this.appendTranscriptEvent(artifacts.transcriptPath, digestEvent);
    for (const turn of turns) {
      await this.appendTranscriptEvent(artifacts.transcriptPath, {
        at: turn.at,
        source: turn.speaker,
        kind: "turn",
        text: turn.text,
      });
      memory = applyTranscriptEventToMemory(memory, {
        at: turn.at,
        source: turn.speaker,
        kind: "turn",
        text: turn.text,
      });
    }
    await this.writeJson(artifacts.memoryPath, memory);
    await this.writeJson(artifacts.assistantMemoryPath, assistantMemory);
    return memory;
  }

  async recordWorkerUpdate(
    projectPath: string,
    message: string,
    options: {
      source?: "worker" | "initializer" | "system";
      topic?: string;
      confidence?: "low" | "medium" | "high";
      promoteToStableFacts?: boolean;
    } = {},
  ): Promise<TalkerProjectMemory> {
    const artifacts = await this.ensureProjectArtifacts(projectPath);
    const note = `Worker补充：${message}`.trim();
    const finding: ProjectWorkerFinding = {
      at: nowIso(),
      topic: options.topic ?? inferWorkerFindingTopic(message),
      summary: cleanMarkdown(message),
      confidence: options.confidence ?? "high",
      source: options.source ?? "worker",
      promotable: options.promoteToStableFacts ?? true,
    };
    let memory: TalkerProjectMemory = {
      ...artifacts.memory,
      updatedAt: nowIso(),
      latestWorkerMessage: message,
      stableFacts: finding.promotable
        ? uniqueItems(
            [finding.summary, ...artifacts.memory.stableFacts],
            MAX_STABLE_FACTS,
          )
        : artifacts.memory.stableFacts,
      workerFindings: artifacts.memory.workerFindings
        .concat(finding)
        .slice(-MAX_WORKER_FINDINGS),
      recentChangesDigest: uniqueItems(
        [cleanMarkdown(message), ...artifacts.memory.recentChangesDigest],
        MAX_DIGEST_ITEMS,
      ),
      summaryNotes: artifacts.memory.summaryNotes
        .concat(note)
        .slice(-MAX_SUMMARY_NOTES),
    };
    const transcriptEvent = {
      at: finding.at,
      source: finding.source,
      kind: "worker_message",
      text: finding.summary,
      topic: finding.topic,
    } as const;
    memory = applyTranscriptEventToMemory(memory, transcriptEvent);
    await this.appendTranscriptEvent(artifacts.transcriptPath, transcriptEvent);
    await this.writeJson(artifacts.memoryPath, memory);
    return memory;
  }

  async appendProjectTranscriptEvent(
    projectPath: string,
    event: ProjectTranscriptEvent,
  ): Promise<void> {
    const artifacts = await this.ensureProjectArtifacts(projectPath);
    await this.appendTranscriptEvent(artifacts.transcriptPath, event);
    const memory = applyTranscriptEventToMemory(artifacts.memory, event);
    await this.writeJson(artifacts.memoryPath, memory);
  }

  private async buildProjectIndex(
    projectPath: string,
  ): Promise<ProjectKnowledgeIndex> {
    const projectName = path.basename(projectPath);
    const topLevelEntries = await listTopLevelEntries(projectPath);
    const candidateFiles = [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "package.json",
      "docs/README.md",
      "docs/project/README.md",
      "docs/roadmap/README.md",
      "docs/features/voice-secretary/README.md",
    ];

    const notablePairs = (
      await Promise.all(
        candidateFiles.map(async (relativePath) => {
          const content = await readTextIfExists(
            path.join(projectPath, relativePath),
          );
          return content ? [relativePath, summarizeText(content)] : null;
        }),
      )
    )
      .filter((entry): entry is [string, string] => entry !== null)
      .slice(0, MAX_NOTABLE_FILES);

    const fileMap = new Map<string, string>(
      (
        await Promise.all(
          candidateFiles.map(async (relativePath) => {
            const content = await readTextIfExists(
              path.join(projectPath, relativePath),
            );
            return content ? [relativePath, content] : null;
          }),
        )
      ).filter((entry): entry is [string, string] => entry !== null),
    );

    const readmeText = fileMap.get("README.md") ?? "";
    const claudeText = fileMap.get("CLAUDE.md") ?? "";
    const roadmapText = fileMap.get("docs/roadmap/README.md") ?? "";
    const voiceSecretaryText =
      fileMap.get("docs/features/voice-secretary/README.md") ?? "";
    const latestCommit = await readLatestCommit(projectPath);

    const projectPositioning =
      extractFirstMeaningfulParagraph(readmeText) ??
      extractFirstMeaningfulParagraph(claudeText) ??
      `${projectName} 是一个有移动端监督和多 provider 能力的项目。`;

    const currentCapabilities = uniqueItems([
      ...extractBulletsFromSection(readmeText, "Features").map(humanizeFeature),
      "支持自托管、移动优先的多会话 AI agent 监督界面",
    ]);

    const voiceSecretaryStatus = uniqueItems([
      ...((await fileExists(
        path.join(
          projectPath,
          "packages/client/src/pages/VoiceSecretaryPage.tsx",
        ),
      ))
        ? ["已有 Voice Secretary 页面和实时通话界面"]
        : []),
      ...((await fileExists(
        path.join(projectPath, "packages/server/src/routes/voice-secretary.ts"),
      ))
        ? ["服务端已有 /api/voice-secretary 路由"]
        : []),
      ...((await fileExists(
        path.join(
          projectPath,
          "packages/server/src/voice-secretary/volcengine-speech.ts",
        ),
      ))
        ? ["已接入火山引擎 ASR/TTS 适配层"]
        : []),
      ...((await fileExists(
        path.join(
          projectPath,
          "packages/server/src/voice-secretary/runtime.ts",
        ),
      ))
        ? ["已具备 Talker、Planner、Worker 的运行时拆分"]
        : []),
      ...((await fileExists(
        path.join(
          projectPath,
          "packages/client/src/pages/settings/PhoneSettings.tsx",
        ),
      ))
        ? ["设置页已支持 Talker provider 和模型配置"]
        : []),
      ...extractBulletsFromSection(voiceSecretaryText, "First Milestone"),
    ]);

    const roadmapHeadings = extractRoadmapHeadings(roadmapText);
    const recentFocus = uniqueItems([
      ...roadmapHeadings.slice(0, 4),
      ...(voiceSecretaryText
        ? ["Voice Secretary 是 roadmap 中的优先功能之一"]
        : []),
    ]);

    const knownNextSteps = uniqueItems([
      ...roadmapHeadings.slice(0, 3),
      ...(voiceSecretaryText
        ? ["让 Voice Secretary 能直接回答项目现状，并在后台继续追项目专家"]
        : []),
    ]);

    const coreModules = buildCoreModules(topLevelEntries);

    const summaryLines = [
      `项目名：${projectName}`,
      `项目定位：${projectPositioning}`,
      currentCapabilities.length > 0
        ? `已知能力：${currentCapabilities.join("；")}`
        : "",
      voiceSecretaryStatus.length > 0
        ? `Voice Secretary 状态：${voiceSecretaryStatus.join("；")}`
        : "",
      coreModules.length > 0 ? `核心模块：${coreModules.join("；")}` : "",
      recentFocus.length > 0 ? `最近重点：${recentFocus.join("；")}` : "",
      knownNextSteps.length > 0
        ? `下一步优先级：${knownNextSteps.join("；")}`
        : "",
      latestCommit.summary ? `最近提交：${latestCommit.summary}` : "",
      topLevelEntries.length > 0
        ? `顶层结构：${topLevelEntries.join("、")}`
        : "",
    ].filter(Boolean);

    return {
      indexVersion: TALKER_INDEX_VERSION,
      projectName,
      projectPath,
      generatedAt: nowIso(),
      projectPositioning,
      currentCapabilities,
      voiceSecretaryStatus,
      coreModules,
      recentFocus,
      knownNextSteps,
      latestCommitSummary: latestCommit.summary,
      latestCommitFiles: latestCommit.files,
      topLevelEntries,
      notableFiles: notablePairs.map(([filePath]) => filePath),
      summary: summaryLines.join("\n"),
    };
  }

  private createEmptyMemory(
    projectPath: string,
    memoryFilePath: string,
    index: ProjectKnowledgeIndex,
  ): TalkerProjectMemory {
    const stableFacts = uniqueItems(
      [
        index.projectPositioning,
        ...index.currentCapabilities,
        ...index.voiceSecretaryStatus,
      ],
      MAX_STABLE_FACTS,
    );
    return {
      projectPath,
      updatedAt: nowIso(),
      memoryFilePath,
      stableFacts,
      workerFindings: [],
      recentChangesDigest: uniqueItems(
        [
          index.latestCommitSummary ?? "",
          ...index.recentFocus,
          ...index.knownNextSteps,
        ],
        MAX_DIGEST_ITEMS,
      ),
      openQuestions: [],
      spokenHints: [
        "像秘书一样先说结论，再补背景。",
        "避免念文件路径、markdown、代码块和长英文列表。",
        "不确定的信息要明确说成还在确认。",
      ],
      recentTurns: [],
      summaryNotes: [
        "Talker记忆已初始化，可以持续积累项目背景、最近对话和Worker补充信息。",
      ],
    };
  }

  private createAssistantMemory(memoryFilePath: string): AssistantMemory {
    return {
      version: ASSISTANT_MEMORY_VERSION,
      updatedAt: nowIso(),
      memoryFilePath,
      userProfile: {
        language: "zh-CN",
        style: ["口语化", "简洁", "不要markdown", "避免长路径"],
      },
      relationshipSummary: [
        "用户把 Talker 当作语音秘书，希望先直接回答，再按需找项目专家补细节。",
        "Talker 应该保持中文、自然、简短，不要像在念日志或代码。",
      ],
      recentConversationDigest: [],
      spokenStyleHints: [
        "先给结论，再补一句背景。",
        "尽量用口语，不要列路径或接口名。",
        "如果还在等 Worker，就直说正在补充，不要装作已经完成。",
      ],
    };
  }

  private normalizeProjectMemory(
    value: TalkerProjectMemory | null,
    projectPath: string,
    memoryFilePath: string,
    index: ProjectKnowledgeIndex,
  ): TalkerProjectMemory {
    if (!isProjectMemory(value)) {
      return this.createEmptyMemory(projectPath, memoryFilePath, index);
    }

    return {
      projectPath,
      updatedAt: value.updatedAt || nowIso(),
      memoryFilePath,
      recentTurns: Array.isArray(value.recentTurns) ? value.recentTurns : [],
      stableFacts: uniqueItems(
        [
          ...(Array.isArray(value.stableFacts) ? value.stableFacts : []),
          index.projectPositioning,
          ...index.currentCapabilities,
        ],
        MAX_STABLE_FACTS,
      ),
      workerFindings: Array.isArray(value.workerFindings)
        ? value.workerFindings
            .filter(
              (finding) =>
                typeof finding?.at === "string" &&
                typeof finding?.topic === "string" &&
                typeof finding?.summary === "string",
            )
            .slice(-MAX_WORKER_FINDINGS)
        : [],
      recentChangesDigest: uniqueItems(
        [
          ...(Array.isArray(value.recentChangesDigest)
            ? value.recentChangesDigest
            : []),
          index.latestCommitSummary ?? "",
        ],
        MAX_DIGEST_ITEMS,
      ),
      openQuestions: uniqueItems(
        Array.isArray(value.openQuestions) ? value.openQuestions : [],
        MAX_DIGEST_ITEMS,
      ),
      spokenHints: uniqueItems(
        [
          ...(Array.isArray(value.spokenHints) ? value.spokenHints : []),
          "像秘书一样先说结论，再补背景。",
          "避免念文件路径、markdown、代码块和长英文列表。",
        ],
        MAX_LIST_ITEMS,
      ),
      summaryNotes: Array.isArray(value.summaryNotes)
        ? value.summaryNotes.slice(-MAX_SUMMARY_NOTES)
        : [],
      latestWorkerMessage:
        typeof value.latestWorkerMessage === "string"
          ? value.latestWorkerMessage
          : undefined,
    };
  }

  private appendAssistantDigest(
    memory: AssistantMemory,
    digest: string,
  ): AssistantMemory {
    const trimmedDigest = cleanMarkdown(digest);
    if (!trimmedDigest) {
      return memory;
    }
    return {
      ...memory,
      updatedAt: nowIso(),
      recentConversationDigest: uniqueItems(
        [...memory.recentConversationDigest, trimmedDigest],
        MAX_DIGEST_ITEMS,
      ),
    };
  }

  private buildTurnDigest(turns: TalkerContextTurn[]): string {
    const userTurn = [...turns]
      .reverse()
      .find((turn: TalkerContextTurn) => turn.speaker === "user")?.text;
    const talkerTurn = [...turns]
      .reverse()
      .find((turn: TalkerContextTurn) => turn.speaker === "talker")?.text;
    return [
      userTurn ? `用户问了：${userTurn}` : "",
      talkerTurn ? `Talker回答：${talkerTurn}` : "",
    ]
      .filter(Boolean)
      .join("；");
  }

  private async resolveProjectDir(projectId: string): Promise<string> {
    await fs.mkdir(this.projectsRootDir, { recursive: true });
    const projectDir = path.join(this.projectsRootDir, projectId);
    const legacyProjectDir = path.join(this.rootDir, projectId);
    if (
      !(await fileExists(projectDir)) &&
      (await fileExists(legacyProjectDir))
    ) {
      await fs.rename(legacyProjectDir, projectDir);
    }
    return projectDir;
  }

  private async readJson<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  private async appendTranscriptEvent(
    transcriptPath: string,
    event: ProjectTranscriptEvent,
  ): Promise<void> {
    await fs.appendFile(transcriptPath, `${JSON.stringify(event)}\n`, "utf-8");
  }

  private async refreshProjectIndex(
    projectPath: string,
    index: ProjectKnowledgeIndex,
  ): Promise<ProjectKnowledgeIndex> {
    const latestCommit = await readLatestCommit(projectPath);
    const nextSummary = latestCommit.summary;
    const nextFiles = latestCommit.files;
    const summaryMatches = index.latestCommitSummary === nextSummary;
    const filesMatch =
      JSON.stringify(index.latestCommitFiles ?? []) ===
      JSON.stringify(nextFiles);
    if (summaryMatches && filesMatch) {
      return index;
    }

    const summaryLines = index.summary
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("最近提交："));
    if (nextSummary) {
      summaryLines.push(`最近提交：${nextSummary}`);
    }

    return {
      ...index,
      generatedAt: nowIso(),
      latestCommitSummary: nextSummary,
      latestCommitFiles: nextFiles,
      summary: summaryLines.join("\n"),
    };
  }
}
