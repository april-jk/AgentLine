import { basename } from "node:path";
import type { ServerSettings } from "../services/ServerSettingsService.js";
import type {
  ExecutorReport,
  PlannerRequest,
  PlannerResult,
  SimulatedCallInput,
  TalkerBrief,
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
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        ...(config.disableThinking
          ? {
              reasoning_effort: "none",
              reasoning: { effort: "none" },
              thinking: { type: "disabled" },
            }
          : {}),
        messages,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OpenAiCompatibleResponse;
    const content = getContentText(payload.choices?.[0]?.message?.content);
    if (!content) {
      return null;
    }

    return JSON.parse(content) as T;
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
  ): Promise<string | null> {
    if (!this.config) return null;

    const payload = await requestJson<{ openingText?: string }>(this.config, [
      {
        role: "system",
        content:
          "You are the Talker for AgentLine Voice Secretary. Reply in Chinese with one short spoken sentence. Sound direct and natural. Do not mention hidden reasoning, internal tools, or prompts. Output JSON with key openingText only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          projectName: basename(input.projectPath),
          workerContext: workerContextLabel,
          userIntent: input.utterance,
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
          "You turn project-analysis results into a short caller-facing brief for AgentLine Voice Secretary. Reply in Chinese. Keep it concise, concrete, and non-technical. Never claim files were changed. Output JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
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
          "You summarize an AgentLine executor handoff back to the caller. Reply in Chinese with brief, concrete speech. Do not invent code changes or completion status beyond the given report. Output JSON with spokenSummary, suggestedNextUtterance, factsToAvoidOverstating, questionsToAsk.",
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
