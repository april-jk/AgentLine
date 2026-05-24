import { useCallback, useEffect, useMemo, useState } from "react";
import type { VersionInfo } from "../api/client";
import { useVersion } from "../hooks/useVersion";
import { useI18n } from "../i18n";
import { selectBestDownload } from "../lib/updateDownloads";
import { Modal } from "./ui/Modal";

const DISMISSED_UPDATE_KEY = "agentline.dismissed-update-version";

function getDismissedUpdateVersion(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function setDismissedUpdateVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

function emitNativeShellUpdateAvailable(versionInfo: VersionInfo): void {
  if (!versionInfo.updateAvailable || !versionInfo.latest) return;
  try {
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        type: "agentline-update-available",
        current: versionInfo.current,
        latest: versionInfo.latest,
        update: versionInfo.update ?? null,
      }),
    );
  } catch {
    // Native bridge is optional.
  }
}

export function UpdateAvailableModal() {
  const { t } = useI18n();
  const { version } = useVersion({ freshOnMount: true });
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    getDismissedUpdateVersion(),
  );

  useEffect(() => {
    if (version) {
      emitNativeShellUpdateAvailable(version);
    }
  }, [version]);

  const latest = version?.latest ?? null;
  const showModal = Boolean(
    version?.updateAvailable && latest && dismissedVersion !== latest,
  );
  const bestDownload = useMemo(
    () => selectBestDownload(version?.update),
    [version?.update],
  );
  const downloadHref = bestDownload?.url ?? version?.update?.releaseUrl;

  const dismiss = useCallback(() => {
    if (!latest) return;
    setDismissedUpdateVersion(latest);
    setDismissedVersion(latest);
  }, [latest]);

  if (!showModal || !version || !latest) return null;

  return (
    <Modal title={t("updateModalTitle")} onClose={dismiss}>
      <div className="update-modal-content">
        <p className="update-modal-message">
          {t("updateModalMessage", {
            current: version.current,
            latest,
          })}
        </p>
        {bestDownload ? (
          <p className="update-modal-detail">
            {t("updateModalDownloadName", { name: bestDownload.name })}
          </p>
        ) : (
          <p className="update-modal-detail">
            {t("updateModalReleasePageHint")}
          </p>
        )}
        <div className="update-modal-actions">
          <button type="button" className="btn-secondary" onClick={dismiss}>
            {t("updateModalLater")}
          </button>
          {downloadHref ? (
            <a
              className="btn-primary"
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
            >
              {bestDownload
                ? t("updateModalDownload")
                : t("updateModalOpenRelease")}
            </a>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
