import type { UpdateManifest } from "@agentline/shared";
import { describe, expect, it } from "vitest";
import { selectDesktopDownload } from "../../../../desktop-electron/src/renderer/updateDownloads";

const update: UpdateManifest = {
  version: "1.0.2",
  releaseUrl: "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
  downloads: [
    {
      platform: "macos",
      kind: "zip",
      name: "AgentLine.Desktop-1.0.2-arm64-mac.zip",
      url: "https://example.invalid/app.zip",
    },
    {
      platform: "macos",
      kind: "dmg",
      name: "AgentLine.Desktop-1.0.2-arm64.dmg",
      url: "https://example.invalid/app.dmg",
    },
    {
      platform: "windows",
      kind: "installer",
      name: "AgentLine.Desktop.Setup.1.0.2.exe",
      url: "https://example.invalid/app.exe",
    },
    {
      platform: "linux",
      kind: "appimage",
      name: "agentline-desktop-1.0.2-x86_64.AppImage",
      url: "https://example.invalid/app.AppImage",
    },
  ],
};

describe("selectDesktopDownload", () => {
  it("selects the native desktop asset for each desktop platform", () => {
    expect(selectDesktopDownload(update, "MacIntel")?.name).toBe(
      "AgentLine.Desktop-1.0.2-arm64.dmg",
    );
    expect(selectDesktopDownload(update, "Win32")?.name).toBe(
      "AgentLine.Desktop.Setup.1.0.2.exe",
    );
    expect(selectDesktopDownload(update, "Linux x86_64")?.name).toBe(
      "agentline-desktop-1.0.2-x86_64.AppImage",
    );
  });
});
