import { useParams } from "react-router-dom";
import { FilesBrowser } from "../components/FilesBrowser";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useProject } from "../hooks/useProjects";
import { useI18n } from "../i18n";
import { useNavigationLayout } from "../layouts";

export function FilesPage() {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();
  const { project } = useProject(projectId);

  useDocumentTitle(project?.name, "Files");

  if (!projectId) {
    return null;
  }

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
          title={
            project?.name ? `${project.name} Files` : t("sessionMenuFiles")
          }
          onOpenSidebar={openSidebar}
          onToggleSidebar={toggleSidebar}
          isWideScreen={isWideScreen}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        <main className="page-scroll-container">
          <div className="page-content-inner">
            <FilesBrowser
              projectId={projectId}
              fileBackLabel={t("fileBackToFiles" as never)}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
