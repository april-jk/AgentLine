import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { FilesPage } from "../FilesPage";

const mocks = vi.hoisted(() => ({
  api: {
    getFileList: vi.fn(),
  },
}));

vi.mock("../../api/client", () => ({
  api: mocks.api,
}));

vi.mock("../../components/PageHeader", () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("../../hooks/useProjects", () => ({
  useProject: () => ({
    project: {
      id: "project-1",
      name: "AgentLine",
      path: "/tmp/agentline",
      lastActivity: "2026-05-20T00:00:00.000Z",
    },
    loading: false,
    error: null,
  }),
}));

vi.mock("../../layouts", () => ({
  useNavigationLayout: () => ({
    openSidebar: vi.fn(),
    isWideScreen: true,
    toggleSidebar: vi.fn(),
    isSidebarCollapsed: false,
  }),
}));

describe("FilesPage", () => {
  beforeEach(() => {
    mocks.api.getFileList.mockReset();
    Object.defineProperty(globalThis, "IntersectionObserver", {
      configurable: true,
      writable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps loaded entries visible when loading more fails", async () => {
    mocks.api.getFileList
      .mockResolvedValueOnce({
        path: ".",
        entries: [
          {
            name: "src",
            path: "src",
            type: "directory",
          },
        ],
        nextCursor: "src",
        truncated: true,
      })
      .mockRejectedValueOnce(new Error("Too many requests"));

    render(
      <I18nProvider>
        <MemoryRouter initialEntries={["/projects/project-1/files"]}>
          <Routes>
            <Route path="/projects/:projectId/files" element={<FilesPage />} />
            <Route
              path="/projects/:projectId/file"
              element={<div>File page</div>}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    expect(await screen.findByText("src")).toBeDefined();
    expect(screen.getByRole("button", { name: "Load more" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Too many requests")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });

    expect(screen.getByText("src")).toBeDefined();
    expect(screen.queryByText("Couldn't load files")).toBeNull();
  });

  it("loads the requested directory from the URL query", async () => {
    mocks.api.getFileList.mockResolvedValueOnce({
      path: "apps/docs",
      entries: [],
      nextCursor: null,
      truncated: false,
    });

    render(
      <I18nProvider>
        <MemoryRouter
          initialEntries={["/projects/project-1/files?path=apps%2Fdocs"]}
        >
          <Routes>
            <Route path="/projects/:projectId/files" element={<FilesPage />} />
            <Route
              path="/projects/:projectId/file"
              element={<div>File page</div>}
            />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(mocks.api.getFileList).toHaveBeenCalledWith("project-1", {
        path: "apps/docs",
      });
    });

    expect(await screen.findByText("Nothing here yet")).toBeDefined();
  });
});
