import type { ReleaseDownload, UpdateManifest } from "@agentline/shared";

type ClientPlatform = "android" | "ios" | "macos" | "windows" | "linux";

function detectClientPlatform(userAgent?: string): ClientPlatform {
  const source =
    userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const normalized = source.toLowerCase();
  if (normalized.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(normalized)) return "ios";
  if (normalized.includes("mac os x") || normalized.includes("macintosh")) {
    return "macos";
  }
  if (normalized.includes("windows")) return "windows";
  return "linux";
}

function scoreDownload(
  download: ReleaseDownload,
  platform: ClientPlatform,
): number {
  let score = 0;
  if (download.platform === platform) score += 100;
  if (platform === "macos" && download.kind === "dmg") score += 20;
  if (platform === "windows" && download.kind === "installer") score += 20;
  if (platform === "linux" && download.kind === "appimage") score += 20;
  if (platform === "android" && download.kind === "apk") score += 30;
  if (download.kind === "aab" || download.kind === "xcarchive") score -= 20;
  if (download.platform === "desktop") score += 10;
  return score;
}

export function selectBestDownload(
  update: UpdateManifest | null | undefined,
  userAgent?: string,
): ReleaseDownload | null {
  if (!update?.downloads.length) return null;
  const platform = detectClientPlatform(userAgent);
  const eligible = update.downloads.filter(
    (download) => download.platform !== "bridge" && download.kind !== "aab",
  );
  if (eligible.length === 0) return null;

  return eligible
    .map((download) => ({
      download,
      score: scoreDownload(download, platform),
    }))
    .sort((left, right) => right.score - left.score)[0]?.download ?? null;
}
