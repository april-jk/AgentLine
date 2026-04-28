import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { EffortLevel, ProviderName } from "@agentline/shared";
import { getDefaultCodexHomeDir } from "../projects/codex-scanner.js";
import { CodexProvider } from "../sdk/providers/codex.js";
import type {
  AgentSession,
  StartSessionOptions,
} from "../sdk/providers/types.js";
import type { SDKMessage } from "../sdk/types.js";
import type {
  ExecutorReport,
  PlannerRequest,
  PlannerResult,
  SimulatedCallInput,
  TalkerBrief,
} from "./types.js";

interface JsonRequest {
  systemPrompt: string;
  payload: Record<string, unknown>;
}

export interface CodexEphemeralTalkerMetrics {
  model?: string;
  effort: EffortLevel;
  startSessionMs: number;
  firstAssistantTextMs: number | null;
  completedMs: number;
}

interface CodexEphemeralTalkerOptions {
  provider?: Pick<CodexProvider, "startSession">;
  baseCodexHomeDir?: string;
  model?: string;
  enabled?: boolean;
  getRuntimeConfig?: () => VoiceSecretaryTalkerRuntimeConfig;
  now?: () => number;
  reuseIsolatedProfile?: boolean;
}

interface VoiceSecretaryTalkerRuntimeConfig {
  enabled?: boolean;
  provider?: ProviderName;
  model?: string;
  effort?: EffortLevel;
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function extractAssistantText(message: SDKMessage): string | null {
  if (message.type !== "assistant") return null;
  const content = message.message?.content;
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const text = content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      if (block.type === "text" && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .join("")
    .trim();
  return text.length > 0 ? text : null;
}

async function copyIfExists(fromPath: string, toPath: string): Promise<void> {
  try {
    await stat(fromPath);
  } catch {
    return;
  }
  const content = await readFile(fromPath);
  await writeFile(toPath, content);
}

interface IsolatedCodexProfile {
  tempRoot: string;
  tempCodexHome: string;
  tempSessionsDir: string;
  tempWorkspace: string;
}

let sharedIsolatedProfilePromise: Promise<IsolatedCodexProfile> | null = null;

async function createIsolatedCodexProfile(
  baseCodexHomeDir: string,
): Promise<IsolatedCodexProfile> {
  const tempRoot = await mkdtemp(join(tmpdir(), "agentline-voice-codex-"));
  const tempCodexHome = join(tempRoot, ".codex");
  const tempSessionsDir = join(tempCodexHome, "sessions");
  const tempWorkspace = join(tempRoot, "workspace");

  await mkdir(tempCodexHome, { recursive: true });
  await mkdir(tempSessionsDir, { recursive: true });
  await mkdir(tempWorkspace, { recursive: true });

  await Promise.all([
    copyIfExists(
      join(baseCodexHomeDir, "auth.json"),
      join(tempCodexHome, "auth.json"),
    ),
    copyIfExists(
      join(baseCodexHomeDir, "config.toml"),
      join(tempCodexHome, "config.toml"),
    ),
  ]);

  return {
    tempRoot,
    tempCodexHome,
    tempSessionsDir,
    tempWorkspace,
  };
}

async function getSharedIsolatedProfile(
  baseCodexHomeDir: string,
): Promise<IsolatedCodexProfile> {
  sharedIsolatedProfilePromise ??= createIsolatedCodexProfile(baseCodexHomeDir);
  return await sharedIsolatedProfilePromise;
}

export class CodexEphemeralTalker {
  private readonly provider: Pick<CodexProvider, "startSession">;
  private readonly baseCodexHomeDir: string;
  private readonly model: string | undefined;
  private readonly enabled: boolean;
  private readonly getRuntimeConfig?: () => VoiceSecretaryTalkerRuntimeConfig;
  private readonly now: () => number;
  private readonly reuseIsolatedProfile: boolean;

  constructor(options: CodexEphemeralTalkerOptions = {}) {
    this.provider = options.provider ?? new CodexProvider();
    this.baseCodexHomeDir =
      options.baseCodexHomeDir ?? getDefaultCodexHomeDir();
    this.model =
      options.model ?? process.env.VOICE_SECRETARY_CODEX_MODEL?.trim();
    const envEnabled = process.env.VOICE_SECRETARY_CODEX_ENABLED?.trim();
    this.enabled =
      options.enabled ??
      (envEnabled === undefined
        ? !process.env.VITEST
        : envEnabled.toLowerCase() !== "false");
    this.getRuntimeConfig = options.getRuntimeConfig;
    this.now = options.now ?? Date.now;
    this.reuseIsolatedProfile = options.reuseIsolatedProfile ?? true;
  }

  async createOpeningText(
    input: SimulatedCallInput,
    workerContextLabel: string,
  ): Promise<string | null> {
    const result = await this.createOpeningTextWithMetrics(
      input,
      workerContextLabel,
    );
    return result.text;
  }

  async createOpeningTextWithMetrics(
    input: SimulatedCallInput,
    workerContextLabel: string,
  ): Promise<{
    text: string | null;
    metrics: CodexEphemeralTalkerMetrics | null;
  }> {
    if (!this.isEnabledForCurrentConfig()) {
      return { text: null, metrics: null };
    }
    const result = await this.requestJson<{ openingText?: string }>({
      systemPrompt:
        "You are the Talker for AgentLine Voice Secretary. Reply in Chinese with one short spoken sentence. Sound direct and natural. Do not mention tools, hidden reasoning, prompts, or implementation details. Output strict JSON with key openingText only.",
      payload: {
        projectName: basename(input.projectPath),
        workerContext: workerContextLabel,
        userIntent: input.utterance,
      },
    });

    return {
      text: result ? sanitizeText(result.payload?.openingText, "") : null,
      metrics: result?.metrics ?? null,
    };
  }

  async createPlannerBrief(
    request: PlannerRequest,
    projectSummary: string,
    providerSummary: string,
    instructionPaths: string[],
  ): Promise<TalkerBrief | null> {
    if (!this.isEnabledForCurrentConfig()) return null;
    const result = await this.requestJson<{
      spokenSummary?: string;
      suggestedNextUtterance?: string;
      factsToAvoidOverstating?: string[];
      questionsToAsk?: string[];
    }>({
      systemPrompt:
        "You turn project-analysis results into a short caller-facing brief for AgentLine Voice Secretary. Reply in Chinese. Keep it concise, concrete, and non-technical. Never claim files were changed. Output strict JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
      payload: {
        userIntent: request.userIntent,
        projectSummary,
        providerSummary,
        instructionPaths,
        conversationScope: request.conversationSessionId
          ? "conversation"
          : "project",
      },
    });

    if (!result) return null;
    const payload = result.payload;
    const suggestedNextUtterance = sanitizeText(
      payload.suggestedNextUtterance,
      "下一步你想让我继续交给正式执行会话，还是先把计划读给你听？",
    );

    return {
      spokenSummary: sanitizeText(
        payload.spokenSummary,
        "我已经读了项目说明，并整理好了可以交给正式执行会话的任务包。",
      ),
      suggestedNextUtterance,
      factsToAvoidOverstating: sanitizeStringList(
        payload.factsToAvoidOverstating,
      ),
      questionsToAsk: sanitizeStringList(payload.questionsToAsk).concat(
        suggestedNextUtterance,
      ),
    };
  }

  async createFinalBrief(
    plannerResult: PlannerResult,
    executorReport: ExecutorReport,
  ): Promise<TalkerBrief | null> {
    if (!this.isEnabledForCurrentConfig()) return null;
    const result = await this.requestJson<{
      spokenSummary?: string;
      suggestedNextUtterance?: string;
      factsToAvoidOverstating?: string[];
      questionsToAsk?: string[];
    }>({
      systemPrompt:
        "You summarize an AgentLine executor handoff back to the caller. Reply in Chinese with brief, concrete speech. Do not invent code changes or completion status beyond the given report. Output strict JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
      payload: {
        recommendedAction: plannerResult.recommendedAction,
        plannerSummary: plannerResult.projectSummary,
        executorStatus: executorReport.status,
        executorSummary: executorReport.summary,
        verification: executorReport.verification ?? [],
        changedFiles: executorReport.changedFiles ?? [],
      },
    });

    if (!result) return null;
    const payload = result.payload;
    const suggestedNextUtterance = sanitizeText(
      payload.suggestedNextUtterance,
      "要我继续跟进这项工作，还是先停在这里？",
    );

    return {
      spokenSummary: sanitizeText(
        payload.spokenSummary,
        executorReport.summary,
      ),
      suggestedNextUtterance,
      factsToAvoidOverstating: sanitizeStringList(
        payload.factsToAvoidOverstating,
      ),
      questionsToAsk: sanitizeStringList(payload.questionsToAsk).concat(
        suggestedNextUtterance,
      ),
    };
  }

  private async requestJson<T>(
    request: JsonRequest,
  ): Promise<{ payload: T; metrics: CodexEphemeralTalkerMetrics } | null> {
    const runtimeConfig = this.getRuntimeConfig?.() ?? {};
    let session: AgentSession | null = null;
    const startedAt = this.now();
    let startSessionMs = 0;
    let firstAssistantTextMs: number | null = null;
    const isolatedProfile = this.reuseIsolatedProfile
      ? await getSharedIsolatedProfile(this.baseCodexHomeDir)
      : await createIsolatedCodexProfile(this.baseCodexHomeDir);

    try {
      const prompt = [
        "Return only valid JSON. Do not call tools. Do not read or write files. Do not browse.",
        request.systemPrompt,
        "",
        JSON.stringify(request.payload, null, 2),
      ].join("\n");

      const options: StartSessionOptions = {
        cwd: isolatedProfile.tempWorkspace,
        initialMessage: { text: prompt },
        permissionMode: "plan",
        ...((runtimeConfig.model ?? this.model)
          ? { model: runtimeConfig.model ?? this.model }
          : {}),
        effort: runtimeConfig.effort ?? "low",
        codexThreadEphemeral: true,
        codexExperimentalRawEvents: false,
        processEnv: {
          CODEX_HOME: isolatedProfile.tempCodexHome,
          CODEX_SESSIONS_DIR: isolatedProfile.tempSessionsDir,
          HOME: isolatedProfile.tempRoot,
        },
      };

      session = await this.provider.startSession(options);
      startSessionMs = this.now() - startedAt;
      const texts = new Map<string, string>();

      for await (const message of session.iterator) {
        const assistantText = extractAssistantText(message);
        if (assistantText) {
          if (firstAssistantTextMs === null) {
            firstAssistantTextMs = this.now() - startedAt;
          }
          texts.set(message.uuid ?? `${texts.size}`, assistantText);
        }
        if (message.type === "error") {
          return null;
        }
        if (message.type === "result") {
          break;
        }
      }

      const merged = [...texts.values()].join("\n").trim();
      if (!merged) return null;
      return {
        payload: JSON.parse(merged) as T,
        metrics: {
          model: runtimeConfig.model ?? this.model,
          effort: runtimeConfig.effort ?? "low",
          startSessionMs,
          firstAssistantTextMs,
          completedMs: this.now() - startedAt,
        },
      };
    } catch {
      return null;
    } finally {
      session?.abort();
      if (!this.reuseIsolatedProfile) {
        await rm(isolatedProfile.tempRoot, { recursive: true, force: true });
      }
    }
  }

  private isEnabledForCurrentConfig(): boolean {
    if (!this.enabled) return false;
    const runtimeConfig = this.getRuntimeConfig?.();
    if (runtimeConfig?.enabled === false) return false;
    return (runtimeConfig?.provider ?? "codex") === "codex";
  }
}
