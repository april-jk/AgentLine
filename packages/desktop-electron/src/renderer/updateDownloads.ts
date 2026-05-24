import {
  type ReleaseDownload,
  type UpdateManifest,
  selectBestUpdateDownload,
} from "@agentline/shared";

export function selectDesktopDownload(
  update: UpdateManifest,
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): ReleaseDownload | null {
  return selectBestUpdateDownload(update, { platform });
}
