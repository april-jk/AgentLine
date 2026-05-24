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
