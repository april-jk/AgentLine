import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ServerManager } from "../../desktop-electron/src/electron/serverManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../../..");

async function getFreePort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate a free port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
    server.on("error", reject);
  });
}

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForDashboardReady(
  baseUrl: string,
  desktopToken: string,
): Promise<void> {
  await waitFor(
    async () => {
      try {
        const response = await fetch(
          withDesktopToken(baseUrl, "/", desktopToken),
        );
        if (!response.ok) {
          return false;
        }
        const body = await response.text();
        return !body.includes("Vite dev server not available");
      } catch {
        return false;
      }
    },
    60_000,
    `dashboard at ${baseUrl}`,
  );
}

async function fetchJson<T>(
  baseUrl: string,
  path: string,
  desktopToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-AgentLine-Request": "true",
      "X-Desktop-Token": desktopToken,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(
      `Request failed for ${path}: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

function withDesktopToken(
  baseUrl: string,
  path: string,
  token: string,
): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set("desktop_token", token);
  return url.toString();
}

test.describe.configure({ mode: "serial" });

test("desktop app codex flow survives create, restart, resume, and attachment paths", async ({
  page,
}) => {
  test.slow();
  test.setTimeout(180_000);

  const tempRoot = mkdtempSync(join(tmpdir(), "agentline-desktop-e2e-"));
  const dataDir = join(tempRoot, "data");
  const projectDir = join(tempRoot, "project");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "readme.txt"),
    "desktop regression fixture\n",
    "utf-8",
  );

  const port = await getFreePort();
  const manager = new ServerManager({
    repoRoot,
    dataDir,
    packaged: false,
    port,
  });

  const dashboardBaseUrl = `http://127.0.0.1:${port}`;
  const desktopToken = manager.getDesktopAuthToken();
  const sessionApiPattern = /\/api\/projects\/[^/]+\/sessions$/;
  const createApiPattern = /\/api\/projects\/[^/]+\/sessions\/create$/;
  const resumeApiPattern = /\/api\/projects\/[^/]+\/sessions\/[^/]+\/resume$/;
  const queueApiPattern = /\/api\/sessions\/[^/]+\/messages$/;
  const unexpectedServerErrors: string[] = [];

  page.on("response", async (response) => {
    if (
      response.url().startsWith(dashboardBaseUrl) &&
      response.status() >= 500
    ) {
      unexpectedServerErrors.push(
        `${response.status()} ${response.request().method()} ${response.url()}`,
      );
    }
  });

  try {
    await manager.start();
    await waitForDashboardReady(dashboardBaseUrl, desktopToken);

    const authStatus = await fetchJson<{
      authenticated: boolean;
      hasDesktopToken: boolean;
    }>(dashboardBaseUrl, "/api/auth/status", desktopToken);
    expect(authStatus.authenticated).toBe(true);
    expect(authStatus.hasDesktopToken).toBe(true);

    await fetchJson<{ success: boolean }>(
      dashboardBaseUrl,
      "/api/onboarding/complete",
      desktopToken,
      { method: "POST", body: JSON.stringify({}) },
    );

    const addProjectResult = await fetchJson<{
      project: { id: string };
    }>(dashboardBaseUrl, "/api/projects", desktopToken, {
      method: "POST",
      body: JSON.stringify({ path: projectDir }),
    });
    const projectId = addProjectResult.project.id;

    await page.goto(
      withDesktopToken(
        dashboardBaseUrl,
        `/new-session?projectId=${encodeURIComponent(projectId)}`,
        desktopToken,
      ),
    );
    await expect(page.getByText("Start a New Session")).toBeVisible();

    const codexProvider = page
      .locator(".provider-option")
      .filter({ hasText: /^Codex$/ });
    if ((await codexProvider.count()) > 0) {
      await codexProvider.first().click();
    }

    const newSessionTextarea = page.locator(".new-session-form-textarea");
    await newSessionTextarea.fill("desktop create smoke");

    const startResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        sessionApiPattern.test(new URL(response.url()).pathname),
      { timeout: 60_000 },
    );

    await page.locator(".new-session-form .send-button").click();

    const startResponse = await startResponsePromise;
    expect(startResponse.ok()).toBe(true);
    const startPayload = (await startResponse.json()) as { sessionId: string };
    const createdSessionId = startPayload.sessionId;

    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectId}/sessions/${createdSessionId}$`),
      { timeout: 30_000 },
    );

    await waitFor(
      async () => {
        const metadata = await fetchJson<{
          ownership: { owner: "self" | "none" | "external" };
        }>(
          dashboardBaseUrl,
          `/api/projects/${projectId}/sessions/${createdSessionId}/metadata`,
          desktopToken,
        );
        return metadata.ownership.owner === "self";
      },
      30_000,
      "new codex session ownership",
    );

    await manager.restart();
    await waitForDashboardReady(dashboardBaseUrl, desktopToken);

    await page.goto(
      withDesktopToken(
        dashboardBaseUrl,
        `/projects/${projectId}/sessions/${createdSessionId}`,
        desktopToken,
      ),
    );

    const resumeTextarea = page
      .locator(".message-input-wrapper textarea")
      .first();
    await expect(resumeTextarea).toBeVisible({ timeout: 30_000 });
    await resumeTextarea.fill("desktop resume smoke");

    const resumeResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        resumeApiPattern.test(new URL(response.url()).pathname),
      { timeout: 60_000 },
    );

    await page.locator(".message-input-wrapper .send-button").click();

    const resumeResponse = await resumeResponsePromise;
    expect(resumeResponse.ok()).toBe(true);

    await waitFor(
      async () => {
        const metadata = await fetchJson<{
          ownership: { owner: "self" | "none" | "external" };
        }>(
          dashboardBaseUrl,
          `/api/projects/${projectId}/sessions/${createdSessionId}/metadata`,
          desktopToken,
        );
        return metadata.ownership.owner === "self";
      },
      30_000,
      "resumed codex session ownership",
    );

    await page.goto(
      withDesktopToken(
        dashboardBaseUrl,
        `/new-session?projectId=${encodeURIComponent(projectId)}`,
        desktopToken,
      ),
    );
    await expect(page.getByText("Start a New Session")).toBeVisible();

    const secondCodexProvider = page
      .locator(".provider-option")
      .filter({ hasText: /^Codex$/ });
    if ((await secondCodexProvider.count()) > 0) {
      await secondCodexProvider.first().click();
    }

    const attachmentTextarea = page.locator(".new-session-form-textarea");
    await attachmentTextarea.fill("desktop attachment smoke");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach files" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("desktop attachment fixture\n", "utf-8"),
    });

    await expect(page.getByText("note.txt")).toBeVisible({ timeout: 15_000 });

    const createResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        createApiPattern.test(new URL(response.url()).pathname),
      { timeout: 60_000 },
    );
    const queueResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        queueApiPattern.test(new URL(response.url()).pathname),
      { timeout: 60_000 },
    );

    await page.locator(".new-session-form .send-button").click();

    const createResponse = await createResponsePromise;
    const queueResponse = await queueResponsePromise;
    expect(createResponse.ok()).toBe(true);
    expect(queueResponse.ok()).toBe(true);

    const createPayload = (await createResponse.json()) as {
      sessionId: string;
    };

    await expect(page).toHaveURL(
      new RegExp(`/projects/${projectId}/sessions/${createPayload.sessionId}$`),
      { timeout: 30_000 },
    );

    await waitFor(
      async () => {
        const metadata = await fetchJson<{
          ownership: { owner: "self" | "none" | "external" };
        }>(
          dashboardBaseUrl,
          `/api/projects/${projectId}/sessions/${createPayload.sessionId}/metadata`,
          desktopToken,
        );
        return metadata.ownership.owner === "self";
      },
      30_000,
      "attachment session ownership",
    );

    expect(unexpectedServerErrors).toEqual([]);
  } finally {
    await manager.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
