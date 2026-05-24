import {
  type ReleaseDownload,
  type UpdateManifest,
  selectBestUpdateDownload,
} from "@agentline/shared";

export type NativeUpdatePlatform = "android" | "ios";

export function selectNativeUpdateDownload(
  update: UpdateManifest | null | undefined,
  platform: NativeUpdatePlatform,
): ReleaseDownload | null {
  return selectBestUpdateDownload(update, { targetPlatform: platform });
}

export function getNativeUpdateUrl(
  update: UpdateManifest | null | undefined,
  platform: NativeUpdatePlatform,
): string | null {
  if (!update) return null;
  return selectNativeUpdateDownload(update, platform)?.url ?? update.releaseUrl;
}
