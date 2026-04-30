import { execFile as execFileCallback } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { getDataDir } from "../config.js";
import { encodeProjectId } from "../projects/paths.js";
import type {
  ProjectKnowledgeIndex,
  TalkerContextTurn,
  TalkerProjectMemory,
} from "./types.js";

const MAX_RECENT_TURNS = 12;
const MAX_SUMMARY_NOTES = 16;
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

    const fileSummary = files.length > 0 ? `，涉及 ${files.join("、")}` : "";
    const summary = `最近一次提交是 ${hash}（${date || "日期未知"}），主题是“${subject}”${fileSummary}。`;
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

export class VoiceSecretaryKnowledgeStore {
  private readonly rootDir: string;

  constructor(dataDir = getDataDir()) {
    const resolvedDataDir = process.env.VITEST
      ? path.join(tmpdir(), "agentline-voice-secretary-test")
      : dataDir;
    this.rootDir = path.join(resolvedDataDir, "voice-secretary");
  }

  async ensureProjectArtifacts(
    projectPath: string,
  ): Promise<TalkerKnowledgeArtifacts> {
    const projectId = encodeProjectId(projectPath);
    const projectDir = path.join(this.rootDir, projectId);
    const indexPath = path.join(projectDir, "talker-index.json");
    const memoryPath = path.join(projectDir, "talker-memory.json");

    await fs.mkdir(projectDir, { recursive: true });

    const cachedIndex = await this.readJson<ProjectKnowledgeIndex>(indexPath);
    const index = isProjectKnowledgeIndex(cachedIndex)
      ? cachedIndex
      : await this.buildProjectIndex(projectPath);
    const memory =
      (await this.readJson<TalkerProjectMemory>(memoryPath)) ??
      this.createEmptyMemory(projectPath, memoryPath);

    await Promise.all([
      this.writeJson(indexPath, index),
      this.writeJson(memoryPath, memory),
    ]);

    return { projectId, projectDir, indexPath, memoryPath, index, memory };
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
    if (note?.trim()) {
      summaryNotes.push(note.trim());
    }
    const memory: TalkerProjectMemory = {
      ...artifacts.memory,
      updatedAt: nowIso(),
      recentTurns: mergedTurns,
      summaryNotes: summaryNotes.slice(-MAX_SUMMARY_NOTES),
    };
    await this.writeJson(artifacts.memoryPath, memory);
    return memory;
  }

  async recordWorkerUpdate(
    projectPath: string,
    message: string,
  ): Promise<TalkerProjectMemory> {
    const artifacts = await this.ensureProjectArtifacts(projectPath);
    const note = `Worker补充：${message}`.trim();
    const memory: TalkerProjectMemory = {
      ...artifacts.memory,
      updatedAt: nowIso(),
      latestWorkerMessage: message,
      summaryNotes: artifacts.memory.summaryNotes
        .concat(note)
        .slice(-MAX_SUMMARY_NOTES),
    };
    await this.writeJson(artifacts.memoryPath, memory);
    return memory;
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
  ): TalkerProjectMemory {
    return {
      projectPath,
      updatedAt: nowIso(),
      memoryFilePath,
      recentTurns: [],
      summaryNotes: [
        "Talker记忆已初始化，可以持续积累项目背景、最近对话和Worker补充信息。",
      ],
    };
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
}
