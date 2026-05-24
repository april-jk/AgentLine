import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { UpdateAvailableModal } from "../UpdateAvailableModal";

const mocks = vi.hoisted(() => ({
  useVersion: vi.fn(),
}));

vi.mock("../../hooks/useVersion", () => ({
  useVersion: mocks.useVersion,
}));

function renderModal() {
  return render(
    <I18nProvider>
      <UpdateAvailableModal />
    </I18nProvider>,
  );
}

describe("UpdateAvailableModal", () => {
  const defaultUserAgent = window.navigator.userAgent;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "userAgent", {
      value: defaultUserAgent,
      configurable: true,
    });
    mocks.useVersion.mockReturnValue({
      version: {
        current: "1.0.1",
        latest: "1.0.2",
        updateAvailable: true,
        update: {
          version: "1.0.2",
          releaseUrl:
            "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
          downloads: [
            {
              platform: "android",
              kind: "apk",
              name: "AgentLine-Mobile-RN-1.0.2-android.apk",
              url: "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine-Mobile-RN-1.0.2-android.apk",
            },
          ],
        },
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
      refetchFresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the Android APK when running in an Android browser", () => {
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 14)",
      configurable: true,
    });

    renderModal();

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Update Available")).toBeDefined();
    expect(
      screen.getByText(
        "AgentLine v1.0.2 is available. You are running v1.0.1.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Recommended download: AgentLine-Mobile-RN-1.0.2-android.apk",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Download" }).getAttribute("href"),
    ).toBe(
      "https://github.com/april-jk/AgentLine/releases/download/v1.0.2/AgentLine-Mobile-RN-1.0.2-android.apk",
    );
  });

  it("falls back to the release page when no asset matches this device", () => {
    renderModal();

    expect(
      screen.getByText(
        "Open the official release page to choose a download for this device.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Open Release" }).getAttribute("href"),
    ).toBe("https://github.com/april-jk/AgentLine/releases/tag/v1.0.2");
  });

  it("dismisses the latest update until the version changes", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      window.localStorage.getItem("agentline.dismissed-update-version"),
    ).toBe("1.0.2");
  });

  it("does not show a dismissed version", () => {
    window.localStorage.setItem("agentline.dismissed-update-version", "1.0.2");

    renderModal();

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
