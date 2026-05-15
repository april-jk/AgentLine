/**
 * RelayLoginPage - Login form for remote access via relay server.
 *
 * Connects to a relay server first, which pairs the client with a agentline
 * server by username. After pairing, SRP authentication proceeds through the relay.
 */

import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { useRemoteConnection } from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import {
  createRelayHost,
  getHostByRelayUsername,
  saveHost,
} from "../lib/hostStorage";
import { requestClientConnectGrant } from "../lib/relayGrants";

/**
 * Parse credentials from URL hash for auto-login via QR code.
 * Hash format: #u=username&p=password&r=relay_url&cg=client_grant
 * (r and cg are optional).
 * Clears the hash after reading for security.
 */
function parseHashCredentials(): {
  username: string;
  password: string;
  relayUrl: string;
  clientGrant?: string;
} | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  try {
    const params = new URLSearchParams(hash.slice(1));
    const username = params.get("u");
    const password = params.get("p");
    const relayUrl = params.get("r") ?? "";
    const clientGrant = params.get("cg") ?? undefined;

    if (username && password) {
      // Clear hash from URL for security (don't leave password in history)
      // Keep search params (mobile_entry, relay username hints, etc.).
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      return { username, password, relayUrl, clientGrant };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

function parseNativeBootstrapCredentials(): {
  username: string;
  password: string;
  relayUrl: string;
  clientGrant?: string;
} | null {
  try {
    const payload = (
      window as unknown as {
        __AGENTLINE_NATIVE_BOOTSTRAP__?: {
          relay?: {
            relayUrl?: string;
            relayUsername?: string;
            relayPassword?: string;
            relayClientGrant?: string;
          };
        };
      }
    ).__AGENTLINE_NATIVE_BOOTSTRAP__;
    const relay = payload?.relay;
    const username = relay?.relayUsername?.trim().toLowerCase() ?? "";
    const password = relay?.relayPassword ?? "";
    const relayUrl = relay?.relayUrl?.trim() || "";
    const clientGrant = relay?.relayClientGrant?.trim() || undefined;
    if (!username || !password) return null;
    return { username, password, relayUrl, clientGrant };
  } catch {
    return null;
  }
}

/** Default relay URL */
const DEFAULT_RELAY_URL = "wss://relay.oneceo.ai/ws";

type ConnectionStatus =
  | "idle"
  | "connecting_relay"
  | "waiting_server"
  | "authenticating"
  | "error";

export function RelayLoginPage() {
  const { t } = useI18n();
  const location = useLocation();
  const locationState =
    (location.state as
      | {
          relayUsername?: string;
          relayUrl?: string;
          controlPlaneUrl?: string;
          deviceId?: string;
          lockRelayUsername?: boolean;
          deviceName?: string;
        }
      | undefined) ?? {};
  const { connectViaRelay, isAutoResuming, setCurrentHostId } =
    useRemoteConnection();
  const [searchParams] = useSearchParams();

  // Form state - relay username is also used as SRP identity
  // Pre-fill from query parameters: ?u=username&r=relay-url
  const initialRelayUrl = locationState.relayUrl ?? searchParams.get("r") ?? "";
  const lockRelayUsername = locationState.lockRelayUsername === true;
  const selectedDeviceName = locationState.deviceName;
  const selectedDeviceId = locationState.deviceId;
  const selectedControlPlaneUrl = locationState.controlPlaneUrl;
  const [relayUsername, setRelayUsername] = useState(
    () => locationState.relayUsername ?? searchParams.get("u") ?? "",
  );
  const [srpPassword, setSrpPassword] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(
    !lockRelayUsername && !!initialRelayUrl,
  );
  const [customRelayUrl, setCustomRelayUrl] = useState(initialRelayUrl);
  const [rememberMe, setRememberMe] = useState(true);

  // Connection state
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-login from hash credentials (QR code scan)
  const autoLoginAttempted = useRef(false);
  useEffect(() => {
    if (autoLoginAttempted.current || isAutoResuming) return;
    autoLoginAttempted.current = true;

    const hashCreds = parseHashCredentials();
    const bootstrapCreds = hashCreds ? null : parseNativeBootstrapCredentials();
    const resolvedCreds = hashCreds ?? bootstrapCreds;
    console.log("[RelayLoginPage] Auto-login credential source:", {
      source: hashCreds ? "hash" : bootstrapCreds ? "native_bootstrap" : "none",
      hasHash: Boolean(window.location.hash),
      search: window.location.search,
    });
    if (!resolvedCreds) return;

    const { username, password, relayUrl, clientGrant } = resolvedCreds;
    const effectiveRelayUrl = relayUrl || DEFAULT_RELAY_URL;

    // Get or create host BEFORE connecting so handleSessionEstablished can sync session
    let host = getHostByRelayUsername(username);
    if (!host) {
      host = createRelayHost({
        relayUrl: effectiveRelayUrl,
        relayUsername: username,
        srpUsername: username,
      });
      saveHost(host);
    }
    // Set currentHostId before connect so the session callback can use it
    setCurrentHostId(host.id);

    setStatus("connecting_relay");
    const grantPromise = clientGrant?.trim()
      ? Promise.resolve({
          grant: clientGrant.trim(),
          relayUsername: username,
        })
      : requestClientConnectGrant({ relayUsername: username });

    grantPromise
      .then((grantPayload) =>
        connectViaRelay({
          relayUrl: effectiveRelayUrl,
          relayUsername: grantPayload.relayUsername,
          srpUsername: username,
          srpPassword: password,
          rememberMe: true,
          onStatusChange: setStatus,
          clientGrant: grantPayload.grant,
        }),
      )
      .then(() => {
        // Host already saved and currentHostId already set
      })
      .catch((err) => {
        const message =
          err instanceof Error
            ? err.message
            : t("relayLoginErrorConnectionFailed");
        setError(formatRelayError(message, t));
        setStatus("error");
        // Pre-fill form with credentials from hash so user can retry
        setRelayUsername(username);
        if (relayUrl) {
          setCustomRelayUrl(relayUrl);
          setShowAdvanced(true);
        }
      });
  }, [connectViaRelay, isAutoResuming, setCurrentHostId, t]);

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
    setError(null);

    // Validate inputs
    if (!relayUsername.trim()) {
      setError(t("relayLoginErrorUsernameRequired"));
      return;
    }

    if (!srpPassword) {
      setError(t("relayLoginErrorPasswordRequired"));
      return;
    }

    const relayUrl = customRelayUrl.trim() || DEFAULT_RELAY_URL;
    const username = relayUsername.trim().toLowerCase();

    // Get or create host BEFORE connecting so handleSessionEstablished can sync session
    if (rememberMe) {
      let host = getHostByRelayUsername(username);
      if (!host) {
        host = createRelayHost({
          relayUrl,
          relayUsername: username,
          srpUsername: username,
        });
        saveHost(host);
      }
      // Set currentHostId before connect so the session callback can use it
      setCurrentHostId(host.id);
    }

    try {
      const grantPayload = await requestClientConnectGrant({
        relayUsername: username,
        deviceId: selectedDeviceId,
        controlPlaneUrl: selectedControlPlaneUrl,
      });
      await connectViaRelay({
        relayUrl,
        relayUsername: grantPayload.relayUsername,
        // Use relay username as SRP identity
        srpUsername: username,
        srpPassword,
        rememberMe,
        onStatusChange: setStatus,
        clientGrant: grantPayload.grant,
      });
      // On success, the RemoteApp will render the main app instead of login
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("relayLoginErrorConnectionFailed");
      setError(formatRelayError(message, t));
      setStatus("error");
    }
  };

  const isConnecting = status !== "idle" && status !== "error";
  const statusMessage = getStatusMessage(status, t);

  return (
    <div className="login-page">
      <div className="login-container">
        <Link to="/login" className="login-back-link">
          &larr; {t("actionBack")}
        </Link>

        <div className="login-logo">
          <AgentLineLogo />
        </div>
        <p className="login-subtitle">{t("relayLoginTitle")}</p>
        {lockRelayUsername ? (
          <p className="login-hint">
            {selectedDeviceName
              ? `Machine: ${selectedDeviceName}`
              : "Machine selected from your account"}
          </p>
        ) : null}

        <form
          onSubmit={handleSubmit}
          className="login-form"
          data-testid="relay-login-form"
        >
          <div className="login-field">
            <label htmlFor="relayUsername">{t("relayLoginUsername")}</label>
            {lockRelayUsername ? (
              <input
                id="relayUsername"
                type="text"
                value={relayUsername}
                disabled
                data-testid="relay-username-input"
              />
            ) : (
              <>
                <input
                  id="relayUsername"
                  type="text"
                  value={relayUsername}
                  onChange={(e) => setRelayUsername(e.target.value)}
                  placeholder={t("relayLoginUsernamePlaceholder")}
                  disabled={isConnecting}
                  autoComplete="username"
                  autoCapitalize="none"
                  data-testid="relay-username-input"
                />
                <p className="login-field-hint">
                  {t("relayLoginUsernameHint")}
                </p>
              </>
            )}
          </div>

          <div className="login-field">
            <label htmlFor="srpPassword">{t("relayLoginPassword")}</label>
            <input
              id="srpPassword"
              type="password"
              value={srpPassword}
              onChange={(e) => setSrpPassword(e.target.value)}
              placeholder={t("relayLoginPasswordPlaceholder")}
              disabled={isConnecting}
              autoComplete="current-password"
              data-testid="srp-password-input"
            />
            {lockRelayUsername ? (
              <p className="login-field-hint">
                Enter the desktop access password configured on that machine.
              </p>
            ) : null}
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
              <span>{t("relayLoginRememberMe")}</span>
            </label>
          </div>

          {!lockRelayUsername ? (
            <button
              type="button"
              className="login-advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
              disabled={isConnecting}
            >
              {showAdvanced
                ? t("relayLoginHideAdvanced")
                : t("relayLoginShowAdvanced")}
            </button>
          ) : null}

          {!lockRelayUsername && showAdvanced ? (
            <div className="login-field">
              <label htmlFor="customRelayUrl">
                {t("relayLoginCustomRelayUrl")}
              </label>
              <input
                id="customRelayUrl"
                type="text"
                value={customRelayUrl}
                onChange={(e) => setCustomRelayUrl(e.target.value)}
                placeholder={DEFAULT_RELAY_URL}
                disabled={isConnecting}
                data-testid="custom-relay-url-input"
              />
              <p className="login-field-hint">
                {t("relayLoginCustomRelayUrlHint")}
              </p>
            </div>
          ) : null}

          {error && (
            <div className="login-error" data-testid="login-error">
              {error}
            </div>
          )}

          {isConnecting && statusMessage && (
            <div className="login-status" data-testid="connection-status">
              <div className="login-spinner" />
              <span>{statusMessage}</span>
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={isConnecting}
            data-testid="login-button"
          >
            {isConnecting ? t("relayLoginConnecting") : t("relayLoginConnect")}
          </button>
        </form>

        <p className="login-hint">{t("relayLoginHint")}</p>
      </div>
    </div>
  );
}

function getStatusMessage(
  status: ConnectionStatus,
  t: (key: never) => string,
): string | null {
  switch (status) {
    case "connecting_relay":
      return t("relayLoginStatusConnectingRelay" as never);
    case "waiting_server":
      return t("relayLoginStatusWaitingServer" as never);
    case "authenticating":
      return t("relayLoginStatusAuthenticating" as never);
    default:
      return null;
  }
}

function formatRelayError(message: string, t: (key: never) => string): string {
  if (
    message.includes("account_auth_required") ||
    message.includes("unauthorized") ||
    message.includes("grant_request_failed_401")
  ) {
    return "Account login required. Please sign in from the host picker first.";
  }
  if (message.includes("auth_required")) {
    return "Relay authorization is required for this host. Please log in again.";
  }
  if (
    message.includes("grant_invalid") ||
    message.includes("grant_expired") ||
    message.includes("grant_consumed")
  ) {
    return "Relay authorization expired. Please retry the connection.";
  }
  if (message.includes("server_offline")) {
    return t("relayLoginErrorServerOffline" as never);
  }
  if (message.includes("unknown_username")) {
    return t("relayLoginErrorUnknownUsername" as never);
  }
  if (
    message.includes("Authentication failed") ||
    message.includes("invalid_identity")
  ) {
    return t("relayLoginErrorInvalidCredentials" as never);
  }
  return message;
}
