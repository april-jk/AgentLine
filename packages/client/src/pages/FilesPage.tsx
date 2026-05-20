import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type FileListEntry, api } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProject } from "../hooks/useProjects";
import { useNavigationLayout } from "../layouts";

function formatEntryMeta(entry: FileListEntry): string {
  if (entry.type === "directory") {
    return "Folder";
  }

  if (typeof entry.size !== "number") {
    return "File";
  }

  if (entry.size < 1024) {
    return `${entry.size} B`;
  }
  if (entry.size < 1024 * 1024) {
    return `${(entry.size / 1024).toFixed(1)} KB`;
  }
  return `${(entry.size / (1024 * 1024)).toFixed(1)} MB`;
}

function FileIcon({ entry }: { entry: FileListEntry }) {
  if (entry.type === "directory") {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    );
  }

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function FilesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { project } = useProject(projectId);
  const [path, setPath] = useState(".");
  const [entries, setEntries] = useState<FileListEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useDocumentTitle(project?.name, "Files");

  useEffect(() => {
    if (!projectId) return;

    const loadRoot = async () => {
      setLoading(true);
      setError(null);
      try {
        const json = await api.getFileList(projectId, { path: "." });
        setPath(json.path);
        setEntries(json.entries);
        setNextCursor(json.nextCursor);
        setLoadMoreError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to list files");
      } finally {
        setLoading(false);
      }
    };

    void loadRoot();
  }, [projectId]);

  useEffect(() => {
    if (!loadMoreRef.current || !nextCursor || loading || loadingMore) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMore();
      }
    });

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [nextCursor, loading, loadingMore]);

  async function loadPage(nextPath: string) {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setLoadMoreError(null);
    try {
      const json = await api.getFileList(projectId, { path: nextPath });
      setPath(json.path);
      setEntries(json.entries);
      setNextCursor(json.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list files");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!projectId || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const json = await api.getFileList(projectId, {
        path,
        cursor: nextCursor,
      });
      setEntries((prev) => [...prev, ...json.entries]);
      setNextCursor(json.nextCursor);
    } catch (e) {
      setLoadMoreError(
        e instanceof Error ? e.message : "Failed to load more files",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const breadcrumbs = useMemo(() => {
    const items = [{ label: "Root", value: "." }];
    if (path === ".") {
      return items;
    }

    const segments = path.split("/").filter(Boolean);
    return [
      ...items,
      ...segments.map((segment, index) => ({
        label: segment,
        value: segments.slice(0, index + 1).join("/"),
      })),
    ];
  }, [path]);

  const wrapperClass = isWideScreen
    ? "main-content-wrapper"
    : "main-content-mobile";
  const innerClass = isWideScreen
    ? "main-content-constrained"
    : "main-content-mobile-inner";

  return (
    <div className={wrapperClass}>
      <div className={innerClass}>
        <PageHeader
          title={project?.name ? `${project.name} Files` : "Files"}
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">
            <section className="files-page">
              {loading ? (
                <div className="files-empty-state">
                  <h3>Loading files</h3>
                  <p>Fetching the current directory contents.</p>
                </div>
              ) : error ? (
                <div className="files-empty-state files-empty-state--error">
                  <h3>Couldn&apos;t load files</h3>
                  <p>{error}</p>
                </div>
              ) : (
                <div className="files-browser">
                  <div className="files-browser__header">
                    <div className="files-browser__header-main">
                      <span>Current folder</span>
                      <div
                        className="files-browser__breadcrumbs"
                        aria-label="Current path"
                      >
                        {breadcrumbs.map((crumb, index) => (
                          <span
                            key={crumb.value}
                            className="files-browser__crumb-wrap"
                          >
                            {index > 0 ? (
                              <span
                                className="files-browser__separator"
                                aria-hidden="true"
                              >
                                /
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className={`files-browser__crumb ${
                                crumb.value === path ? "active" : ""
                              }`}
                              onClick={() => void loadPage(crumb.value)}
                            >
                              {crumb.label}
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="files-page__stat">
                      {entries.length} visible item
                      {entries.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  {entries.length === 0 ? (
                    <div className="files-empty-state files-empty-state--embedded">
                      <h3>Nothing here yet</h3>
                      <p>This directory is empty.</p>
                    </div>
                  ) : (
                    <div className="files-list" role="list">
                      {entries.map((entry) => (
                        <div
                          key={entry.path}
                          className="files-entry"
                          role="listitem"
                        >
                          {entry.type === "directory" ? (
                            <button
                              type="button"
                              className="files-entry__button"
                              onClick={() => void loadPage(entry.path)}
                            >
                              <span className="files-entry__icon">
                                <FileIcon entry={entry} />
                              </span>
                              <span className="files-entry__body">
                                <span className="files-entry__name">
                                  {entry.name}
                                </span>
                                <span className="files-entry__meta">
                                  {formatEntryMeta(entry)}
                                </span>
                              </span>
                              <span className="files-entry__action">Open</span>
                            </button>
                          ) : (
                            <Link
                              to={`/projects/${projectId}/file?path=${encodeURIComponent(
                                entry.path,
                              )}`}
                              className="files-entry__button files-entry__button--link"
                            >
                              <span className="files-entry__icon">
                                <FileIcon entry={entry} />
                              </span>
                              <span className="files-entry__body">
                                <span className="files-entry__name">
                                  {entry.name}
                                </span>
                                <span className="files-entry__meta">
                                  {formatEntryMeta(entry)}
                                </span>
                              </span>
                              <span className="files-entry__action">
                                Preview
                              </span>
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div ref={loadMoreRef} className="files-page__load-more">
                {loadingMore ? (
                  <span>Loading more…</span>
                ) : loadMoreError ? (
                  <>
                    <span className="files-page__load-more-error">
                      {loadMoreError}
                    </span>
                    {nextCursor ? (
                      <button
                        type="button"
                        className="files-toolbar-button"
                        onClick={() => void loadMore()}
                      >
                        Retry
                      </button>
                    ) : null}
                  </>
                ) : nextCursor ? (
                  <button
                    type="button"
                    className="files-toolbar-button"
                    onClick={() => void loadMore()}
                  >
                    Load more
                  </button>
                ) : entries.length > 0 ? (
                  <span className="files-page__end-note">
                    End of this directory
                  </span>
                ) : null}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
