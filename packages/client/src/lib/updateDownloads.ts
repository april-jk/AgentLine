import {
  type ClientUpdatePlatform,
  type ReleaseDownload,
  type UpdateManifest,
  selectBestUpdateDownload,
} from "@agentline/shared";

export function selectBestDownload(
  update: UpdateManifest | null | undefined,
  userAgent?: string,
  targetPlatform?: ClientUpdatePlatform,
): ReleaseDownload | null {
  return selectBestUpdateDownload(update, {
    targetPlatform,
    userAgent:
      userAgent ??
      (typeof navigator !== "undefined" ? navigator.userAgent : undefined),
  });
}
