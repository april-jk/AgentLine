import { Hono } from "hono";
import { SimulatedCallLoop } from "../voice-secretary/index.js";

interface SimulateBody {
  projectPath?: unknown;
  utterance?: unknown;
}

export function createVoiceSecretaryRoutes(): Hono {
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

    const loop = new SimulatedCallLoop();
    const result = await loop.run({
      projectPath: body.projectPath,
      utterance: body.utterance,
    });

    return c.json({ result });
  });

  return routes;
}
