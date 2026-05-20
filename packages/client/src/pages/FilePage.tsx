import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { FileViewer } from "../components/FileViewer";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";

/**
 * FilePage - Standalone page for viewing files.
 * Route: /projects/:projectId/file?path=<path>
 */
export function FilePage() {
  const { t } = useI18n();
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const basePath = useRemoteBasePath();
  const [searchParams] = useSearchParams();
  const filePath = searchParams.get("path");
  const state = location.state as {
    backTo?: string;
    backLabel?: string;
  } | null;

  if (!projectId) {
    return (
      <div className="file-page file-page-error">
        <div className="file-page-error-content">
          <h1>{t("fileInvalidUrl" as never)}</h1>
          <p>{t("fileMissingProjectId" as never)}</p>
          <Link to={`${basePath}/projects`} className="file-page-back-link">
            {t("fileGoToProjects" as never)}
          </Link>
        </div>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="file-page file-page-error">
        <div className="file-page-error-content">
          <h1>{t("fileInvalidUrl" as never)}</h1>
          <p>{t("fileMissingPath" as never)}</p>
          <Link
            to={`${basePath}/projects/${projectId}`}
            className="file-page-back-link"
          >
            {t("fileGoToProject" as never)}
          </Link>
        </div>
      </div>
    );
  }

  const backTo = state?.backTo ?? `${basePath}/projects/${projectId}`;
  const backLabel = state?.backLabel ?? t("fileBackToProject" as never);

  return (
    <div className="file-page">
      <div className="file-page-nav">
        <Link to={backTo} className="file-page-back-link" title={backLabel}>
          <BackIcon />
          <span>{backLabel}</span>
        </Link>
      </div>
      <div className="file-page-content">
        <FileViewer projectId={projectId} filePath={filePath} standalone />
      </div>
    </div>
  );
}

function BackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 12L6 8l4-4" />
    </svg>
  );
}
