/**
 * DirectLoginPage - Direct connection form for remote access via SecureConnection.
 *
 * Collects server URL, username, and password for SRP authentication.
 * On successful auth, the app switches to the main view.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import {
  createDirectHost,
  getHostByWsUrl,
  loadSavedHosts,
  saveHost,
} from "../lib/hostStorage";

function parseHashCredentials(): {
  wsUrl: string;
  username: string;
  password: string;
} | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  try {
    const params = new URLSearchParams(hash.slice(1));
    const wsUrl = params.get("ws");
    const username = params.get("u");
    const password = params.get("p") ?? "";

    if (wsUrl || username || password) {
      window.history.replaceState(null, "", window.location.pathname);
      return {
        wsUrl: wsUrl ?? "",
        username: username ?? "",
        password,
      };
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

export function DirectLoginPage() {
  const { t } = useI18n();
  const location = useLocation();
  const locationState =
    (location.state as
      | {
          serverUrl?: string;
          username?: string;
        }
      | undefined) ?? {};
  const {
    connect,
    isConnecting,
    isAutoResuming,
    error,
    setCurrentHostId,
    storedUrl,
    storedUsername,
    hasStoredSession,
    resumeSession,
  } = useRemoteConnection();

  // Form state - pre-fill from stored credentials
  // All hooks must be before any conditional returns
  const [serverUrl, setServerUrl] = useState(
    locationState.serverUrl ?? storedUrl ?? "ws://localhost:3400/api/ws",
  );
  const [username, setUsername] = useState(
    locationState.username ?? storedUsername ?? "",
  );
  const [password, setPassword] = useState("");
  // Always default to "remember me" - logout feature can be added later
  const [rememberMe, setRememberMe] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const autoLoginAttempted = useRef(false);

  useEffect(() => {
    if (autoLoginAttempted.current || isAutoResuming) return;
    autoLoginAttempted.current = true;

    const hashCreds = parseHashCredentials();
    if (!hashCreds) return;

    const normalizedWsUrl = hashCreds.wsUrl.trim();
    const normalizedUsername = hashCreds.username.trim();
    const normalizedPassword = hashCreds.password;

    if (normalizedWsUrl) setServerUrl(normalizedWsUrl);
    if (normalizedUsername) setUsername(normalizedUsername);
    if (normalizedPassword) setPassword(normalizedPassword);

    if (!normalizedWsUrl || !normalizedUsername || !normalizedPassword) {
      return;
    }

    void (async () => {
      try {
        const existing = getHostByWsUrl(normalizedWsUrl);
        if (existing) {
          setCurrentHostId(existing.id);
        } else {
          const newHost = createDirectHost({
            wsUrl: normalizedWsUrl,
            srpUsername: normalizedUsername,
          });
          saveHost(newHost);
          setCurrentHostId(newHost.id);
        }
        await connect(
          normalizedWsUrl,
          normalizedUsername,
          normalizedPassword,
          true,
        );
      } catch {
        // connection error is surfaced by context/local state
      }
    })();
  }, [connect, isAutoResuming, setCurrentHostId]);

  // If auto-resume is in progress, show a loading screen
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    // Validate inputs
    if (!serverUrl.trim()) {
      setLocalError(t("directLoginErrorServerUrlRequired"));
      return;
    }

    if (!username.trim()) {
      setLocalError(t("directLoginErrorUsernameRequired"));
      return;
    }

    if (!password) {
      setLocalError(t("directLoginErrorPasswordRequired"));
      return;
    }

    // Normalize URL - ensure it's a WebSocket URL
    let wsUrl = serverUrl.trim();
    if (wsUrl.startsWith("http://")) {
      wsUrl = wsUrl.replace("http://", "ws://");
    } else if (wsUrl.startsWith("https://")) {
      wsUrl = wsUrl.replace("https://", "wss://");
    } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
      wsUrl = `ws://${wsUrl}`;
    }

    // Ensure /api/ws path
    if (!wsUrl.endsWith("/api/ws")) {
      wsUrl = `${wsUrl.replace(/\/$/, "")}/api/ws`;
    }

    try {
      let hostIdToRemember: string | null = null;
      if (rememberMe) {
        const existing = getHostByWsUrl(wsUrl);
        if (existing) {
          hostIdToRemember = existing.id;
        } else {
          const newHost = createDirectHost({
            wsUrl,
            srpUsername: username.trim(),
          });
          saveHost(newHost);
          hostIdToRemember = newHost.id;
        }
        setCurrentHostId(hostIdToRemember);
      }

      // If we have a stored session and credentials match, try to resume
      if (
        hasStoredSession &&
        rememberMe &&
        wsUrl === storedUrl &&
        username.trim() === storedUsername
      ) {
        await resumeSession(password);
      } else {
        await connect(wsUrl, username.trim(), password, rememberMe);
      }

      // Save host for quick reconnect (if rememberMe is enabled)
      if (rememberMe) {
        const existing = loadSavedHosts().hosts.find(
          (h) => h.mode === "direct" && h.wsUrl === wsUrl,
        );
        if (!existing) {
          const newHost = createDirectHost({
            wsUrl,
            srpUsername: username.trim(),
          });
          saveHost(newHost);
          if (!hostIdToRemember) {
            setCurrentHostId(newHost.id);
          }
        }
      }
      // On success, the RemoteApp will render the main app instead of login
    } catch {
      // Error is already set in context
    }
  };

  const displayError = localError ?? error;

  return (
    <div className="login-page">
      <div className="login-container">
        <Link to="/login" className="login-back-link">
          &larr; {t("actionBack")}
        </Link>

        <div className="login-logo">
          <AgentLineLogo />
        </div>
        <p className="login-subtitle">{t("directLoginTitle")}</p>

        <form
          onSubmit={handleSubmit}
          className="login-form"
          data-testid="login-form"
        >
          <div className="login-field">
            <label htmlFor="serverUrl">{t("directLoginServerUrl")}</label>
            <input
              id="serverUrl"
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="ws://localhost:3400/api/ws"
              disabled={isConnecting}
              autoComplete="url"
              data-testid="ws-url-input"
            />
            <p className="login-field-hint">{t("directLoginServerUrlHint")}</p>
          </div>

          <div className="login-field">
            <label htmlFor="username">{t("directLoginUsername")}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("directLoginUsernamePlaceholder")}
              disabled={isConnecting}
              autoComplete="username"
              data-testid="username-input"
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">{t("directLoginPassword")}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("directLoginPasswordPlaceholder")}
              disabled={isConnecting}
              autoComplete="current-password"
              data-testid="password-input"
            />
          </div>

          <div className="login-field login-field-checkbox">
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={isConnecting}
                data-testid="remember-me-checkbox"
              />
              <span>{t("directLoginRememberMe")}</span>
            </label>
            <p className="login-field-hint">
              {hasStoredSession
                ? t("directLoginResumeHint")
                : t("directLoginStayLoggedIn")}
            </p>
          </div>

          {displayError && (
            <div className="login-error" data-testid="login-error">
              {displayError}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={isConnecting}
            data-testid="login-button"
          >
            {isConnecting
              ? t("directLoginConnecting")
              : t("directLoginConnect")}
          </button>
        </form>

        <p className="login-hint">{t("directLoginHint")}</p>
      </div>
    </div>
  );
}
