import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import type { ProviderName } from "../sdk/providers/types.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { CodexEphemeralTalker } from "../voice-secretary/codex-ephemeral.js";
import { appendVoiceSecretaryDebugCapture } from "../voice-secretary/debug-capture.js";
import {
  AgentLineExecutorAgentAdapter,
  ProjectPlanner,
  SimulatedCallLoop,
  VoiceSecretaryCallLoop,
  VoiceSecretaryKnowledgeStore,
  VoiceSecretaryRuntimeManager,
  VoiceSecretaryTalker,
} from "../voice-secretary/index.js";
import {
  VoiceSecretaryTalkerLlm,
  getVoiceSecretaryLlmConfig,
  getVoiceSecretaryLlmConfigFromSettings,
} from "../voice-secretary/talker-llm.js";
import type { VoiceProviderCatalog } from "../voice-secretary/types.js";
import {
  VolcengineSpeechService,
  getVolcengineSpeechConfigFromSettings,
} from "../voice-secretary/volcengine-speech.js";

export interface VoiceSecretaryRoutesDeps {
  supervisor?: Supervisor;
  sessionMetadataService?: SessionMetadataService;
  providerCatalog?: VoiceProviderCatalog;
  serverSettingsService?: ServerSettingsService;
  dataDir?: string;
}

interface SimulateBody {
  voiceSessionId?: unknown;
  projectPath?: unknown;
  conversationSessionId?: unknown;
  conversationProvider?: unknown;
  utterance?: unknown;
  executorMode?: unknown;
}

interface CallBody {
  voiceSessionId?: unknown;
  projectPath?: unknown;
  conversationSessionId?: unknown;
  conversationProvider?: unknown;
  utterance?: unknown;
}

interface AudioTurnResponseBody {
  transcript: string;
  confidence?: number;
  talkerText: string;
  audioBase64?: string;
  audioContentType?: string;
  ttsError?: string;
}

type VoiceSecretaryAudioStreamEvent =
  | {
      type: "transcript_final";
      transcript: string;
      confidence?: number;
    }
  | {
      type: "talker_text";
      text: string;
    }
  | {
      type: "audio_start";
      contentType: string;
    }
  | {
      type: "audio_chunk";
      audioBase64: string;
    }
  | {
      type: "result";
      result: unknown;
    }
  | {
      type: "done";
    }
  | {
      type: "error";
      error: string;
    };

function parseConversationSessionId(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

function parseConversationProvider(
  value: unknown,
): ProviderName | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim() as ProviderName;
}

function parseVoiceSessionId(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

function getPhoneTalkerConfig(serverSettingsService?: ServerSettingsService): {
  provider: ProviderName | "custom-api";
  model: string;
  effort: "low" | "medium" | "high" | "max";
} {
  const settings = serverSettingsService?.getSettings();
  return {
    provider: settings?.phoneTalkerProvider ?? "codex",
    model: settings?.phoneTalkerModel ?? "gpt-5.2",
    effort: settings?.phoneTalkerEffort ?? "low",
  };
}

function getTalkerProviderPreference(
  serverSettingsService?: ServerSettingsService,
): "codex-first" | "llm-first" {
  const settings = serverSettingsService?.getSettings();
  return settings?.phoneTalkerProvider === "custom-api"
    ? "llm-first"
    : "codex-first";
}

function createTalkerLlm(serverSettingsService?: ServerSettingsService) {
  const settings = serverSettingsService?.getSettings();
  if (settings?.phoneTalkerProvider === "custom-api") {
    return new VoiceSecretaryTalkerLlm(
      getVoiceSecretaryLlmConfigFromSettings(settings),
    );
  }
  return new VoiceSecretaryTalkerLlm(getVoiceSecretaryLlmConfig());
}

function createSpeechService(serverSettingsService?: ServerSettingsService) {
  const settings = serverSettingsService?.getSettings();
  return new VolcengineSpeechService(
    getVolcengineSpeechConfigFromSettings(settings),
  );
}

export function createVoiceSecretaryRoutes(
  deps: VoiceSecretaryRoutesDeps = {},
): Hono {
  const routes = new Hono();
  const knowledgeStore = new VoiceSecretaryKnowledgeStore(deps.dataDir);
  const runtimeManager = new VoiceSecretaryRuntimeManager(knowledgeStore);
  const textEncoder = new TextEncoder();

  const bindVoiceWorker = (
    voiceSessionId: string | undefined,
    session: { id: string; provider: ProviderName; processId?: string },
  ) => {
    if (!voiceSessionId) return;
    const snapshot = runtimeManager.getSnapshot(voiceSessionId);
    if (!snapshot) return;
    const runtime = runtimeManager.getOrCreateSession({
      voiceSessionId,
      projectPath: snapshot.projectPath,
      conversationSessionId: snapshot.conversationSessionId,
      conversationProvider: snapshot.workerProvider,
    });
    runtimeManager.setWorkerBinding(runtime, {
      workerSessionId: session.id,
      workerProvider: session.provider,
      workerStatus: "running",
    });
    if (!session.processId || !deps.supervisor) return;
    const process = deps.supervisor.getProcess?.(session.processId);
    runtimeManager.bindWorkerProcess(
      runtime,
      session.processId,
      process?.subscribe.bind(process),
    );
  };

  const createVoiceTurnLoop = (voiceSessionId?: string) => {
    if (!deps.supervisor) {
      throw new Error("AgentLine executor is unavailable");
    }
    const executor = new AgentLineExecutorAgentAdapter({
      supervisor: deps.supervisor,
      sessionMetadataService: deps.sessionMetadataService,
      onSessionCreated: (session) => bindVoiceWorker(voiceSessionId, session),
    });
    const codexTalker = new CodexEphemeralTalker({
      getRuntimeConfig: () => getPhoneTalkerConfig(deps.serverSettingsService),
    });
    const llm = createTalkerLlm(deps.serverSettingsService);
    const providerPreference = getTalkerProviderPreference(
      deps.serverSettingsService,
    );
    const talker = new VoiceSecretaryTalker(
      codexTalker,
      llm,
      providerPreference,
    );
    const planner = new ProjectPlanner(
      deps.providerCatalog,
      codexTalker,
      llm,
      providerPreference,
    );
    const loop = new VoiceSecretaryCallLoop(executor, {
      providerCatalog: deps.providerCatalog,
      talker,
      planner,
      knowledgeStore,
      runtimeManager,
    });
    return { loop };
  };

  const resolveTalkerText = (
    result: Awaited<ReturnType<VoiceSecretaryCallLoop["run"]>>,
  ) =>
    result.finalBrief.spokenSummary.trim() ||
    result.callSession.transcript
      .filter((turn) => turn.speaker === "talker")
      .map((turn) => turn.text.trim())
      .find((text) => text.length > 0) ||
    "我已经准备好了下一步的正式执行建议。";

  const splitTalkerTextForStreaming = (text: string): string[] => {
    const normalized = text.trim();
    if (!normalized) return [];
    const sentenceChunks = normalized.match(
      /[^，。！？；,.!?;\n]+[，。！？；,.!?;\n]?/g,
    ) ?? [normalized];
    return sentenceChunks.flatMap((chunk) => {
      const trimmed = chunk.trim();
      if (trimmed.length <= 18) {
        return trimmed ? [trimmed] : [];
      }
      const parts: string[] = [];
      for (let index = 0; index < trimmed.length; index += 18) {
        parts.push(trimmed.slice(index, index + 18));
      }
      return parts;
    });
  };

  const encodeStreamEvent = (event: VoiceSecretaryAudioStreamEvent) =>
    textEncoder.encode(`${JSON.stringify(event)}\n`);

  routes.post("/calls", async (c) => {
    const body = await c.req.json<CallBody>().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.projectPath !== "string" || !body.projectPath.trim()) {
      return c.json({ error: "projectPath is required" }, 400);
    }
    if (typeof body.utterance !== "string" || !body.utterance.trim()) {
      return c.json({ error: "utterance is required" }, 400);
    }
    const conversationSessionId = parseConversationSessionId(
      body.conversationSessionId,
    );
    if (conversationSessionId === null) {
      return c.json({ error: "conversationSessionId must be a string" }, 400);
    }
    const conversationProvider = parseConversationProvider(
      body.conversationProvider,
    );
    if (conversationProvider === null) {
      return c.json({ error: "conversationProvider must be a string" }, 400);
    }
    const voiceSessionId = parseVoiceSessionId(body.voiceSessionId);
    if (voiceSessionId === null) {
      return c.json({ error: "voiceSessionId must be a string" }, 400);
    }
    if (!deps.supervisor) {
      return c.json({ error: "AgentLine executor is unavailable" }, 503);
    }

    const { loop } = createVoiceTurnLoop(voiceSessionId);
    const result = await loop.run({
      voiceSessionId,
      projectPath: body.projectPath,
      conversationSessionId,
      conversationProvider,
      utterance: body.utterance,
    });

    await appendVoiceSecretaryDebugCapture(deps.dataDir, {
      type: "typed-call",
      route: "/calls",
      voiceSessionId: result.voiceSession.id,
      projectPath: body.projectPath.trim(),
      conversationSessionId,
      conversationProvider,
      transcript: body.utterance.trim(),
      talkerText: resolveTalkerText(result),
      finalBrief: result.finalBrief.spokenSummary,
      executorSummary: result.executorReport.summary,
      latestWorkerMessage: result.voiceSession.latestWorkerMessage,
    });

    return c.json({ result });
  });

  routes.post("/calls/audio", async (c) => {
    try {
      if (!deps.supervisor) {
        return c.json({ error: "AgentLine executor is unavailable" }, 503);
      }

      const formData = await c.req.formData().catch(() => null);
      if (!formData) {
        return c.json({ error: "Invalid multipart form body" }, 400);
      }

      const projectPathValue = formData.get("projectPath");
      if (typeof projectPathValue !== "string" || !projectPathValue.trim()) {
        return c.json({ error: "projectPath is required" }, 400);
      }

      const conversationSessionId = parseConversationSessionId(
        formData.get("conversationSessionId"),
      );
      if (conversationSessionId === null) {
        return c.json({ error: "conversationSessionId must be a string" }, 400);
      }
      const conversationProvider = parseConversationProvider(
        formData.get("conversationProvider"),
      );
      if (conversationProvider === null) {
        return c.json({ error: "conversationProvider must be a string" }, 400);
      }
      const voiceSessionId = parseVoiceSessionId(
        formData.get("voiceSessionId"),
      );
      if (voiceSessionId === null) {
        return c.json({ error: "voiceSessionId must be a string" }, 400);
      }

      const audioFile = formData.get("audio");
      if (!(audioFile instanceof File) || audioFile.size === 0) {
        return c.json({ error: "audio is required" }, 400);
      }

      const speech = createSpeechService(deps.serverSettingsService);
      if (!speech.enabled) {
        return c.json({ error: "Volcengine speech is not configured" }, 503);
      }

      const { loop } = createVoiceTurnLoop(voiceSessionId);

      const transcript = await speech.transcribeAudio(
        new Uint8Array(await audioFile.arrayBuffer()),
      );
      if (!transcript) {
        return c.json({ error: "Volcengine ASR did not return text" }, 502);
      }

      const result = await loop.run({
        voiceSessionId,
        projectPath: projectPathValue.trim(),
        conversationSessionId,
        conversationProvider,
        utterance: transcript.text,
      });

      const talkerText = resolveTalkerText(result);
      const body: AudioTurnResponseBody = {
        transcript: transcript.text,
        confidence: transcript.confidence,
        talkerText,
      };

      try {
        const audio = await speech.synthesizeText(talkerText);
        if (audio) {
          body.audioBase64 = audio.audioBase64;
          body.audioContentType = audio.contentType;
        } else {
          body.ttsError = "Volcengine TTS did not return audio";
        }
      } catch (ttsError) {
        body.ttsError =
          ttsError instanceof Error ? ttsError.message : String(ttsError);
      }

      await appendVoiceSecretaryDebugCapture(deps.dataDir, {
        type: "audio-call",
        route: "/calls/audio",
        voiceSessionId: result.voiceSession.id,
        projectPath: projectPathValue.trim(),
        conversationSessionId,
        conversationProvider,
        transcript: transcript.text,
        talkerText,
        finalBrief: result.finalBrief.spokenSummary,
        executorSummary: result.executorReport.summary,
        latestWorkerMessage: result.voiceSession.latestWorkerMessage,
        audioContentType: body.audioContentType,
        audioBase64Length: body.audioBase64?.length,
        ttsError: body.ttsError,
      });

      return c.json({ ...body, result });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Voice Secretary audio call failed";
      console.error("[VoiceSecretary] audio call failed:", error);
      return c.json({ error: message }, 500);
    }
  });

  routes.post("/calls/audio/stream", async (c) => {
    try {
      if (!deps.supervisor) {
        return c.json({ error: "AgentLine executor is unavailable" }, 503);
      }

      const formData = await c.req.formData().catch(() => null);
      if (!formData) {
        return c.json({ error: "Invalid multipart form body" }, 400);
      }

      const projectPathValue = formData.get("projectPath");
      if (typeof projectPathValue !== "string" || !projectPathValue.trim()) {
        return c.json({ error: "projectPath is required" }, 400);
      }

      const conversationSessionId = parseConversationSessionId(
        formData.get("conversationSessionId"),
      );
      if (conversationSessionId === null) {
        return c.json({ error: "conversationSessionId must be a string" }, 400);
      }
      const conversationProvider = parseConversationProvider(
        formData.get("conversationProvider"),
      );
      if (conversationProvider === null) {
        return c.json({ error: "conversationProvider must be a string" }, 400);
      }
      const voiceSessionId = parseVoiceSessionId(
        formData.get("voiceSessionId"),
      );
      if (voiceSessionId === null) {
        return c.json({ error: "voiceSessionId must be a string" }, 400);
      }

      const audioFile = formData.get("audio");
      if (!(audioFile instanceof File) || audioFile.size === 0) {
        return c.json({ error: "audio is required" }, 400);
      }

      const speech = createSpeechService(deps.serverSettingsService);
      if (!speech.enabled) {
        return c.json({ error: "Volcengine speech is not configured" }, 503);
      }

      const stream = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const push = (event: VoiceSecretaryAudioStreamEvent) => {
            controller.enqueue(encodeStreamEvent(event));
          };

          try {
            const transcript = await speech.transcribeAudio(
              new Uint8Array(await audioFile.arrayBuffer()),
            );
            if (!transcript) {
              push({
                type: "error",
                error: "Volcengine ASR did not return text",
              });
              controller.close();
              return;
            }
            push({
              type: "transcript_final",
              transcript: transcript.text,
              confidence: transcript.confidence,
            });

            const { loop } = createVoiceTurnLoop(voiceSessionId);
            const result = await loop.run({
              voiceSessionId,
              projectPath: projectPathValue.trim(),
              conversationSessionId,
              conversationProvider,
              utterance: transcript.text,
            });
            const talkerText = resolveTalkerText(result);
            for (const chunk of splitTalkerTextForStreaming(talkerText)) {
              push({ type: "talker_text", text: chunk });
            }
            push({ type: "result", result });

            let announcedAudio = false;
            for await (const chunk of speech.synthesizeTextStream(talkerText)) {
              if (!announcedAudio) {
                announcedAudio = true;
                push({
                  type: "audio_start",
                  contentType: chunk.contentType,
                });
              }
              push({
                type: "audio_chunk",
                audioBase64: chunk.audioBase64,
              });
            }

            await appendVoiceSecretaryDebugCapture(deps.dataDir, {
              type: "audio-call-stream",
              route: "/calls/audio/stream",
              voiceSessionId: result.voiceSession.id,
              projectPath: projectPathValue.trim(),
              conversationSessionId,
              conversationProvider,
              transcript: transcript.text,
              talkerText,
              finalBrief: result.finalBrief.spokenSummary,
              executorSummary: result.executorReport.summary,
              latestWorkerMessage: result.voiceSession.latestWorkerMessage,
            });

            push({ type: "done" });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Voice Secretary audio stream failed";
            console.error("[VoiceSecretary] audio stream failed:", error);
            push({ type: "error", error: message });
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Voice Secretary audio stream failed";
      console.error("[VoiceSecretary] audio stream setup failed:", error);
      return c.json({ error: message }, 500);
    }
  });

  routes.get("/calls/:voiceSessionId", async (c) => {
    const voiceSessionId = c.req.param("voiceSessionId");
    const status = runtimeManager.consumePendingHook(voiceSessionId);
    if (!status) {
      await appendVoiceSecretaryDebugCapture(deps.dataDir, {
        type: "hook-poll-miss",
        route: "/calls/:voiceSessionId",
        voiceSessionId,
      });
      return c.json({ error: "Voice session not found" }, 404);
    }
    await appendVoiceSecretaryDebugCapture(deps.dataDir, {
      type: "hook-poll",
      route: "/calls/:voiceSessionId",
      voiceSessionId,
      hook: status.hook,
      snapshot: status.snapshot,
    });
    return c.json(status);
  });

  routes.post("/simulate", async (c) => {
    const body = await c.req.json<SimulateBody>().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (typeof body.projectPath !== "string" || !body.projectPath.trim()) {
      return c.json({ error: "projectPath is required" }, 400);
    }
    if (typeof body.utterance !== "string" || !body.utterance.trim()) {
      return c.json({ error: "utterance is required" }, 400);
    }
    const conversationSessionId = parseConversationSessionId(
      body.conversationSessionId,
    );
    if (conversationSessionId === null) {
      return c.json({ error: "conversationSessionId must be a string" }, 400);
    }
    const conversationProvider = parseConversationProvider(
      body.conversationProvider,
    );
    if (conversationProvider === null) {
      return c.json({ error: "conversationProvider must be a string" }, 400);
    }
    const voiceSessionId = parseVoiceSessionId(body.voiceSessionId);
    if (voiceSessionId === null) {
      return c.json({ error: "voiceSessionId must be a string" }, 400);
    }

    const executorMode =
      body.executorMode === undefined || body.executorMode === "fake"
        ? "fake"
        : body.executorMode === "agentline"
          ? "agentline"
          : null;
    if (!executorMode) {
      return c.json({ error: "executorMode must be fake or agentline" }, 400);
    }
    if (executorMode === "agentline" && !deps.supervisor) {
      return c.json({ error: "AgentLine executor is unavailable" }, 503);
    }

    const executor =
      executorMode === "agentline" && deps.supervisor
        ? new AgentLineExecutorAgentAdapter({
            supervisor: deps.supervisor,
            sessionMetadataService: deps.sessionMetadataService,
          })
        : undefined;
    const codexTalker = new CodexEphemeralTalker({
      getRuntimeConfig: () => getPhoneTalkerConfig(deps.serverSettingsService),
    });
    const llm = createTalkerLlm(deps.serverSettingsService);
    const talker = new VoiceSecretaryTalker(codexTalker, llm);
    const planner = new ProjectPlanner(deps.providerCatalog, codexTalker, llm);
    const loop = new SimulatedCallLoop(talker, planner, executor, {
      knowledgeStore,
      runtimeManager,
    });
    const result = await loop.run({
      voiceSessionId,
      projectPath: body.projectPath,
      conversationSessionId,
      conversationProvider,
      utterance: body.utterance,
    });

    return c.json({ result });
  });

  return routes;
}
