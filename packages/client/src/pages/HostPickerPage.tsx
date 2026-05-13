import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import {
  type RelayConnectionStatus,
  useRemoteConnection,
} from "../contexts/RemoteConnectionContext";
import { useI18n } from "../i18n";
import { getHostByRelayUsername, upsertRelayHost } from "../lib/hostStorage";
import {
  deriveRelayWsUrl,
  requestClientConnectGrant,
} from "../lib/relayGrants";

type AccountMode = "login" | "register";

interface AccountUser {
  id: string;
  email: string;
}

interface AccountAuthResponse {
  accessToken: string;
  expiresAt: string;
  user: AccountUser;
}

interface AccountDevice {
  id: string;
  relayUsername: string;
  deviceName: string;
  deviceType: string;
  relayState: "offline" | "waiting" | "paired";
}

const DEFAULT_CONTROL_PLANE_URL = "https://relay.oneceo.ai";
const ACCOUNT_STORAGE_KEY = "agentline.remote.account";

interface RelayHashCredentials {
  relayUsername: string;
  accessPassword: string;
  relayUrl: string;
  clientGrant?: string;
}

function parseRelayHashCredentials(): RelayHashCredentials | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  try {
    const params = new URLSearchParams(hash.slice(1));
    const relayUsername = params.get("u")?.trim().toLowerCase() ?? "";
    const accessPassword = params.get("p") ?? "";
    const relayUrl = params.get("r")?.trim() || "wss://relay.oneceo.ai/ws";
    const clientGrant = params.get("cg")?.trim() || undefined;
    if (!relayUsername || !accessPassword) return null;

    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);
    return {
      relayUsername,
      accessPassword,
      relayUrl,
      clientGrant,
    };
  } catch {
    return null;
  }
}

function formatHostPickerConnectError(message: string): string {
  if (message.includes("access_password_required")) {
    return "Please enter the device access password.";
  }
  if (
    message.includes("account_auth_required") ||
    message.includes("grant_request_failed_401") ||
    message.includes("unauthorized")
  ) {
    return "Account authorization expired. Please sign in again.";
  }
  if (
    message.includes("grant_invalid") ||
    message.includes("grant_expired") ||
    message.includes("grant_consumed") ||
    message.includes("auth_required")
  ) {
    return "Relay authorization failed. Please retry.";
  }
  if (
    message.includes("authentication failed") ||
    message.includes("Authentication failed") ||
    message.includes("invalid_identity")
  ) {
    return "Access password incorrect. Please retry.";
  }
  if (message.includes("server_offline")) {
    return "Selected device is offline.";
  }
  if (message.includes("unknown_username")) {
    return "Selected device route is unavailable.";
  }
  if (message.includes("waiting for server timed out")) {
    return "Timed out while waiting for the device to accept connection.";
  }
  return message;
}

function getRelayStatusText(status: RelayConnectionStatus | "idle"): string {
  switch (status) {
    case "connecting_relay":
      return "Connecting to relay...";
    case "waiting_server":
      return "Waiting for selected device...";
    case "authenticating":
      return "Verifying access password...";
    case "error":
      return "Connection failed.";
    default:
      return "Connecting...";
  }
}

function loadSavedAccount(): {
  controlPlaneUrl: string;
  accessToken: string;
  email: string;
} | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      controlPlaneUrl?: string;
      accessToken?: string;
      email?: string;
    };
    if (!parsed.controlPlaneUrl || !parsed.accessToken || !parsed.email) {
      return null;
    }
    return {
      controlPlaneUrl: parsed.controlPlaneUrl,
      accessToken: parsed.accessToken,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

function saveAccount(params: {
  controlPlaneUrl: string;
  accessToken: string;
  email: string;
}): void {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(params));
}

function clearAccount(): void {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let message = `request_failed_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // ignore non-json response
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function authenticateAccount(
  baseUrl: string,
  mode: AccountMode,
  email: string,
  password: string,
): Promise<AccountAuthResponse> {
  if (mode === "register") {
    await requestJson<{ user: AccountUser }>(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  return requestJson<AccountAuthResponse>(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function fetchDevices(
  baseUrl: string,
  accessToken: string,
): Promise<AccountDevice[]> {
  const payload = await requestJson<{ devices: AccountDevice[] }>(
    baseUrl,
    "/api/v1/devices",
    { method: "GET" },
    accessToken,
  );
  return payload.devices ?? [];
}

export function HostPickerPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { connectViaRelay, isAutoResuming, setCurrentHostId } =
    useRemoteConnection();
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [controlPlaneUrl, setControlPlaneUrl] = useState(
    DEFAULT_CONTROL_PLANE_URL,
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accessPassword, setAccessPassword] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(
    null,
  );
  const [relayStatus, setRelayStatus] = useState<
    RelayConnectionStatus | "idle"
  >("idle");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hashAutoConnectAttempted = useRef(false);

  const selectedDevice = useMemo(
    () => devices.find((item) => item.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const selectedSavedHost = useMemo(
    () =>
      selectedDevice
        ? (getHostByRelayUsername(selectedDevice.relayUsername) ?? null)
        : null,
    [selectedDevice],
  );

  const loadDevices = useCallback(async (baseUrl: string, token: string) => {
    setLoadingDevices(true);
    setError(null);
    try {
      const nextDevices = await fetchDevices(baseUrl, token);
      setDevices(nextDevices);
      setSelectedDeviceId(nextDevices[0]?.id ?? null);
    } catch (e) {
      setDevices([]);
      setSelectedDeviceId(null);
      setError(e instanceof Error ? e.message : "Failed to load devices");
      throw e;
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    const saved = loadSavedAccount();
    if (!saved) return;

    setControlPlaneUrl(saved.controlPlaneUrl);
    setEmail(saved.email);
    setAccessToken(saved.accessToken);
    void loadDevices(saved.controlPlaneUrl, saved.accessToken).catch(() => {
      clearAccount();
      setAccessToken(null);
    });
  }, [loadDevices]);

  const connectToRelayHost = useCallback(
    async (params: {
      relayUsername: string;
      relayUrl: string;
      deviceId?: string;
      accessPassword?: string;
      clientGrant?: string;
    }) => {
      const relayUsername = params.relayUsername.trim().toLowerCase();
      if (!relayUsername) {
        setError("Device route is missing.");
        return;
      }

      const relayUrl =
        params.relayUrl.trim() || deriveRelayWsUrl(controlPlaneUrl);
      const savedHost = upsertRelayHost({
        relayUrl,
        relayUsername,
        srpUsername: relayUsername,
      });

      setCurrentHostId(savedHost.id);
      setConnectingDeviceId(params.deviceId ?? savedHost.id);
      setRelayStatus("connecting_relay");
      setError(null);

      try {
        const grantPayload = params.clientGrant?.trim()
          ? { grant: params.clientGrant.trim(), relayUsername }
          : await requestClientConnectGrant({
              relayUsername,
              deviceId: params.deviceId,
              controlPlaneUrl,
            });

        const passwordForConnect = params.accessPassword ?? "";
        const useSavedSession =
          Boolean(savedHost.session) && !passwordForConnect;
        if (!useSavedSession && !passwordForConnect) {
          throw new Error("access_password_required");
        }

        await connectViaRelay({
          relayUrl,
          relayUsername: grantPayload.relayUsername,
          srpUsername: relayUsername,
          srpPassword: useSavedSession ? "" : passwordForConnect,
          rememberMe: true,
          session: useSavedSession ? savedHost.session : undefined,
          clientGrant: grantPayload.grant,
          onStatusChange: setRelayStatus,
        });

        setAccessPassword("");
        setRelayStatus("idle");
        setConnectingDeviceId(null);
        navigate(
          `/${encodeURIComponent(grantPayload.relayUsername)}/projects`,
          {
            replace: true,
          },
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Connection failed";
        setError(formatHostPickerConnectError(message));
        setRelayStatus("error");
        setConnectingDeviceId(null);
      }
    },
    [connectViaRelay, controlPlaneUrl, navigate, setCurrentHostId],
  );

  useEffect(() => {
    if (hashAutoConnectAttempted.current || isAutoResuming) return;
    hashAutoConnectAttempted.current = true;

    const hashCreds = parseRelayHashCredentials();
    if (!hashCreds) return;

    void connectToRelayHost({
      relayUsername: hashCreds.relayUsername,
      relayUrl: hashCreds.relayUrl,
      accessPassword: hashCreds.accessPassword,
      clientGrant: hashCreds.clientGrant,
    });
  }, [connectToRelayHost, isAutoResuming]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await authenticateAccount(
        controlPlaneUrl,
        accountMode,
        email.trim(),
        password,
      );
      setAccessToken(result.accessToken);
      saveAccount({
        controlPlaneUrl: controlPlaneUrl.trim(),
        accessToken: result.accessToken,
        email: email.trim(),
      });
      setPassword("");
      await loadDevices(controlPlaneUrl, result.accessToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    clearAccount();
    setAccessToken(null);
    setDevices([]);
    setSelectedDeviceId(null);
    setPassword("");
  };

  const handleConnectSelected = () => {
    if (!selectedDevice) {
      setError("Please choose a device first.");
      return;
    }
    void connectToRelayHost({
      relayUsername: selectedDevice.relayUsername,
      relayUrl: deriveRelayWsUrl(controlPlaneUrl),
      deviceId: selectedDevice.id,
      accessPassword,
    });
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
            Platform account sign-in
          </p>
        </div>

        {error ? (
          <div className="login-error" data-testid="host-picker-error">
            {error}
          </div>
        ) : null}

        <section className="host-picker-panel">
          <form onSubmit={handleAuth} className="login-form">
            <div className="login-field">
              <label htmlFor="controlPlaneUrl">Control Plane URL</label>
              <input
                id="controlPlaneUrl"
                type="text"
                value={controlPlaneUrl}
                onChange={(event) => setControlPlaneUrl(event.target.value)}
                placeholder={DEFAULT_CONTROL_PLANE_URL}
                disabled={loading || loadingDevices}
              />
            </div>
            <div className="host-picker-mode-switch">
              <button
                type="button"
                className={`host-picker-mode-tab ${accountMode === "login" ? "host-picker-mode-tab-active" : ""}`}
                onClick={() => setAccountMode("login")}
                disabled={loading || loadingDevices}
              >
                Login
              </button>
              <button
                type="button"
                className={`host-picker-mode-tab ${accountMode === "register" ? "host-picker-mode-tab-active" : ""}`}
                onClick={() => setAccountMode("register")}
                disabled={loading || loadingDevices}
              >
                Register
              </button>
            </div>
            <div className="login-field">
              <label htmlFor="accountEmail">Email</label>
              <input
                id="accountEmail"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
                placeholder="you@example.com"
                disabled={loading || loadingDevices}
              />
            </div>
            <div className="login-field">
              <label htmlFor="accountPassword">Password</label>
              <input
                id="accountPassword"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  accountMode === "register"
                    ? "new-password"
                    : "current-password"
                }
                placeholder="your account password"
                disabled={loading || loadingDevices}
              />
            </div>
            <button
              type="submit"
              className="login-button"
              disabled={loading || loadingDevices}
            >
              {loading
                ? "Submitting..."
                : accountMode === "register"
                  ? "Register & Login"
                  : "Login"}
            </button>
            {accessToken ? (
              <button
                type="button"
                className="login-advanced-toggle"
                onClick={handleLogout}
                disabled={loading || loadingDevices}
              >
                Logout
              </button>
            ) : null}
          </form>

          {accessToken ? (
            <div className="host-picker-list" data-testid="account-device-list">
              <p className="login-hint">Choose one machine to continue:</p>
              {loadingDevices ? (
                <div className="login-status">
                  <div className="login-spinner" />
                  <span>Loading devices...</span>
                </div>
              ) : devices.length === 0 ? (
                <p className="login-hint">
                  No bound machine found in this account yet.
                </p>
              ) : (
                devices.map((device) => {
                  const selected = selectedDeviceId === device.id;
                  return (
                    <button
                      type="button"
                      key={device.id}
                      className="host-picker-item"
                      onClick={() => setSelectedDeviceId(device.id)}
                      data-testid={`device-${device.id}`}
                    >
                      <div className="host-picker-item-main">
                        <span
                          className={`host-picker-status host-picker-status-${device.relayState === "offline" ? "offline" : "online"}`}
                        />
                        <span className="host-picker-name">
                          {device.deviceName}
                        </span>
                        <span className="host-picker-mode">
                          {device.deviceType}
                        </span>
                      </div>
                      <div className="host-picker-item-meta">
                        <span className="host-picker-last-connected">
                          {device.relayUsername}
                        </span>
                        <span className="host-picker-last-connected">
                          {device.relayState}
                        </span>
                      </div>
                      {selected ? (
                        <div className="host-picker-connecting">
                          <span>Selected</span>
                        </div>
                      ) : null}
                    </button>
                  );
                })
              )}
              {selectedDevice ? (
                <div className="login-field">
                  <label htmlFor="deviceAccessPassword">
                    Access Password (hidden when session is valid)
                  </label>
                  <input
                    id="deviceAccessPassword"
                    type="password"
                    value={accessPassword}
                    onChange={(event) => setAccessPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder={
                      selectedSavedHost?.session
                        ? "Optional fallback when stored session expires"
                        : "Enter desktop access password"
                    }
                    disabled={loadingDevices || connectingDeviceId !== null}
                  />
                  {selectedSavedHost?.session ? (
                    <p className="login-hint">
                      Stored session detected for this device. You can connect
                      directly.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {connectingDeviceId ? (
                <div className="login-status">
                  <div className="login-spinner" />
                  <span>{getRelayStatusText(relayStatus)}</span>
                </div>
              ) : null}
              <button
                type="button"
                className="login-button host-picker-add-button"
                onClick={handleConnectSelected}
                disabled={
                  !selectedDevice ||
                  loadingDevices ||
                  connectingDeviceId !== null ||
                  (!selectedSavedHost?.session && !accessPassword)
                }
              >
                Connect Selected Device
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="login-advanced-toggle"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            {showAdvanced
              ? "Hide advanced connection"
              : "Show advanced connection"}
          </button>
          {showAdvanced ? (
            <div className="host-picker-list">
              <button
                type="button"
                className="login-button host-picker-add-button"
                onClick={() => navigate("/login/direct")}
              >
                Direct connection (advanced)
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
