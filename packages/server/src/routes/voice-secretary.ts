import { Hono } from "hono";
import type { SessionMetadataService } from "../metadata/index.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import {
  AgentLineExecutorAgentAdapter,
  SimulatedCallLoop,
} from "../voice-secretary/index.js";

export interface VoiceSecretaryRoutesDeps {
  supervisor?: Supervisor;
  sessionMetadataService?: SessionMetadataService;
}

interface SimulateBody {
  projectPath?: unknown;
  utterance?: unknown;
  executorMode?: unknown;
}

export function createVoiceSecretaryRoutes(
  deps: VoiceSecretaryRoutesDeps = {},
): Hono {
  const routes = new Hono();

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
      utterance: body.utterance,
    });

    return c.json({ result });
  });

  return routes;
}
