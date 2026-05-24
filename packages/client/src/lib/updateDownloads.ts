import {
  type ReleaseDownload,
  type UpdateManifest,
  selectBestUpdateDownload,
} from "@agentline/shared";

export function selectBestDownload(
  update: UpdateManifest | null | undefined,
  userAgent?: string,
): ReleaseDownload | null {
  return selectBestUpdateDownload(update, {
    userAgent:
      userAgent ??
      (typeof navigator !== "undefined" ? navigator.userAgent : undefined),
  });
}
