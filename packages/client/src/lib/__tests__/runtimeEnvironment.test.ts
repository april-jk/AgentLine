import { describe, expect, it } from "vitest";
import { isElectronDesktopShell } from "../runtimeEnvironment";

describe("isElectronDesktopShell", () => {
  it("returns true when the desktop bridge is present", () => {
    expect(isElectronDesktopShell({ hasDesktopApi: true, userAgent: "" })).toBe(
      true,
    );
  });

  it("returns true for Electron user agents without the bridge", () => {
    expect(
      isElectronDesktopShell({
        hasDesktopApi: false,
        userAgent:
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) AgentLine Desktop Electron/35.2.0 Safari/537.36",
      }),
    ).toBe(true);
  });

  it("returns false for regular browser user agents", () => {
    expect(
      isElectronDesktopShell({
        hasDesktopApi: false,
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      }),
    ).toBe(false);
  });
});
