import { useEffect, useMemo, useState } from "react";
import { DEFAULT_DESKTOP_DISCOVERY_PORT } from "../common/desktopDiscovery";

type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";
type AccountMode = "login" | "register";

interface ServerStatus {
  state: ServerState;
  pid: number | null;
  port: number;
  message?: string;
  startedAt?: number;
}

interface ServerRuntimeState {
  backendReachable: boolean;
  autoRecoverCount: number;
  lastRecoverAt?: number;
  lastRecoverReason?: string;
  lastRecoverError?: string;
  recovering: boolean;
}

interface ControlPlaneBridgeState {
  enabled: boolean;
  running: boolean;
  pausedReason?: string;
  deviceId?: string;
  relayUsername?: string;
  lastSyncAt?: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

interface RemoteAccessConfig {
  enabled: boolean;
  username: string | null;
  hostAccessConfigured: boolean;
}

const stateLabel: Record<ServerState, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  error: "Error",
};

const stateClass: Record<ServerState, string> = {
  stopped: "dot stopped",
  starting: "dot starting",
  running: "dot running",
  stopping: "dot starting",
  error: "dot error",
};

const DEFAULT_CONTROL_PLANE_BASE_URL = "https://relay.oneceo.ai";

const CONTROL_PLANE_ERROR_LABELS: Record<string, string> = {
  control_plane_base_url_required: "请输入平台地址（Control Plane URL）。",
  control_plane_base_url_invalid: "平台地址格式无效，请检查 URL。",
  control_plane_base_url_invalid_protocol:
    "平台地址协议无效，仅支持 http:// 或 https://。",
  control_plane_dns_unresolved: "无法解析平台域名，请检查网络或 DNS 配置。",
  control_plane_connection_refused:
    "平台服务拒绝连接，请确认服务地址和端口是否正确。",
  control_plane_connection_reset: "连接被重置，请稍后重试。",
  control_plane_request_timeout:
    "连接平台超时（5 秒），请检查网络连通性或稍后重试。",
  control_plane_tls_error:
    "平台 TLS 证书校验失败，请检查 HTTPS 证书配置。",
  control_plane_network_unreachable: "网络不可达，请检查当前网络连接。",
  control_plane_fetch_failed:
    "请求平台失败，请检查平台地址、网络和证书配置。",
  fetch_failed:
    "请求失败，请检查平台地址、网络和证书配置。",
};

function toDisplayError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Control-plane account authentication failed";
  }

  const code = error.message.trim();
  if (Object.prototype.hasOwnProperty.call(CONTROL_PLANE_ERROR_LABELS, code)) {
    return CONTROL_PLANE_ERROR_LABELS[code] ?? code;
  }

  const normalized = code.toLowerCase();
  if (normalized === "failed to fetch" || normalized === "fetch failed") {
    return CONTROL_PLANE_ERROR_LABELS.fetch_failed ?? code;
  }

  return code;
}

export function App() {
  const desktopApi = window.desktopApi;
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [runtime, setRuntime] = useState<ServerRuntimeState | null>(null);
  const [bridgeState, setBridgeState] =
    useState<ControlPlaneBridgeState | null>(null);
  const [remoteAccessConfig, setRemoteAccessConfig] =
    useState<RemoteAccessConfig | null>(null);
  const [controlPlaneBaseUrl, setControlPlaneBaseUrl] = useState(
    DEFAULT_CONTROL_PLANE_BASE_URL,
  );
  const [controlPlaneEmail, setControlPlaneEmail] = useState("");
  const [controlPlanePassword, setControlPlanePassword] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("login");
  const [controlPlaneConfigured, setControlPlaneConfigured] = useState(false);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessPasswordConfirm, setAccessPasswordConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopApi) {
      setError(
        "Desktop bridge is unavailable (window.desktopApi is undefined). Please restart the app.",
      );
      return;
    }

    let mounted = true;
    const loadControlPlane = async () => {
      const config = await desktopApi.getControlPlaneConfig();
      const nextBridgeState =
        (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState;
      const nextRemoteAccess = await desktopApi.getRemoteAccessConfig();
      if (!mounted) return;

      setControlPlaneBaseUrl(config.baseUrl ?? DEFAULT_CONTROL_PLANE_BASE_URL);
      setControlPlaneEmail(config.lastEmail ?? "");
      setControlPlaneConfigured(config.hasAccessToken);
      setBridgeState(nextBridgeState);
      setRemoteAccessConfig(nextRemoteAccess);
    };

    const load = async () => {
      try {
        const currentStatus = await desktopApi.getServerStatus();
        const currentRuntime = await desktopApi.getServerRuntimeState();
        await loadControlPlane();
        if (mounted) {
          setStatus(currentStatus);
          setRuntime(currentRuntime);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : "Failed to fetch status");
        }
      }
    };

    void load();
    const runtimeTimer = setInterval(() => {
      void (async () => {
        try {
          const [currentRuntime, currentBridgeState, currentRemoteAccess] =
            await Promise.all([
              desktopApi.getServerRuntimeState(),
              desktopApi.getControlPlaneStatus(),
              desktopApi.getRemoteAccessConfig(),
            ]);
          if (mounted) {
            setRuntime(currentRuntime);
            setBridgeState(currentBridgeState as ControlPlaneBridgeState);
            setRemoteAccessConfig(currentRemoteAccess);
          }
        } catch {
          // ignore refresh errors
        }
      })();
    }, 3000);

    const unsubscribe = desktopApi.onServerStatusChange((nextStatus) => {
      if (mounted) {
        setStatus(nextStatus);
      }
    });

    return () => {
      mounted = false;
      clearInterval(runtimeTimer);
      unsubscribe();
    };
  }, []);

  const statusText = useMemo(() => {
    if (!status) return "Loading";
    return stateLabel[status.state];
  }, [status]);
  const requiresAccessPasswordSetup =
    controlPlaneConfigured && !remoteAccessConfig?.hostAccessConfigured;

  const runAction = async (action: () => Promise<ServerStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const nextStatus = await action();
      setStatus(nextStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const runControlPlaneAuth = async () => {
    if (!desktopApi) return;
    if (!controlPlaneEmail.trim() || !controlPlanePassword.trim()) {
      setError("Email and password are required.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        baseUrl: controlPlaneBaseUrl,
        email: controlPlaneEmail,
        password: controlPlanePassword,
      };
      const config =
        accountMode === "register"
          ? await desktopApi.registerControlPlane(payload)
          : await desktopApi.loginControlPlane(payload);
      setControlPlaneConfigured(config.hasAccessToken);
      setControlPlanePassword("");
      const [nextBridgeState, nextRemoteConfig] = await Promise.all([
        desktopApi.getControlPlaneStatus(),
        desktopApi.getRemoteAccessConfig(),
      ]);
      setBridgeState(nextBridgeState as ControlPlaneBridgeState);
      setRemoteAccessConfig(nextRemoteConfig);
      if (!nextRemoteConfig.hostAccessConfigured) {
        setError("Login succeeded. You must set Host Access Password now.");
      }
    } catch (e) {
      setError(toDisplayError(e));
    } finally {
      setBusy(false);
    }
  };

  const runControlPlaneClear = async () => {
    if (!desktopApi) return;
    setBusy(true);
    setError(null);
    try {
      const config = await desktopApi.clearControlPlane();
      setControlPlaneConfigured(config.hasAccessToken);
      setControlPlanePassword("");
      setBridgeState(
        (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control-plane clear failed");
    } finally {
      setBusy(false);
    }
  };

  const runAccessPasswordConfigure = async () => {
    if (!desktopApi) return;
    if (!accessPassword.trim()) {
      setError("Access password is required.");
      return;
    }
    if (accessPassword.length < 8) {
      setError("Access password must be at least 8 characters.");
      return;
    }
    if (accessPassword !== accessPasswordConfirm) {
      setError("Access password confirmation does not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const nextConfig =
        await desktopApi.configureRemoteAccessPassword(accessPassword);
      setRemoteAccessConfig(nextConfig);
      setAccessPassword("");
      setAccessPasswordConfirm("");
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to set access password",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="container">
      <h1>AgentLine Server Control</h1>
      <section className="card">
        <div className="status-row">
          <span
            className={status ? stateClass[status.state] : "dot starting"}
          />
          <strong>{statusText}</strong>
        </div>
        <p>
          Dashboard URL: http://127.0.0.1:
          {status?.port ?? DEFAULT_DESKTOP_DISCOVERY_PORT}
        </p>
        <p>PID: {status?.pid ?? "-"}</p>
        <p>Port: {status?.port ?? 3400}</p>
        <p>Message: {status?.message ?? "-"}</p>
        <p>Backend Reachable: {runtime?.backendReachable ? "Yes" : "No"}</p>
        <p>Recovering: {runtime?.recovering ? "Yes" : "No"}</p>
        <p>Auto Recover Count: {runtime?.autoRecoverCount ?? 0}</p>
        <p>Last Recover Reason: {runtime?.lastRecoverReason ?? "-"}</p>
        <p>Last Recover Error: {runtime?.lastRecoverError ?? "-"}</p>
        {runtime?.lastRecoverAt ? (
          <p>
            Last Recover At: {new Date(runtime.lastRecoverAt).toLocaleString()}
          </p>
        ) : null}
        {status?.startedAt ? (
          <p>Started: {new Date(status.startedAt).toLocaleString()}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Platform Account</h2>
        <p>Control Plane URL</p>
        <input
          value={controlPlaneBaseUrl}
          onChange={(event) => setControlPlaneBaseUrl(event.target.value)}
          placeholder={DEFAULT_CONTROL_PLANE_BASE_URL}
          disabled={busy}
        />
        <div className="segment">
          <button
            type="button"
            className={
              accountMode === "login" ? "segment-active" : "segment-idle"
            }
            disabled={busy}
            onClick={() => setAccountMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={
              accountMode === "register" ? "segment-active" : "segment-idle"
            }
            disabled={busy}
            onClick={() => setAccountMode("register")}
          >
            Register
          </button>
        </div>
        <p>Account Email</p>
        <input
          value={controlPlaneEmail}
          onChange={(event) => setControlPlaneEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={busy}
        />
        <p>Password</p>
        <input
          type="password"
          value={controlPlanePassword}
          onChange={(event) => setControlPlanePassword(event.target.value)}
          placeholder="password"
          disabled={busy}
        />
        <div className="actions inline-actions">
          <button type="button" disabled={busy} onClick={runControlPlaneAuth}>
            {accountMode === "register" ? "Register & Login" : "Login"}
          </button>
          <button type="button" disabled={busy} onClick={runControlPlaneClear}>
            Logout / Clear
          </button>
        </div>
        <p>Configured: {controlPlaneConfigured ? "Yes" : "No"}</p>
        <p>Bridge Enabled: {bridgeState?.enabled ? "Yes" : "No"}</p>
        <p>Bridge Running: {bridgeState?.running ? "Yes" : "No"}</p>
        <p>Relay Username: {bridgeState?.relayUsername ?? "-"}</p>
        <p>Device ID: {bridgeState?.deviceId ?? "-"}</p>
        <p>Last Sync: {bridgeState?.lastSyncAt ?? "-"}</p>
        <p>Last Heartbeat: {bridgeState?.lastHeartbeatAt ?? "-"}</p>
        <p>Paused Reason: {bridgeState?.pausedReason ?? "-"}</p>
        <p>Last Error: {bridgeState?.lastError ?? "-"}</p>
        <p>Failures: {bridgeState?.consecutiveFailures ?? 0}</p>
        {requiresAccessPasswordSetup ? (
          <p className="error">
            Access password is required before mobile/web login can connect.
          </p>
        ) : null}
      </section>

      <section className="card">
        <h2>Host Access Password</h2>
        <p>
          Set the desktop host access password. Mobile/Web clients need this
          password to connect.
        </p>
        <p>Current SRP Username: {remoteAccessConfig?.username ?? "-"}</p>
        <p>
          Host Access Configured:{" "}
          {remoteAccessConfig?.hostAccessConfigured ? "Yes" : "No"}
        </p>
        <p>
          Remote Access Enabled: {remoteAccessConfig?.enabled ? "Yes" : "No"}
        </p>
        <p>Access Password</p>
        <input
          type="password"
          value={accessPassword}
          onChange={(event) => setAccessPassword(event.target.value)}
          placeholder="At least 8 characters"
          disabled={busy}
        />
        <p>Confirm Access Password</p>
        <input
          type="password"
          value={accessPasswordConfirm}
          onChange={(event) => setAccessPasswordConfirm(event.target.value)}
          placeholder="Repeat the access password"
          disabled={busy}
        />
        <div className="actions inline-actions">
          <button
            type="button"
            disabled={busy}
            onClick={runAccessPasswordConfigure}
          >
            Save Access Password
          </button>
        </div>
      </section>

      <section className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            desktopApi ? runAction(desktopApi.startServer) : undefined
          }
        >
          Start Server
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            desktopApi ? runAction(desktopApi.stopServer) : undefined
          }
        >
          Stop Server
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            desktopApi ? runAction(desktopApi.restartServer) : undefined
          }
        >
          Restart Server
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (desktopApi) {
              void desktopApi.openDashboard();
            }
          }}
        >
          Open Local Dashboard
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
