/**
 * HostPickerPage - Unified host switcher and connection center.
 *
 * Replaces the older split "saved hosts + separate direct/relay pages" entry
 * with one page that matches the newer mobile connection-center structure:
 * - Saved hosts at the top
 * - Inline relay/direct entry options below
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import { type SavedHost, loadSavedHosts, removeHost } from "../lib/hostStorage";

type HostStatus = "online" | "offline" | "checking" | "unknown";

interface HostStatusMap {
  [hostId: string]: HostStatus;
}

export function HostPickerPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const {
    isAutoResuming,
    connectViaRelay,
    connectDirectWithSession,
    setCurrentHostId,
    error: connectionError,
  } = useRemoteConnection();
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [hostStatuses, setHostStatuses] = useState<HostStatusMap>({});
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const data = loadSavedHosts();
    setHosts(data.hosts);
  }, []);

  useEffect(() => {
    if (connectionError) {
      setError(connectionError);
    }
  }, [connectionError]);

  useEffect(() => {
    const relayHosts = hosts.filter((host) => host.mode === "relay");
    if (relayHosts.length === 0) return;

    setHostStatuses((prev) => {
      const next = { ...prev };
      for (const host of relayHosts) {
        if (!next[host.id]) {
          next[host.id] = "checking";
        }
      }
      return next;
    });

    for (const host of relayHosts) {
      void checkRelayHostStatus(host).then((status) => {
        setHostStatuses((prev) => ({ ...prev, [host.id]: status }));
      });
    }
  }, [hosts]);

  const checkRelayHostStatus = useCallback(
    async (host: SavedHost): Promise<HostStatus> => {
      if (!host.relayUrl || !host.relayUsername) return "unknown";

      try {
        const httpUrl = host.relayUrl
          .replace(/^ws/, "http")
          .replace(/\/ws$/, "");
        const res = await fetch(
          `${httpUrl}/online/${encodeURIComponent(host.relayUsername)}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!res.ok) return "offline";
        const data = (await res.json()) as { online?: boolean };
        return data.online ? "online" : "offline";
      } catch {
        return "offline";
      }
    },
    [],
  );

  const formatLastConnected = (isoString?: string): string => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return t("hostPickerLastConnectedJustNow");
      if (diffMins < 60)
        return t("hostPickerLastConnectedMinutes", { count: diffMins });
      if (diffHours < 24)
        return t("hostPickerLastConnectedHours", { count: diffHours });
      if (diffDays < 7)
        return t("hostPickerLastConnectedDays", { count: diffDays });
      return date.toLocaleDateString();
    } catch {
      return "";
    }
  };

  const hostListSubtitle = useMemo(
    () =>
      hosts.length > 0
        ? t("hostPickerSavedHosts")
        : t("hostPickerHowToConnect"),
    [hosts.length, t],
  );

  const handleConnectHost = useCallback(
    async (host: SavedHost) => {
      setConnectingHostId(host.id);
      setError(null);

      try {
        if (host.mode === "relay") {
          if (!host.relayUrl || !host.relayUsername) {
            throw new Error(t("hostPickerMissingRelayConfiguration"));
          }

          if (host.session) {
            setCurrentHostId(host.id);
            await connectViaRelay({
              relayUrl: host.relayUrl,
              relayUsername: host.relayUsername,
              srpUsername: host.srpUsername,
              srpPassword: "",
              rememberMe: true,
              onStatusChange: () => {},
              session: host.session,
            });
          } else {
            navigate("/login/relay", {
              state: {
                relayUsername: host.relayUsername,
                relayUrl: host.relayUrl,
              },
            });
          }
        } else {
          if (!host.wsUrl) {
            throw new Error(t("hostPickerMissingWebSocketUrl"));
          }

          if (host.session) {
            setCurrentHostId(host.id);
            await connectDirectWithSession(
              host.wsUrl,
              host.srpUsername,
              host.session,
            );
          } else {
            navigate("/login/direct", {
              state: {
                serverUrl: host.wsUrl,
                username: host.srpUsername,
              },
            });
          }
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t("hostPickerErrorConnectionFailed"),
        );
      } finally {
        setConnectingHostId(null);
      }
    },
    [connectDirectWithSession, connectViaRelay, navigate, setCurrentHostId, t],
  );

  const handleDeleteHost = useCallback(
    (hostId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm(t("hostPickerRemoveConfirm"))) {
        removeHost(hostId);
        setHosts((prev) => prev.filter((host) => host.id !== hostId));
      }
    },
    [t],
  );

  if (isAutoResuming) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-logo">
            <AgentLineLogo />
          </div>
          <p className="login-subtitle">{t("reconnecting")}</p>
          <div className="login-loading" data-testid="auto-resume-loading">
            <div className="login-spinner" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container login-container-unified host-picker-shell">
        <div className="host-picker-top">
          <div className="login-logo host-picker-logo">
            <AgentLineLogo />
          </div>
          <p className="login-subtitle host-picker-top-subtitle">
            {hostListSubtitle}
          </p>
        </div>

        {error ? (
          <div className="login-error" data-testid="host-picker-error">
            {error}
          </div>
        ) : null}

        <section className="host-picker-panel">
          {hosts.length > 0 ? (
            <div className="host-picker-list" data-testid="saved-hosts-list">
              {hosts.map((host) => {
                const status = hostStatuses[host.id] ?? "unknown";
                const isConnecting = connectingHostId === host.id;

                return (
                  <button
                    key={host.id}
                    type="button"
                    className="host-picker-item"
                    onClick={() => void handleConnectHost(host)}
                    disabled={isConnecting}
                    data-testid={`host-item-${host.id}`}
                  >
                    <div className="host-picker-item-main">
                      <span
                        className={`host-picker-status host-picker-status-${status}`}
                        title={t(
                          `hostPickerStatus${status.charAt(0).toUpperCase()}${status.slice(1)}` as never,
                        )}
                      />
                      <span className="host-picker-name">
                        {host.displayName}
                      </span>
                      <span className="host-picker-mode">{host.mode}</span>
                    </div>
                    <div className="host-picker-item-meta">
                      <span className="host-picker-last-connected">
                        {host.lastConnected
                          ? formatLastConnected(host.lastConnected)
                          : host.mode === "relay"
                            ? host.relayUsername
                            : host.wsUrl}
                      </span>
                      <button
                        type="button"
                        className="host-picker-delete"
                        onClick={(e) => handleDeleteHost(host.id, e)}
                        title={t("hostPickerRemoveHost")}
                      >
                        &times;
                      </button>
                    </div>
                    {isConnecting ? (
                      <div className="host-picker-connecting">
                        <div className="login-spinner" />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="login-hint host-picker-empty-state">
              {t("hostPickerEmptyHint")}
            </p>
          )}

          <button
            type="button"
            className="login-button host-picker-add-button"
            onClick={() => navigate("/login/new")}
          >
            {t("hostPickerAddNewHost")}
          </button>
        </section>

        <p className="login-hint host-picker-footer-hint">
          {t("hostPickerSavedHint")}
        </p>
      </div>
    </div>
  );
}
