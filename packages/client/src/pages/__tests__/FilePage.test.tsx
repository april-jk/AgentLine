import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FilePage } from "../FilePage";

vi.mock("../../components/FileViewer", () => ({
  FileViewer: ({ filePath }: { filePath: string }) => <div>{filePath}</div>,
}));

describe("FilePage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses contextual back navigation when provided", () => {
    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/projects/project-1/file",
              search: "?path=src%2Findex.ts",
              state: {
                backTo: "/projects/project-1/sessions/session-1/files?path=src",
                backLabel: "Back to files",
              },
            },
          ]}
        >
          <Routes>
            <Route path="/projects/:projectId/file" element={<FilePage />} />
            <Route
              path="/projects/:projectId/sessions/:sessionId/files"
              element={<div>Context files</div>}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Back to files" }));

    expect(screen.getByText("Context files")).toBeDefined();
  });
});
