import {
  type UpdateManifest,
  isNewerSemver,
  normalizeReleaseVersion,
} from "@agentline/shared";
import type { Context, Hono } from "hono";

interface FetchLatestReleaseManifestOptions {
  forceRefresh?: boolean;
}

export type FetchLatestReleaseManifest = (
  options?: FetchLatestReleaseManifestOptions,
) => Promise<UpdateManifest | null>;

export interface RelayVersionRouteOptions {
  appVersion: string;
  bridgeVersion: string;
  fetchLatestReleaseManifest: FetchLatestReleaseManifest;
}

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isValidReleaseVersion(value: string): boolean {
  return RELEASE_VERSION_PATTERN.test(normalizeReleaseVersion(value));
}

function fallbackManifest(version: string): UpdateManifest {
  return {
    version,
    releaseUrl: `https://github.com/april-jk/AgentLine/releases/tag/v${version}`,
    downloads: [],
  };
}

function jsonNoCache(c: Context, body: unknown) {
  return c.json(body, 200, {
    "Cache-Control": "no-cache",
  });
}

function invalidVersion(c: Context) {
  return c.json(
    {
      error: "invalid_current_version",
      message: "currentVersion must be a semantic version such as 1.0.2.",
    },
    400,
    {
      "Cache-Control": "no-store",
    },
  );
}

export function registerRelayVersionRoutes(
  app: Hono,
  {
    appVersion,
    bridgeVersion,
    fetchLatestReleaseManifest,
  }: RelayVersionRouteOptions,
): void {
  const getLatestManifest = async (c: Context) => {
    const manifest = await fetchLatestReleaseManifest({
      forceRefresh: c.req.query("fresh") === "1",
    });
    return jsonNoCache(c, manifest ?? fallbackManifest(appVersion));
  };

  app.get("/version", getLatestManifest);
  app.get("/version/", getLatestManifest);

  const getUpdateForCurrentVersion = async (c: Context) => {
    const currentVersion = normalizeReleaseVersion(
      c.req.param("currentVersion") ?? "",
    );
    if (!isValidReleaseVersion(currentVersion)) {
      return invalidVersion(c);
    }

    const manifest = await fetchLatestReleaseManifest({
      forceRefresh: c.req.query("fresh") === "1",
    });
    const latestVersion = manifest?.version ?? appVersion;

    if (
      !isValidReleaseVersion(latestVersion) ||
      !isNewerSemver(currentVersion, latestVersion)
    ) {
      return c.body(null, 204);
    }

    return jsonNoCache(c, manifest ?? fallbackManifest(latestVersion));
  };

  app.get("/version/:currentVersion", getUpdateForCurrentVersion);
  app.get("/version/:currentVersion/", getUpdateForCurrentVersion);

  app.get("/bridge/version", async (c) => {
    const manifest = await fetchLatestReleaseManifest({
      forceRefresh: c.req.query("fresh") === "1",
    });
    const latestBridgeVersion = manifest?.downloads.some(
      (download) => download.platform === "bridge",
    )
      ? manifest.version
      : bridgeVersion;

    return jsonNoCache(c, {
      version: latestBridgeVersion,
    });
  });
}
