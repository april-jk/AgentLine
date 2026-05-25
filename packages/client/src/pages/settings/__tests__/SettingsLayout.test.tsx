import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { SettingsLayout } from "../SettingsLayout";

const mocks = vi.hoisted(() => ({
  useVersion: vi.fn(),
}));

const updateManifest = {
  version: "1.0.2",
  releaseUrl: "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
  downloads: [
    {
      platform: "android",
      kind: "apk",
      name: "AgentLine-Mobile-RN-1.0.2-android.apk",
      url: "https://example.invalid/mobile.apk",
    },
    {
      platform: "macos",
      kind: "dmg",
      name: "AgentLine.Desktop-1.0.2-arm64.dmg",
      url: "https://example.invalid/desktop.dmg",
    },
  ],
};

vi.mock("../../../hooks/useVersion", () => ({
  useVersion: mocks.useVersion,
}));

vi.mock("../../../layouts", () => ({
  useNavigationLayout: () => ({
    openSidebar: vi.fn(),
    isWideScreen: true,
    toggleSidebar: vi.fn(),
    isSidebarCollapsed: false,
  }),
}));

describe("SettingsLayout", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json(updateManifest)),
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    window.localStorage.clear();
    window.__AGENTLINE_NATIVE_APP_VERSION__ = undefined;
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: undefined,
    });
    mocks.useVersion.mockReturnValue({
      version: {
        current: "1.0.1",
        latest: "1.0.2",
        updateAvailable: true,
        resumeProtocolVersion: 2,
        capabilities: [],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
      refetchFresh: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.__AGENTLINE_NATIVE_APP_VERSION__ = undefined;
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: undefined,
    });
  });

  it("shows the updates category in the settings sidebar", () => {
    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/settings/*" element={<SettingsLayout />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText("Updates")).toBeDefined();
    expect(
      screen.getByText("Check for new builds and download the right package"),
    ).toBeDefined();
  });

  it("uses the native shell version for mobile update settings", async () => {
    window.__AGENTLINE_NATIVE_APP_VERSION__ = "1.0.1";
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 14)",
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/settings/update"]}>
          <Routes>
            <Route path="/settings/:category" element={<SettingsLayout />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText("Client: v1.0.1")).toBeDefined();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://relay.oneceo.ai/version/1.0.1",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "AgentLine-Mobile-RN/1.0.1",
          }),
        }),
      );
    });
    expect(
      (
        await screen.findByText("Download update", { selector: "a" })
      ).getAttribute("href"),
    ).toBe("https://example.invalid/mobile.apk");
  });

  it("uses the desktop shell version for desktop update settings", async () => {
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        getAppVersion: () => "1.0.1",
      },
    });
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/settings/update"]}>
          <Routes>
            <Route path="/settings/:category" element={<SettingsLayout />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(screen.getByText("Client: v1.0.1")).toBeDefined();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://relay.oneceo.ai/version/1.0.1",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": "AgentLine-Desktop-Electron/1.0.1",
          }),
        }),
      );
    });
    expect(
      (
        await screen.findByText("Download update", { selector: "a" })
      ).getAttribute("href"),
    ).toBe("https://example.invalid/desktop.dmg");
  });
});
