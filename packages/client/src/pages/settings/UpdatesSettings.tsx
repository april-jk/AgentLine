import { fetchAgentLineUpdate, type UpdateManifest } from "@agentline/shared";
import { useCallback, useEffect, useState } from "react";
import { useOptionalRemoteConnection } from "../../contexts/RemoteConnectionContext";
import { usePwaInstall } from "../../hooks/usePwaInstall";
import { useVersion } from "../../hooks/useVersion";
import { useI18n } from "../../i18n";
import { getNativeShellInfo } from "../../lib/nativeShell";
import { selectBestDownload } from "../../lib/updateDownloads";

export function UpdatesSettings() {
  const { t } = useI18n();
  const nativeShellInfo = getNativeShellInfo();
  const nativeShellAppVersion = nativeShellInfo?.version ?? null;
  const nativeShellType = nativeShellInfo?.type ?? null;
  const nativeShellPlatform = nativeShellInfo?.platform;
  const isNativeShell = !!nativeShellInfo;
  const hasNativeShellVersion = !!nativeShellAppVersion;
  const displayedClientVersion = hasNativeShellVersion
    ? `v${nativeShellAppVersion}`
    : isNativeShell
      ? t("updatesUnknownVersion")
      : `v${__APP_VERSION__}`;
  const [nativeUpdate, setNativeUpdate] = useState<UpdateManifest | null>(null);
  const [nativeUpdateChecking, setNativeUpdateChecking] = useState(false);
  const [nativeUpdateError, setNativeUpdateError] = useState<Error | null>(
    null,
  );
  const { canInstall, isInstalled, install } = usePwaInstall();
  const {
    version: versionInfo,
    loading: versionLoading,
    error: versionError,
    refetchFresh: refetchVersionFresh,
  } = useVersion({ freshOnMount: true });
  const remoteConnection = useOptionalRemoteConnection();
  const isRelayConnection = !!remoteConnection?.currentRelayUsername;
  const hasResumeProtocolSupport =
    (versionInfo?.resumeProtocolVersion ?? 1) >= 2;
  const showRelayResumeUpdateWarning =
    isRelayConnection && !!versionInfo && !hasResumeProtocolSupport;
  const checkNativeUpdate = useCallback(async () => {
    setNativeUpdateChecking(true);
    setNativeUpdateError(null);
    try {
      if (nativeShellAppVersion) {
        const result = await fetchAgentLineUpdate(
          nativeShellAppVersion,
          nativeShellType === "desktop-electron"
            ? `AgentLine-Desktop-Electron/${nativeShellAppVersion}`
            : `AgentLine-Mobile-RN/${nativeShellAppVersion}`,
        );
        setNativeUpdate(result.status === "available" ? result.update : null);
        return;
      }

      if (nativeShellInfo?.legacy) {
        const response = await fetch("https://relay.oneceo.ai/version", {
          headers: {
            Accept: "application/json",
            "User-Agent": "AgentLine-Mobile-RN/legacy",
          },
        });
        if (!response.ok) {
          throw new Error(`Update check failed: ${response.status}`);
        }
        setNativeUpdate((await response.json()) as UpdateManifest);
      }
    } catch (error) {
      setNativeUpdateError(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      setNativeUpdateChecking(false);
    }
  }, [nativeShellAppVersion, nativeShellInfo?.legacy, nativeShellType]);

  useEffect(() => {
    if (isNativeShell) {
      void checkNativeUpdate();
    }
  }, [checkNativeUpdate, isNativeShell]);

  const effectiveClientUpdate = isNativeShell
    ? nativeUpdate
    : (versionInfo?.update ?? null);
  const effectiveClientLatest = isNativeShell
    ? nativeUpdate?.version
    : versionInfo?.latest;
  const effectiveClientUpdateAvailable = isNativeShell
    ? Boolean(nativeUpdate)
    : Boolean(versionInfo?.updateAvailable);
  const effectiveVersionError = isNativeShell
    ? nativeUpdateError
    : versionError;
  const effectiveVersionLoading = isNativeShell
    ? nativeUpdateChecking
    : versionLoading;
  const bestUpdateDownload = selectBestDownload(
    effectiveClientUpdate,
    undefined,
    nativeShellPlatform,
  );
  const updateDownloadHref =
    bestUpdateDownload?.url ?? effectiveClientUpdate?.releaseUrl;

  const checkUpdates = () => {
    if (isNativeShell) {
      void checkNativeUpdate();
      return;
    }
    void refetchVersionFresh();
  };

  return (
    <section className="settings-section">
      <h2>{t("updatesTitle")}</h2>
      <div className="settings-group">
        {(canInstall || isInstalled) && (
          <div className="settings-item">
            <div className="settings-item-info">
              <strong>{t("updatesInstallTitle")}</strong>
              <p>
                {isInstalled
                  ? t("updatesInstalledDescription")
                  : t("updatesInstallDescription")}
              </p>
            </div>
            {isInstalled ? (
              <span className="settings-status-badge">
                {t("updatesInstalled")}
              </span>
            ) : (
              <button
                type="button"
                className="settings-button"
                onClick={install}
              >
                {t("updatesInstall")}
              </button>
            )}
          </div>
        )}
        <div className="settings-item">
          <div className="settings-item-info">
            <strong>{t("updatesVersionTitle")}</strong>
            <p>
              {t("updatesServerVersion")}{" "}
              {versionInfo ? (
                <>
                  v{versionInfo.current}
                  {versionInfo.updateAvailable && versionInfo.latest ? (
                    <span className="settings-update-available">
                      {" "}
                      {t("updatesVersionAvailable", {
                        version: versionInfo.latest,
                      })}
                    </span>
                  ) : versionInfo.latest ? (
                    <span className="settings-up-to-date">
                      {" "}
                      {t("updatesUpToDate")}
                    </span>
                  ) : null}
                </>
              ) : (
                t("loginLoading")
              )}
            </p>
            <p>
              {t("updatesClientVersion")} {displayedClientVersion}
              {effectiveClientUpdateAvailable && effectiveClientLatest ? (
                <span className="settings-update-available">
                  {" "}
                  {t("updatesVersionAvailable", {
                    version: effectiveClientLatest,
                  })}
                </span>
              ) : effectiveClientLatest ? (
                <span className="settings-up-to-date">
                  {" "}
                  {t("updatesUpToDate")}
                </span>
              ) : null}
            </p>
            {effectiveVersionError && (
              <p className="settings-warning">{t("updatesUnableRefresh")}</p>
            )}
            {showRelayResumeUpdateWarning && (
              <p className="settings-warning">
                {t("updatesRelayResumeWarning")}
              </p>
            )}
            {effectiveClientUpdateAvailable && (
              <div className="settings-update-hint">
                <p>{t("updatesUpdateHint")}</p>
                {updateDownloadHref && (
                  <a
                    href={updateDownloadHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-inline-link"
                  >
                    {bestUpdateDownload
                      ? t("updatesDownloadUpdate")
                      : t("updatesOpenRelease")}
                  </a>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="settings-button"
            onClick={checkUpdates}
            disabled={effectiveVersionLoading}
          >
            {effectiveVersionLoading
              ? t("updatesChecking")
              : t("updatesCheckUpdates")}
          </button>
        </div>
      </div>
    </section>
  );
}
