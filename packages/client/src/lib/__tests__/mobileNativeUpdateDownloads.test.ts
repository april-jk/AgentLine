import { describe, expect, it } from "vitest";
import { getNativeUpdateUrl } from "../../../../mobile-rn/src/lib/updateDownloads";

describe("getNativeUpdateUrl", () => {
  it("opens the Android APK instead of the AAB or bridge APK", () => {
    expect(
      getNativeUpdateUrl(
        {
          version: "1.0.2",
          releaseUrl:
            "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
          downloads: [
            {
              platform: "bridge",
              kind: "android-device-server-apk",
              name: "agentline-device-server.apk",
              url: "https://example.invalid/device-server.apk",
            },
            {
              platform: "android",
              kind: "aab",
              name: "AgentLine-Mobile-RN-1.0.2-android.aab",
              url: "https://example.invalid/mobile.aab",
            },
            {
              platform: "android",
              kind: "apk",
              name: "AgentLine-Mobile-RN-1.0.2-android.apk",
              url: "https://example.invalid/mobile.apk",
            },
          ],
        },
        "android",
      ),
    ).toBe("https://example.invalid/mobile.apk");
  });

  it("does not send iOS clients to the Android APK", () => {
    expect(
      getNativeUpdateUrl(
        {
          version: "1.0.2",
          releaseUrl:
            "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
          downloads: [
            {
              platform: "android",
              kind: "apk",
              name: "AgentLine-Mobile-RN-1.0.2-android.apk",
              url: "https://example.invalid/mobile.apk",
            },
          ],
        },
        "ios",
      ),
    ).toBe("https://github.com/april-jk/AgentLine/releases/tag/v1.0.2");
  });
});
