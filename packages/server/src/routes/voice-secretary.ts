import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import {
  AgentLineExecutorAgentAdapter,
  SimulatedCallLoop,
  VoiceSecretaryCallLoop,
} from "../voice-secretary/index.js";

export interface VoiceSecretaryRoutesDeps {
  supervisor?: Supervisor;
  sessionMetadataService?: SessionMetadataService;
}

interface SimulateBody {
  projectPath?: unknown;
  conversationSessionId?: unknown;
  utterance?: unknown;
  executorMode?: unknown;
}

interface CallBody {
  projectPath?: unknown;
  conversationSessionId?: unknown;
  utterance?: unknown;
}

function parseConversationSessionId(
  value: unknown,
): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim();
}

export function createVoiceSecretaryRoutes(
  deps: VoiceSecretaryRoutesDeps = {},
): Hono {
  const routes = new Hono();

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
    if (!deps.supervisor) {
      return c.json({ error: "AgentLine executor is unavailable" }, 503);
    }

    const executor = new AgentLineExecutorAgentAdapter({
      supervisor: deps.supervisor,
      sessionMetadataService: deps.sessionMetadataService,
    });
    const loop = new VoiceSecretaryCallLoop(executor);
    const result = await loop.run({
      projectPath: body.projectPath,
      conversationSessionId,
      utterance: body.utterance,
    });

    return c.json({ result });
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
    const loop = new SimulatedCallLoop(undefined, undefined, executor);
    const result = await loop.run({
      projectPath: body.projectPath,
      conversationSessionId,
      utterance: body.utterance,
    });

    return c.json({ result });
  });

  return routes;
}
