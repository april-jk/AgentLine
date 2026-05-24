export type ReleaseAssetPlatform =
  | "android"
  | "ios"
  | "macos"
  | "windows"
  | "linux"
  | "desktop"
  | "server"
  | "bridge"
  | "unknown";

export interface ReleaseDownload {
  platform: ReleaseAssetPlatform;
  kind: string;
  name: string;
  url: string;
  size?: number;
  digest?: string;
}

export interface UpdateManifest {
  version: string;
  releaseUrl: string;
  publishedAt?: string;
  notes?: string;
  downloads: ReleaseDownload[];
}

export type ClientUpdatePlatform =
  | "android"
  | "ios"
  | "macos"
  | "windows"
  | "linux";

export function normalizeReleaseVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

export function compareSemver(a: string, b: string): number {
  const parseVersion = (value: string) => {
    const match = normalizeReleaseVersion(value).match(
      /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/,
    );
    if (!match || !match[1] || !match[2] || !match[3]) return null;
    return [
      Number.parseInt(match[1], 10),
      Number.parseInt(match[2], 10),
      Number.parseInt(match[3], 10),
    ] as const;
  };

  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;

  for (const index of [0, 1, 2] as const) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }

  return 0;
}

export function isNewerSemver(current: string, latest: string): boolean {
  if (current === "unknown" || !latest) return false;
  return compareSemver(latest, current) > 0;
}

export function detectUpdatePlatform(
  userAgent?: string,
  platform?: string,
): ClientUpdatePlatform {
  const normalizedUserAgent = (userAgent ?? "").toLowerCase();
  const normalizedPlatform = (platform ?? "").toLowerCase();
  const source = `${normalizedUserAgent} ${normalizedPlatform}`;

  if (source.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(source)) return "ios";
  if (source.includes("mac os x") || source.includes("macintosh")) {
    return "macos";
  }
  if (source.includes("mac")) return "macos";
  if (source.includes("win")) return "windows";
  return "linux";
}

function scoreDownload(
  download: ReleaseDownload,
  platform: ClientUpdatePlatform,
): number {
  let score = 0;
  if (download.platform === platform) score += 100;
  if (platform === "macos" && download.kind === "dmg") score += 30;
  if (platform === "windows" && download.kind === "installer") score += 30;
  if (platform === "linux" && download.kind === "appimage") score += 30;
  if (platform === "android" && download.kind === "apk") score += 40;
  if (download.platform === "desktop") score += 10;
  if (download.kind === "aab" || download.kind === "xcarchive") score -= 50;
  return score;
}

function isDesktopUpdatePlatform(platform: ClientUpdatePlatform): boolean {
  return platform === "macos" || platform === "windows" || platform === "linux";
}

export function selectBestUpdateDownload(
  update: UpdateManifest | null | undefined,
  options?: {
    userAgent?: string;
    platform?: string;
    targetPlatform?: ClientUpdatePlatform;
    includeStorePackages?: boolean;
  },
): ReleaseDownload | null {
  if (!update?.downloads.length) return null;

  const platform =
    options?.targetPlatform ??
    detectUpdatePlatform(options?.userAgent, options?.platform);
  const includeStorePackages = options?.includeStorePackages ?? false;
  const eligible = update.downloads.filter((download) => {
    if (download.platform === "bridge") return false;
    if (!includeStorePackages && download.kind === "aab") return false;
    if (!includeStorePackages && download.kind === "xcarchive") return false;
    if (download.platform === platform) return true;
    if (download.platform === "desktop" && isDesktopUpdatePlatform(platform)) {
      return true;
    }
    return false;
  });
  if (eligible.length === 0) return null;

  return (
    eligible
      .map((download, index) => ({
        download,
        index,
        score: scoreDownload(download, platform),
      }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return left.index - right.index;
      })[0]?.download ?? null
  );
}
