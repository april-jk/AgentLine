import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { SessionMenu } from "../SessionMenu";

describe("SessionMenu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a files action when provided and calls it", () => {
    const onOpenFiles = vi.fn();

    render(
      <I18nProvider>
        <SessionMenu
          sessionId="session-1"
          projectId="project-1"
          isStarred={false}
          isArchived={false}
          onToggleStar={vi.fn()}
          onToggleArchive={vi.fn()}
          onRename={vi.fn()}
          onOpenFiles={onOpenFiles}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Session options" }));
    fireEvent.click(screen.getByRole("button", { name: "Files" }));

    expect(onOpenFiles).toHaveBeenCalledTimes(1);
  });
});
