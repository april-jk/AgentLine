import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdatePrompt } from "../../../../desktop-electron/src/renderer/DesktopUpdatePrompt";

describe("DesktopUpdatePrompt", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders as a dialog and opens the selected download", () => {
    const onDownload = vi.fn();

    render(
      <DesktopUpdatePrompt
        currentVersion="1.0.1"
        update={{
          version: "1.0.2",
          releaseUrl:
            "https://github.com/april-jk/AgentLine/releases/tag/v1.0.2",
          downloads: [],
        }}
        download={{
          platform: "macos",
          kind: "dmg",
          name: "AgentLine.Desktop-1.0.2-arm64.dmg",
          url: "https://example.invalid/AgentLine.Desktop-1.0.2-arm64.dmg",
        }}
        downloadUrl="https://example.invalid/AgentLine.Desktop-1.0.2-arm64.dmg"
        onDismiss={vi.fn()}
        onDownload={onDownload}
      />,
    );

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByText("Update Available")).toBeDefined();
    expect(
      screen.getByText(
        "AgentLine v1.0.2 is available. Current version: v1.0.1.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Recommended download: AgentLine.Desktop-1.0.2-arm64.dmg",
      ),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Download Update" }));

    expect(onDownload).toHaveBeenCalledWith(
      "https://example.invalid/AgentLine.Desktop-1.0.2-arm64.dmg",
    );
  });
});
