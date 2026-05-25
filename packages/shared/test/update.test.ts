import { describe, expect, it } from "vitest";
import { fetchAgentLineUpdate } from "../src/update-check.js";
import {
  type UpdateManifest,
  detectUpdatePlatform,
  selectBestUpdateDownload,
} from "../src/update.js";

const update: UpdateManifest = {
  version: "1.0.2",
  releaseUrl: "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
  downloads: [
    {
      platform: "bridge",
      kind: "android-device-server-apk",
      name: "agentline-device-server.apk",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/agentline-device-server.apk",
    },
    {
      platform: "android",
      kind: "aab",
      name: "AgentLine-Mobile-RN-1.0.2-android.aab",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine-Mobile-RN-1.0.2-android.aab",
    },
    {
      platform: "android",
      kind: "apk",
      name: "AgentLine-Mobile-RN-1.0.2-android.apk",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine-Mobile-RN-1.0.2-android.apk",
    },
    {
      platform: "macos",
      kind: "zip",
      name: "AgentLine.Desktop-1.0.2-arm64-mac.zip",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine.Desktop-1.0.2-arm64-mac.zip",
    },
    {
      platform: "macos",
      kind: "dmg",
      name: "AgentLine.Desktop-1.0.2-arm64.dmg",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine.Desktop-1.0.2-arm64.dmg",
    },
    {
      platform: "windows",
      kind: "installer",
      name: "AgentLine.Desktop.Setup.1.0.2.exe",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine.Desktop.Setup.1.0.2.exe",
    },
    {
      platform: "linux",
      kind: "deb",
      name: "agentline-desktop-1.0.2-amd64.deb",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/agentline-desktop-1.0.2-amd64.deb",
    },
    {
      platform: "linux",
      kind: "appimage",
      name: "agentline-desktop-1.0.2-x86_64.AppImage",
      url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/agentline-desktop-1.0.2-x86_64.AppImage",
    },
  ],
};

describe("detectUpdatePlatform", () => {
  it("detects mobile and desktop platforms from user agent or platform", () => {
    expect(detectUpdatePlatform("Mozilla/5.0 (Linux; Android 14)")).toBe(
      "android",
    );
    expect(detectUpdatePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS)")).toBe(
      "ios",
    );
    expect(detectUpdatePlatform(undefined, "MacIntel")).toBe("macos");
    expect(detectUpdatePlatform(undefined, "Win32")).toBe("windows");
    expect(detectUpdatePlatform(undefined, "Linux x86_64")).toBe("linux");
  });
});

describe("selectBestUpdateDownload", () => {
  it("selects Android APK instead of Play Store AAB or bridge APK", () => {
    const download = selectBestUpdateDownload(update, {
      targetPlatform: "android",
    });

    expect(download?.kind).toBe("apk");
    expect(download?.name).toBe("AgentLine-Mobile-RN-1.0.2-android.apk");
  });

  it("selects the expected desktop installer for each platform", () => {
    expect(
      selectBestUpdateDownload(update, { targetPlatform: "macos" })?.kind,
    ).toBe("dmg");
    expect(
      selectBestUpdateDownload(update, { targetPlatform: "windows" })?.name,
    ).toBe("AgentLine.Desktop.Setup.1.0.2.exe");
    expect(
      selectBestUpdateDownload(update, { targetPlatform: "linux" })?.kind,
    ).toBe("appimage");
  });

  it("ignores bridge-only assets for downloaded clients", () => {
    const bridgeOnly: UpdateManifest = {
      ...update,
      downloads: update.downloads.filter(
        (download) => download.platform === "bridge",
      ),
    };

    expect(
      selectBestUpdateDownload(bridgeOnly, { targetPlatform: "android" }),
    ).toBeNull();
  });

  it("does not fall through to another native platform", () => {
    const androidOnly: UpdateManifest = {
      ...update,
      downloads: update.downloads.filter(
        (download) => download.platform === "android",
      ),
    };

    expect(
      selectBestUpdateDownload(androidOnly, { targetPlatform: "ios" }),
    ).toBeNull();
  });

  it("can include store packages when explicitly requested", () => {
    const storeOnly: UpdateManifest = {
      ...update,
      downloads: update.downloads.filter((download) => download.kind === "aab"),
    };

    expect(
      selectBestUpdateDownload(storeOnly, {
        targetPlatform: "android",
        includeStorePackages: true,
      })?.kind,
    ).toBe("aab");
  });
});

describe("fetchAgentLineUpdate", () => {
  it("returns current when the update server responds with 204", async () => {
    const result = await fetchAgentLineUpdate(
      "1.0.2",
      "AgentLine-Test/1.0.2",
      async () => new Response(null, { status: 204 }),
    );

    expect(result).toEqual({ status: "current" });
  });

  it("returns an update manifest when a new version is available", async () => {
    const result = await fetchAgentLineUpdate(
      "1.0.1",
      "AgentLine-Test/1.0.1",
      async () => Response.json(update),
    );

    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.update.version).toBe("1.0.2");
    }
  });

  it("rejects malformed update manifests", async () => {
    await expect(
      fetchAgentLineUpdate("1.0.1", "AgentLine-Test/1.0.1", async () =>
        Response.json({ version: "1.0.2", downloads: [] }),
      ),
    ).rejects.toThrow("Update manifest is missing required fields");
  });
});
