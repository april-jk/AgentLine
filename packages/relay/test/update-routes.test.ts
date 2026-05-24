import type { UpdateManifest } from "@agentline/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  isValidReleaseVersion,
  registerRelayVersionRoutes,
} from "../src/update-routes.js";

const manifest: UpdateManifest = {
  version: "1.0.2",
  releaseUrl: "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
  downloads: [
    {
      platform: "android",
      kind: "apk",
      name: "AgentLine-Mobile-RN-1.0.2-android.apk",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine-Mobile-RN-1.0.2-android.apk",
    },
  ],
};

function createApp(updateManifest: UpdateManifest | null = manifest) {
  const app = new Hono();
  const fetchLatestReleaseManifest = vi.fn(async () => updateManifest);

  registerRelayVersionRoutes(app, {
    appVersion: "1.0.2",
    bridgeVersion: "1.0.2",
    fetchLatestReleaseManifest,
  });

  return { app, fetchLatestReleaseManifest };
}

describe("relay version routes", () => {
  it("serves the latest release manifest at /version", async () => {
    const { app } = createApp();
    const response = await app.request("/version");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("1.0.2");
    expect(body.releaseUrl).toBe(
      "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
    );
  });

  it("serves the latest release manifest at /version/", async () => {
    const { app } = createApp();
    const response = await app.request("/version/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("1.0.2");
  });

  it("returns an update manifest for an older semver client", async () => {
    const { app } = createApp();
    const response = await app.request("/version/1.0.1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("1.0.2");
  });

  it("returns 204 for the latest semver client", async () => {
    const { app } = createApp();
    const response = await app.request("/version/1.0.2");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("rejects arbitrary currentVersion values instead of treating them as stale", async () => {
    const { app, fetchLatestReleaseManifest } = createApp();
    const response = await app.request("/version/xxxx");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_current_version");
    expect(fetchLatestReleaseManifest).not.toHaveBeenCalled();
  });

  it("accepts v-prefixed semantic versions", async () => {
    const { app } = createApp();
    const response = await app.request("/version/v1.0.1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("1.0.2");
  });

  it("accepts semantic versions with a trailing slash", async () => {
    const { app } = createApp();
    const response = await app.request("/version/1.0.1/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe("1.0.2");
  });
});

describe("isValidReleaseVersion", () => {
  it("accepts semver release values only", () => {
    expect(isValidReleaseVersion("1.0.2")).toBe(true);
    expect(isValidReleaseVersion("v1.0.2")).toBe(true);
    expect(isValidReleaseVersion("1.0.2-beta.1")).toBe(true);
    expect(isValidReleaseVersion("xxxx")).toBe(false);
    expect(isValidReleaseVersion("1")).toBe(false);
    expect(isValidReleaseVersion("1.0")).toBe(false);
  });
});
