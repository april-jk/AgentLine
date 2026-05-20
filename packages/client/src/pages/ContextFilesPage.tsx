import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { FilesBrowser } from "../components/FilesBrowser";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProject } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";

interface ContextFilesLocationState {
  backTo?: string;
}

export function ContextFilesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const basePath = useRemoteBasePath();
  const { isWideScreen } = useNavigationLayout();
  const { projectId, sessionId } = useParams<{
    projectId: string;
    sessionId?: string;
  }>();
  const state = location.state as ContextFilesLocationState | null;
  const { project } = useProject(projectId);
  const isSessionContext = Boolean(sessionId);

  const pageTitle = isSessionContext
    ? t("contextFilesSessionTitle" as never)
    : t("contextFilesProjectTitle" as never);
  const pageDescription = isSessionContext
    ? t("contextFilesSessionDescription" as never)
    : t("contextFilesProjectDescription" as never);

  const fallbackBackTo = useMemo(() => {
    if (!projectId) {
      return `${basePath}/projects`;
    }
    if (sessionId) {
      return `${basePath}/projects/${projectId}/sessions/${sessionId}`;
    }
    return `${basePath}/projects`;
  }, [basePath, projectId, sessionId]);

  const backTo = state?.backTo ?? fallbackBackTo;
  const wrapperClass = isWideScreen
    ? "main-content-wrapper"
    : "main-content-mobile";
  const innerClass = isWideScreen
    ? "main-content-constrained"
    : "main-content-mobile-inner";

  useDocumentTitle(project?.name, pageTitle);

  if (!projectId) {
    return null;
  }

  return (
    <div className={wrapperClass}>
      <div className={innerClass}>
        <PageHeader
          title={pageTitle}
          showBack
          onBack={() => navigate(backTo)}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">
            <section className="files-context-page">
              <div className="files-context-hero">
                <span className="files-context-hero__eyebrow">{pageTitle}</span>
                <h1>{project?.name ?? "Files"}</h1>
                <p>{pageDescription}</p>
              </div>

              <FilesBrowser
                projectId={projectId}
                fileBackLabel={t("fileBackToFiles" as never)}
              />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
