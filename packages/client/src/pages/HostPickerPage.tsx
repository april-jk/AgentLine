import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLineLogo } from "../components/AgentLineLogo";
import { Modal } from "../components/ui/Modal";
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
import {
  type AccountDevice,
  clearAccount,
  fetchDevices,
  loadSavedAccount,
} from "./hostPickerShared";

interface RelayHashCredentials {
  relayUsername: string;
  accessPassword: string;
  relayUrl: string;
  clientGrant?: string;
}

function formatHeartbeatAgeText(ageMs?: number): string {
  if (typeof ageMs !== "number") return "未知";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h`;
}

type SavedAccessPasswordMap = Record<string, string>;

const DEVICE_ACCESS_PASSWORDS_STORAGE_KEY =
  "agentline.remote.device-access-passwords";

function parseRelayHashCredentials(
  clearHash = true,
): RelayHashCredentials | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;
  try {
    const params = new URLSearchParams(hash.slice(1));
    const relayUsername = params.get("u")?.trim().toLowerCase() ?? "";
    const accessPassword = params.get("p") ?? "";
    const relayUrl = params.get("r")?.trim() || "wss://relay.oneceo.ai/ws";
    const clientGrant = params.get("cg")?.trim() || undefined;
    if (!relayUsername || !accessPassword) return null;

    if (clearHash) {
      const cleanUrl = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", cleanUrl);
    }
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

function formatConnectError(message: string): string {
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

function isAccessPasswordError(message: string): boolean {
  return (
    message.includes("authentication failed") ||
    message.includes("Authentication failed") ||
    message.includes("invalid_identity")
  );
}

function loadSavedAccessPasswords(): SavedAccessPasswordMap {
  try {
    const raw = localStorage.getItem(DEVICE_ACCESS_PASSWORDS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedAccessPasswordMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function getSavedAccessPassword(relayUsername: string): string | null {
  const all = loadSavedAccessPasswords();
  const password = all[relayUsername];
  return typeof password === "string" && password.length > 0 ? password : null;
}

function setSavedAccessPassword(
  relayUsername: string,
  accessPassword: string,
): void {
  const all = loadSavedAccessPasswords();
  all[relayUsername] = accessPassword;
  localStorage.setItem(
    DEVICE_ACCESS_PASSWORDS_STORAGE_KEY,
    JSON.stringify(all),
  );
}

function removeSavedAccessPassword(relayUsername: string): void {
  const all = loadSavedAccessPasswords();
  if (!(relayUsername in all)) return;
  delete all[relayUsername];
  localStorage.setItem(
    DEVICE_ACCESS_PASSWORDS_STORAGE_KEY,
    JSON.stringify(all),
  );
}

export function HostPickerPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { connectViaRelay, isAutoResuming, setCurrentHostId } =
    useRemoteConnection();

  const [controlPlaneUrl, setControlPlaneUrl] = useState("");
  const [email, setEmail] = useState("");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(
    null,
  );
  const [relayStatus, setRelayStatus] = useState<
    RelayConnectionStatus | "idle"
  >("idle");
  const [passwordModalDeviceId, setPasswordModalDeviceId] = useState<
    string | null
  >(null);
  const [rememberAccessPassword, setRememberAccessPassword] = useState(true);
  const [accessPassword, setAccessPassword] = useState("");
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
  const passwordModalDevice = useMemo(
    () =>
      passwordModalDeviceId
        ? (devices.find((device) => device.id === passwordModalDeviceId) ??
          null)
        : null,
    [devices, passwordModalDeviceId],
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
    const hashCreds = parseRelayHashCredentials(false);

    if (!saved && !hashCreds) {
      navigate("/login", { replace: true });
      return;
    }

    if (saved) {
      setControlPlaneUrl(saved.controlPlaneUrl);
      setEmail(saved.email);
      setAccessToken(saved.accessToken);
      void loadDevices(saved.controlPlaneUrl, saved.accessToken).catch(() => {
        clearAccount();
        setAccessToken(null);
        if (!hashCreds) {
          navigate("/login", { replace: true });
        }
      });
    }
  }, [loadDevices, navigate]);

  const connectToRelayHost = useCallback(
    async (params: {
      relayUsername: string;
      relayUrl: string;
      deviceId?: string;
      accessPassword?: string;
      clientGrant?: string;
      controlPlaneBaseUrl?: string;
      fromSavedPassword?: boolean;
    }): Promise<boolean> => {
      const relayUsername = params.relayUsername.trim().toLowerCase();
      if (!relayUsername) {
        setError("Device route is missing.");
        return false;
      }
      const selectedDevice =
        params.deviceId && devices.length > 0
          ? (devices.find((item) => item.id === params.deviceId) ?? null)
          : null;
      const isHeartbeatOffline =
        selectedDevice?.machine?.heartbeat?.offline === true;
      const relayOffline =
        selectedDevice?.relayState === "offline" || isHeartbeatOffline;
      if (relayOffline) {
        const ageMs = selectedDevice?.machine?.heartbeat?.ageMs;
        setError(
          `Selected device is offline (${formatHeartbeatAgeText(ageMs)} since last heartbeat). Keep desktop AgentLine logged in and online, then refresh devices.`,
        );
        return false;
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
              controlPlaneUrl: params.controlPlaneBaseUrl ?? controlPlaneUrl,
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
        setPasswordModalDeviceId(null);
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
        if (params.fromSavedPassword && isAccessPasswordError(message)) {
          removeSavedAccessPassword(relayUsername);
          if (params.deviceId) {
            setPasswordModalDeviceId(params.deviceId);
            setRememberAccessPassword(true);
          }
          setAccessPassword("");
          setError(
            "Saved access password is no longer valid. Please re-enter it.",
          );
          setRelayStatus("idle");
          setConnectingDeviceId(null);
          return false;
        }
        setError(formatConnectError(message));
        setRelayStatus("error");
        setConnectingDeviceId(null);
        return false;
      }
      return true;
    },
    [connectViaRelay, controlPlaneUrl, devices, navigate, setCurrentHostId],
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
      controlPlaneBaseUrl: controlPlaneUrl,
    });
  }, [connectToRelayHost, controlPlaneUrl, isAutoResuming]);

  const handleSelectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setPasswordModalDeviceId(null);
    setAccessPassword("");
  };

  const handleLogout = () => {
    clearAccount();
    setAccessToken(null);
    setDevices([]);
    setSelectedDeviceId(null);
    setPasswordModalDeviceId(null);
    setAccessPassword("");
    navigate("/login", { replace: true });
  };

  const handleConnectSelected = () => {
    if (!selectedDevice) {
      setError("Please choose a device first.");
      return;
    }

    if (selectedSavedHost?.session) {
      void connectToRelayHost({
        relayUsername: selectedDevice.relayUsername,
        relayUrl: deriveRelayWsUrl(controlPlaneUrl),
        deviceId: selectedDevice.id,
      });
      return;
    }

    const savedAccessPassword = getSavedAccessPassword(
      selectedDevice.relayUsername,
    );
    if (savedAccessPassword) {
      void connectToRelayHost({
        relayUsername: selectedDevice.relayUsername,
        relayUrl: deriveRelayWsUrl(controlPlaneUrl),
        deviceId: selectedDevice.id,
        accessPassword: savedAccessPassword,
        fromSavedPassword: true,
      });
      return;
    }

    setPasswordModalDeviceId(selectedDevice.id);
    setRememberAccessPassword(true);
    setAccessPassword("");
    setError(null);
  };

  const handleConfirmPasswordConnect = () => {
    if (!passwordModalDevice) return;
    const password = accessPassword;
    const shouldRemember = rememberAccessPassword;
    const relayUsername = passwordModalDevice.relayUsername;
    const relayUrl = deriveRelayWsUrl(controlPlaneUrl);
    const deviceId = passwordModalDevice.id;

    setPasswordModalDeviceId(null);

    void (async () => {
      const ok = await connectToRelayHost({
        relayUsername,
        relayUrl,
        deviceId,
        accessPassword: password,
      });
      if (ok && shouldRemember) {
        setSavedAccessPassword(relayUsername, password);
      }
    })();
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
            Connected account: {email || "(QR mode)"}
          </p>
        </div>

        {error ? (
          <div className="login-error" data-testid="host-picker-error">
            {error}
          </div>
        ) : null}

        <section className="host-picker-panel">
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
                    onClick={() => handleSelectDevice(device.id)}
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
                      <span className="host-picker-last-connected">
                        hb{" "}
                        {formatHeartbeatAgeText(
                          device.machine?.heartbeat?.ageMs,
                        )}
                        {device.machine?.heartbeat?.offline ? " (offline)" : ""}
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
                !selectedDevice || loadingDevices || connectingDeviceId !== null
              }
            >
              Connect Selected Device
            </button>

            {accessToken ? (
              <button
                type="button"
                className="login-advanced-toggle"
                onClick={handleLogout}
                disabled={connectingDeviceId !== null}
              >
                Logout
              </button>
            ) : null}
          </div>
        </section>
      </div>
      {passwordModalDevice ? (
        <Modal
          title={`Access Password · ${passwordModalDevice.deviceName}`}
          onClose={() => {
            if (connectingDeviceId) return;
            setPasswordModalDeviceId(null);
          }}
        >
          <div className="login-field">
            <label htmlFor="deviceAccessPassword">Access Password</label>
            <input
              id="deviceAccessPassword"
              type="password"
              value={accessPassword}
              onChange={(event) => setAccessPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Enter desktop access password"
              disabled={connectingDeviceId !== null}
            />
          </div>
          <div className="login-field login-field-checkbox">
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                checked={rememberAccessPassword}
                onChange={(event) =>
                  setRememberAccessPassword(event.target.checked)
                }
                disabled={connectingDeviceId !== null}
              />
              <span>Save on this phone</span>
            </label>
          </div>
          <div className="host-offline-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirmPasswordConnect}
              disabled={!accessPassword || connectingDeviceId !== null}
            >
              Connect
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
