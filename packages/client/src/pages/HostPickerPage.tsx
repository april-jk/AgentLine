/**
 * HostPickerPage - Unified host switcher and connection center.
 *
 * Replaces the older split "saved hosts + separate direct/relay pages" entry
 * with one page that matches the newer mobile connection-center structure:
 * - Saved hosts at the top
 * - Inline relay/direct entry options below
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import {
  type SavedHost,
  createDirectHost,
  createRelayHost,
  getHostByRelayUsername,
  getHostByWsUrl,
  loadSavedHosts,
  removeHost,
  saveHost,
} from "../lib/hostStorage";

type HostStatus = "online" | "offline" | "checking" | "unknown";
type EntryMode = "relay" | "direct";

interface HostStatusMap {
  [hostId: string]: HostStatus;
}

const DEFAULT_RELAY_URL = "wss://relay.agentline.com/ws";

export function HostPickerPage() {
  const { t } = useI18n();
  const {
    isAutoResuming,
    connectViaRelay,
    connect,
    connectDirectWithSession,
    setCurrentHostId,
    error: connectionError,
  } = useRemoteConnection();
  const [hosts, setHosts] = useState<SavedHost[]>([]);
  const [hostStatuses, setHostStatuses] = useState<HostStatusMap>({});
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>("relay");
  const [error, setError] = useState<string | null>(null);

  const [relayUsername, setRelayUsername] = useState("");
  const [relayPassword, setRelayPassword] = useState("");
  const [relayUrl, setRelayUrl] = useState(DEFAULT_RELAY_URL);
  const [showRelayAdvanced, setShowRelayAdvanced] = useState(false);

  const [directServerUrl, setDirectServerUrl] = useState(
    "ws://localhost:3400/api/ws",
  );
  const [directUsername, setDirectUsername] = useState("");
  const [directPassword, setDirectPassword] = useState("");

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
            setEntryMode("relay");
            setRelayUsername(host.relayUsername);
            setRelayUrl(host.relayUrl);
            setShowRelayAdvanced(host.relayUrl !== DEFAULT_RELAY_URL);
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
            setEntryMode("direct");
            setDirectServerUrl(host.wsUrl);
            setDirectUsername(host.srpUsername);
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
    [connectDirectWithSession, connectViaRelay, setCurrentHostId, t],
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

  const handleRelaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!relayUsername.trim()) {
      setError(t("relayLoginErrorUsernameRequired"));
      return;
    }
    if (!relayPassword) {
      setError(t("relayLoginErrorPasswordRequired"));
      return;
    }

    const username = relayUsername.trim().toLowerCase();
    const effectiveRelayUrl = relayUrl.trim() || DEFAULT_RELAY_URL;

    let host = getHostByRelayUsername(username);
    if (!host) {
      host = createRelayHost({
        relayUrl: effectiveRelayUrl,
        relayUsername: username,
        srpUsername: username,
      });
      saveHost(host);
      setHosts(loadSavedHosts().hosts);
    }
    setCurrentHostId(host.id);

    try {
      await connectViaRelay({
        relayUrl: effectiveRelayUrl,
        relayUsername: username,
        srpUsername: username,
        srpPassword: relayPassword,
        rememberMe: true,
        onStatusChange: () => {},
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("relayLoginErrorConnectionFailed"),
      );
    }
  };

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!directServerUrl.trim()) {
      setError(t("directLoginErrorServerUrlRequired"));
      return;
    }
    if (!directUsername.trim()) {
      setError(t("directLoginErrorUsernameRequired"));
      return;
    }
    if (!directPassword) {
      setError(t("directLoginErrorPasswordRequired"));
      return;
    }

    let wsUrl = directServerUrl.trim();
    if (wsUrl.startsWith("http://")) {
      wsUrl = wsUrl.replace("http://", "ws://");
    } else if (wsUrl.startsWith("https://")) {
      wsUrl = wsUrl.replace("https://", "wss://");
    } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = `ws://${wsUrl}`;
    }
    if (!wsUrl.endsWith("/api/ws")) {
      wsUrl = `${wsUrl.replace(/\/$/, "")}/api/ws`;
    }

    try {
      let hostIdToRemember: string;
      const existing = getHostByWsUrl(wsUrl);
      if (existing) {
        hostIdToRemember = existing.id;
      } else {
        const newHost = createDirectHost({
          wsUrl,
          srpUsername: directUsername.trim(),
        });
        saveHost(newHost);
        setHosts(loadSavedHosts().hosts);
        hostIdToRemember = newHost.id;
      }
      setCurrentHostId(hostIdToRemember);

      await connect(wsUrl, directUsername.trim(), directPassword, true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("directLoginErrorPasswordRequired"),
      );
    }
  };

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

          <div className="host-picker-mode-switch" role="tablist">
            <button
              type="button"
              className={`host-picker-mode-tab ${entryMode === "direct" ? "host-picker-mode-tab-active" : ""}`}
              onClick={() => setEntryMode("direct")}
              data-testid="direct-mode-button"
            >
              {t("hostPickerDirectTitle")}
            </button>
            <button
              type="button"
              className={`host-picker-mode-tab ${entryMode === "relay" ? "host-picker-mode-tab-active" : ""}`}
              onClick={() => setEntryMode("relay")}
              data-testid="relay-mode-button"
            >
              {t("hostPickerRelayTitle")}
            </button>
          </div>

          {entryMode === "direct" ? (
            <form
              className="login-form host-picker-inline-form host-picker-form-panel"
              onSubmit={handleDirectSubmit}
            >
              <div className="host-picker-form-header">
                <div>
                  <h3 className="host-picker-form-title">
                    {t("hostPickerDirectTitle")}
                  </h3>
                  <p className="host-picker-form-description">
                    {t("hostPickerDirectDescription")}
                  </p>
                </div>
              </div>

              <div className="login-field">
                <label htmlFor="serverUrl">{t("directLoginServerUrl")}</label>
                <input
                  id="serverUrl"
                  type="text"
                  value={directServerUrl}
                  onChange={(e) => setDirectServerUrl(e.target.value)}
                  placeholder="ws://localhost:3400/api/ws"
                  autoComplete="url"
                />
                <p className="login-field-hint">
                  {t("directLoginServerUrlHint")}
                </p>
              </div>

              <div className="host-picker-form-columns">
                <div className="login-field">
                  <label htmlFor="username">{t("directLoginUsername")}</label>
                  <input
                    id="username"
                    type="text"
                    value={directUsername}
                    onChange={(e) => setDirectUsername(e.target.value)}
                    placeholder={t("directLoginUsernamePlaceholder")}
                    autoComplete="username"
                  />
                </div>

                <div className="login-field">
                  <label htmlFor="password">{t("directLoginPassword")}</label>
                  <input
                    id="password"
                    type="password"
                    value={directPassword}
                    onChange={(e) => setDirectPassword(e.target.value)}
                    placeholder={t("directLoginPasswordPlaceholder")}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <button type="submit" className="login-button">
                {t("directLoginConnect")}
              </button>
            </form>
          ) : (
            <form
              className="login-form host-picker-inline-form host-picker-form-panel"
              onSubmit={handleRelaySubmit}
            >
              <div className="host-picker-form-header">
                <div>
                  <h3 className="host-picker-form-title">
                    {t("hostPickerRelayTitle")}
                  </h3>
                  <p className="host-picker-form-description">
                    {t("hostPickerRelayDescription")}
                  </p>
                </div>
              </div>

              <div className="host-picker-form-columns">
                <div className="login-field">
                  <label htmlFor="relayUsername">
                    {t("relayLoginUsername")}
                  </label>
                  <input
                    id="relayUsername"
                    type="text"
                    value={relayUsername}
                    onChange={(e) => setRelayUsername(e.target.value)}
                    placeholder={t("relayLoginUsernamePlaceholder")}
                    autoComplete="username"
                    autoCapitalize="none"
                  />
                </div>

                <div className="login-field">
                  <label htmlFor="relayPassword">
                    {t("relayLoginPassword")}
                  </label>
                  <input
                    id="relayPassword"
                    type="password"
                    value={relayPassword}
                    onChange={(e) => setRelayPassword(e.target.value)}
                    placeholder={t("relayLoginPasswordPlaceholder")}
                    autoComplete="current-password"
                  />
                </div>
              </div>

              <button
                type="button"
                className="login-advanced-toggle"
                onClick={() => setShowRelayAdvanced((value) => !value)}
              >
                {showRelayAdvanced
                  ? t("relayLoginHideAdvanced")
                  : t("relayLoginShowAdvanced")}
              </button>

              {showRelayAdvanced ? (
                <div className="login-field">
                  <label htmlFor="relayUrl">
                    {t("relayLoginCustomRelayUrl")}
                  </label>
                  <input
                    id="relayUrl"
                    type="text"
                    value={relayUrl}
                    onChange={(e) => setRelayUrl(e.target.value)}
                    placeholder={DEFAULT_RELAY_URL}
                    autoComplete="url"
                  />
                  <p className="login-field-hint">
                    {t("relayLoginCustomRelayUrlHint")}
                  </p>
                </div>
              ) : null}

              <button type="submit" className="login-button">
                {t("relayLoginConnect")}
              </button>
            </form>
          )}
        </section>

        <p className="login-hint host-picker-footer-hint">
          {t("hostPickerSavedHint")}
        </p>
      </div>
    </div>
  );
}
