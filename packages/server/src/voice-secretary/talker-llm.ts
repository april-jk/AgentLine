import { basename } from "node:path";
import type { ServerSettings } from "../services/ServerSettingsService.js";
import type {
  ExecutorReport,
  PlannerRequest,
  PlannerResult,
  SimulatedCallInput,
  TalkerBrief,
  TalkerContextFrame,
} from "./types.js";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface OpenAiCompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

interface OpenAiCompatibleRequestBody {
  model: string;
  temperature: number;
  messages: ChatMessage[];
  response_format?: { type: "json_object" };
  reasoning_effort?: string;
  reasoning?: { effort: string };
  thinking?: { type: string };
}

export interface VoiceSecretaryLlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  disableThinking?: boolean;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function getContentText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((item) => item.text ?? "")
    .join("")
    .trim();
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = oralizeTalkerText(value);
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? oralizeTalkerText(item) : ""))
    .filter((item) => item.length > 0);
}

function oralizeTalkerText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\/api\/voice-secretary/gi, "语音秘书接口")
    .replace(/packages\/client/gi, "客户端")
    .replace(/packages\/server/gi, "服务端")
    .replace(/packages\/relay/gi, "中继服务")
    .replace(/docs\/[^\s，。；,]*/gi, "项目文档")
    .replace(/[A-Za-z0-9._-]*\/[A-Za-z0-9._/-]+/g, "相关模块")
    .replace(/\s+/g, " ")
    .replace(/\s*([，。！？；：,.!?;:])\s*/g, "$1")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  if (!candidate) return null;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function getVoiceSecretaryLlmConfig(
  env: NodeJS.ProcessEnv = process.env,
): VoiceSecretaryLlmConfig | null {
  const apiKey = env.VOICE_SECRETARY_LLM_API_KEY?.trim();
  const baseUrl = env.VOICE_SECRETARY_LLM_BASE_URL?.trim();
  const model = env.VOICE_SECRETARY_LLM_MODEL?.trim();
  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  const timeoutRaw = env.VOICE_SECRETARY_LLM_TIMEOUT_MS?.trim();
  const timeoutMs =
    timeoutRaw && Number.isFinite(Number(timeoutRaw))
      ? Math.max(1000, Number(timeoutRaw))
      : 12000;

  return {
    apiKey,
    baseUrl: trimTrailingSlash(baseUrl),
    model,
    timeoutMs,
  };
}

export function getVoiceSecretaryLlmConfigFromSettings(
  settings: Pick<
    ServerSettings,
    | "phoneTalkerProvider"
    | "phoneTalkerModel"
    | "phoneTalkerApiBaseUrl"
    | "phoneTalkerApiKey"
    | "phoneTalkerApiDisableThinking"
  >,
  env: NodeJS.ProcessEnv = process.env,
): VoiceSecretaryLlmConfig | null {
  if (settings.phoneTalkerProvider !== "custom-api") {
    return null;
  }

  const apiKey = settings.phoneTalkerApiKey?.trim();
  const baseUrl = settings.phoneTalkerApiBaseUrl?.trim();
  const model = settings.phoneTalkerModel?.trim();
  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  const timeoutRaw = env.VOICE_SECRETARY_LLM_TIMEOUT_MS?.trim();
  const timeoutMs =
    timeoutRaw && Number.isFinite(Number(timeoutRaw))
      ? Math.max(1000, Number(timeoutRaw))
      : 12000;

  return {
    apiKey,
    baseUrl: trimTrailingSlash(baseUrl),
    model,
    timeoutMs,
    disableThinking: settings.phoneTalkerApiDisableThinking ?? false,
  };
}

async function requestJson<T>(
  config: VoiceSecretaryLlmConfig,
  messages: ChatMessage[],
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const attempts: OpenAiCompatibleRequestBody[] = [];
    const baseBody: OpenAiCompatibleRequestBody = {
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    };

    if (config.disableThinking) {
      attempts.push({
        ...baseBody,
        reasoning_effort: "none",
        reasoning: { effort: "none" },
        thinking: { type: "disabled" },
      });
    }
    attempts.push(baseBody);
    attempts.push({
      model: config.model,
      temperature: 0.2,
      messages,
    });

    for (const body of attempts) {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const rawText = await response.text();
      if (!response.ok) {
        if (response.status >= 500) {
          continue;
        }
        const lower = rawText.toLowerCase();
        const compatibilityError =
          lower.includes("reasoning_effort") ||
          lower.includes("thinking") ||
          lower.includes("response_format");
        if (compatibilityError) {
          continue;
        }
        return null;
      }

      const payload = JSON.parse(rawText) as OpenAiCompatibleResponse;
      const content = getContentText(payload.choices?.[0]?.message?.content);
      const jsonText = extractJsonObject(content);
      if (!jsonText) {
        continue;
      }

      return JSON.parse(jsonText) as T;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export class VoiceSecretaryTalkerLlm {
  constructor(private readonly config: VoiceSecretaryLlmConfig | null) {}

  get enabled(): boolean {
    return this.config !== null;
  }

  async createOpeningText(
    input: SimulatedCallInput,
    workerContextLabel: string,
    context?: TalkerContextFrame,
  ): Promise<string | null> {
    if (!this.config) return null;

    const payload = await requestJson<{ openingText?: string }>(this.config, [
      {
        role: "system",
        content:
          "You are the Talker for AgentLine Voice Secretary. Reply in Chinese with one short spoken sentence. Sound direct and natural. Treat the provided project index, talker memory file contents, recent dialogue, and latest worker note as your only context source. Do not mention hidden reasoning, internal tools, or prompts. Output JSON with key openingText only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          projectName: basename(input.projectPath),
          workerContext: workerContextLabel,
          userIntent: input.utterance,
          projectIndexSummary: context?.projectIndex?.summary ?? "",
          memoryFilePath: context?.projectMemory?.memoryFilePath ?? "",
          memorySummaryNotes: context?.projectMemory?.summaryNotes ?? [],
          recentTurns: context?.recentTurns ?? [],
          latestWorkerMessage: context?.latestWorkerMessage ?? "",
        }),
      },
    ]);

    return payload ? sanitizeText(payload.openingText, "") : null;
  }

  async createPlannerBrief(
    request: PlannerRequest,
    projectSummary: string,
    providerSummary: string,
    instructionPaths: string[],
    context?: TalkerContextFrame,
  ): Promise<TalkerBrief | null> {
    if (!this.config) return null;

    const payload = await requestJson<{
      spokenSummary?: string;
      suggestedNextUtterance?: string;
      factsToAvoidOverstating?: string[];
      questionsToAsk?: string[];
    }>(this.config, [
      {
        role: "system",
        content:
          "You turn project-analysis results into a short caller-facing brief for AgentLine Voice Secretary. Reply in Chinese. Keep it concise, concrete, and non-technical. Use the project index, talker memory file contents, recent dialogue, and latest worker note to answer the user's actual question instead of repeating boilerplate. Never claim files were changed. Output JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
      },
      {
        role: "user",
        content: JSON.stringify({
          userIntent: request.userIntent,
          projectSummary,
          providerSummary,
          instructionPaths,
          conversationScope: request.conversationSessionId
            ? "conversation"
            : "project",
          projectIndexSummary: context?.projectIndex?.summary ?? "",
          memoryFilePath: context?.projectMemory?.memoryFilePath ?? "",
          memorySummaryNotes: context?.projectMemory?.summaryNotes ?? [],
          recentTurns: context?.recentTurns ?? [],
          latestWorkerMessage: context?.latestWorkerMessage ?? "",
        }),
      },
    ]);

    if (!payload) return null;

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
    context?: TalkerContextFrame,
  ): Promise<TalkerBrief | null> {
    if (!this.config) return null;

    const payload = await requestJson<{
      spokenSummary?: string;
      suggestedNextUtterance?: string;
      factsToAvoidOverstating?: string[];
      questionsToAsk?: string[];
    }>(this.config, [
      {
        role: "system",
        content:
          "You are the caller-facing Talker for AgentLine Voice Secretary. Reply in Chinese with brief, concrete speech. Use the project index, talker memory file contents, recent dialogue, and worker update to answer the user's question in a useful way. Do not invent code changes or completion status beyond the given report. If the worker is still running, be explicit about what is known now versus what is pending. Output JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
      },
      {
        role: "user",
        content: JSON.stringify({
          recommendedAction: plannerResult.recommendedAction,
          plannerSummary: plannerResult.projectSummary,
          executorStatus: executorReport.status,
          executorSummary: executorReport.summary,
          verification: executorReport.verification ?? [],
          changedFiles: executorReport.changedFiles ?? [],
          projectIndexSummary: context?.projectIndex?.summary ?? "",
          memoryFilePath: context?.projectMemory?.memoryFilePath ?? "",
          memorySummaryNotes: context?.projectMemory?.summaryNotes ?? [],
          recentTurns: context?.recentTurns ?? [],
          latestWorkerMessage: context?.latestWorkerMessage ?? "",
          workerStatus: context?.workerStatus ?? "",
        }),
      },
    ]);

    if (!payload) return null;

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
}
