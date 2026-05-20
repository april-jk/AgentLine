import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ContextFilesPage } from "../ContextFilesPage";

vi.mock("../../components/FilesBrowser", () => ({
  FilesBrowser: () => <div>Files browser</div>,
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title, onBack }: { title: string; onBack?: () => void }) => (
    <div>
      <button type="button" onClick={onBack}>
        Back
      </button>
      <span>{title}</span>
    </div>
  ),
}));

vi.mock("../../hooks/useProjects", () => ({
  useProject: () => ({
    project: {
      id: "project-1",
      name: "AgentLine",
      path: "/tmp/agentline",
    },
  }),
}));

vi.mock("../../hooks/useRemoteBasePath", () => ({
  useRemoteBasePath: () => "",
}));

vi.mock("../../layouts", () => ({
  useNavigationLayout: () => ({
    isWideScreen: false,
  }),
}));

describe("ContextFilesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns to the originating session when the back button is pressed", () => {
    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/projects/project-1/sessions/session-1/files",
              state: {
                backTo: "/projects/project-1/sessions/session-1",
              },
            },
          ]}
        >
          <Routes>
            <Route
              path="/projects/:projectId/sessions/:sessionId/files"
              element={<ContextFilesPage />}
            />
            <Route
              path="/projects/:projectId/sessions/:sessionId"
              element={<div>Session page</div>}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Session page")).toBeDefined();
  });
});
