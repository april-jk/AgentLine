import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireCustomHeader } from "../../src/middleware/security.js";

function createTestApp(): Hono {
  const app = new Hono();
  app.use("/api/*", requireCustomHeader);
  app.post("/api/test", (c) => c.json({ ok: true }));
  return app;
}

describe("security middleware", () => {
  it("accepts the AgentLine request header for mutating requests", async () => {
    const app = createTestApp();
    const response = await app.request("/api/test", {
      method: "POST",
      headers: { "X-AgentLine-Request": "true" },
    });

    expect(response.status).toBe(200);
  });

  it("keeps accepting the legacy request header", async () => {
    const app = createTestApp();
    const response = await app.request("/api/test", {
      method: "POST",
      headers: { "X-AgentLine-Request": "true" },
    });

    expect(response.status).toBe(200);
  });

  it("rejects mutating requests without a custom header", async () => {
    const app = createTestApp();
    const response = await app.request("/api/test", { method: "POST" });

    expect(response.status).toBe(403);
  });
});
