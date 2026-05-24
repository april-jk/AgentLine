import { describe, expect, it } from "vitest";
import { selectBestDownload } from "../updateDownloads";

describe("selectBestDownload", () => {
  it("selects the Android APK for mobile browsers", () => {
    const download = selectBestDownload(
      {
        version: "1.0.2",
        releaseUrl: "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
        downloads: [
          {
            platform: "android",
            kind: "aab",
            name: "AgentLine-Mobile-RN-1.0.2-android.aab",
            url: "https://example.invalid/app.aab",
          },
          {
            platform: "android",
            kind: "apk",
            name: "AgentLine-Mobile-RN-1.0.2-android.apk",
            url: "https://example.invalid/app.apk",
          },
        ],
      },
      "Mozilla/5.0 (Linux; Android 14)",
    );

    expect(download?.name).toBe("AgentLine-Mobile-RN-1.0.2-android.apk");
  });
});
