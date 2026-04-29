import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import type { ProviderName } from "../sdk/providers/types.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import { CodexEphemeralTalker } from "../voice-secretary/codex-ephemeral.js";
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
  audioBase64: string;
  audioContentType: string;
}

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

    const executor = new AgentLineExecutorAgentAdapter({
      supervisor: deps.supervisor,
      sessionMetadataService: deps.sessionMetadataService,
      onSessionCreated: (session) => bindVoiceWorker(voiceSessionId, session),
    });
    const codexTalker = new CodexEphemeralTalker({
      getRuntimeConfig: () => getPhoneTalkerConfig(deps.serverSettingsService),
    });
    const llm = createTalkerLlm(deps.serverSettingsService);
    const talker = new VoiceSecretaryTalker(codexTalker, llm);
    const planner = new ProjectPlanner(deps.providerCatalog, codexTalker, llm);
    const loop = new VoiceSecretaryCallLoop(executor, {
      providerCatalog: deps.providerCatalog,
      talker,
      planner,
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

      const executor = new AgentLineExecutorAgentAdapter({
        supervisor: deps.supervisor,
        sessionMetadataService: deps.sessionMetadataService,
        onSessionCreated: (session) => bindVoiceWorker(voiceSessionId, session),
      });
      const codexTalker = new CodexEphemeralTalker({
        getRuntimeConfig: () =>
          getPhoneTalkerConfig(deps.serverSettingsService),
      });
      const llm = createTalkerLlm(deps.serverSettingsService);
      const talker = new VoiceSecretaryTalker(codexTalker, llm);
      const planner = new ProjectPlanner(
        deps.providerCatalog,
        codexTalker,
        llm,
      );
      const loop = new VoiceSecretaryCallLoop(executor, {
        providerCatalog: deps.providerCatalog,
        talker,
        planner,
        knowledgeStore,
        runtimeManager,
      });

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

      const talkerText =
        result.finalBrief.spokenSummary.trim() ||
        result.callSession.transcript
          .filter((turn) => turn.speaker === "talker")
          .map((turn) => turn.text.trim())
          .find((text) => text.length > 0) ||
        "我已经准备好了下一步的正式执行建议。";
      const audio = await speech.synthesizeText(talkerText);
      if (!audio) {
        return c.json({ error: "Volcengine TTS did not return audio" }, 502);
      }

      const body: AudioTurnResponseBody = {
        transcript: transcript.text,
        confidence: transcript.confidence,
        talkerText,
        audioBase64: audio.audioBase64,
        audioContentType: audio.contentType,
      };

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

  routes.get("/calls/:voiceSessionId", async (c) => {
    const voiceSessionId = c.req.param("voiceSessionId");
    const status = runtimeManager.consumePendingHook(voiceSessionId);
    if (!status) {
      return c.json({ error: "Voice session not found" }, 404);
    }
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
