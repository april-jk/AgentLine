import { useEffect, useMemo, useState } from "react";

type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

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

export function App() {
  const desktopApi = window.desktopApi;
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [runtime, setRuntime] = useState<ServerRuntimeState | null>(null);
  const [bridgeState, setBridgeState] = useState<ControlPlaneBridgeState | null>(
    null,
  );
  const [controlPlaneBaseUrl, setControlPlaneBaseUrl] = useState("");
  const [controlPlaneRelayWsUrl, setControlPlaneRelayWsUrl] = useState("");
  const [controlPlaneEmail, setControlPlaneEmail] = useState("");
  const [controlPlanePassword, setControlPlanePassword] = useState("");
  const [controlPlaneConfigured, setControlPlaneConfigured] = useState(false);
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
      try {
        const config = await desktopApi.getControlPlaneConfig();
        const state =
          (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState;
        if (!mounted) {
          return;
        }
        setControlPlaneBaseUrl(config.baseUrl ?? "");
        setControlPlaneRelayWsUrl(config.relayWsUrl ?? "");
        setControlPlaneEmail(config.lastEmail ?? "");
        setControlPlaneConfigured(config.hasAccessToken);
        setBridgeState(state);
      } catch {
        if (mounted) {
          setBridgeState(null);
        }
      }
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
          const currentRuntime = await desktopApi.getServerRuntimeState();
          const currentBridgeState =
            (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState;
          if (mounted) {
            setRuntime(currentRuntime);
            setBridgeState(currentBridgeState);
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
    if (!status) {
      return "Loading";
    }
    return stateLabel[status.state];
  }, [status]);

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

  const runControlPlaneLogin = async () => {
    if (!desktopApi) return;
    setBusy(true);
    setError(null);
    try {
      const config = await desktopApi.loginControlPlane({
        baseUrl: controlPlaneBaseUrl,
        relayWsUrl: controlPlaneRelayWsUrl,
        email: controlPlaneEmail,
        password: controlPlanePassword,
      });
      setControlPlaneConfigured(config.hasAccessToken);
      setControlPlanePassword("");
      const nextState =
        (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState;
      setBridgeState(nextState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control-plane login failed");
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
      const nextState =
        (await desktopApi.getControlPlaneStatus()) as ControlPlaneBridgeState;
      setBridgeState(nextState);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control-plane clear failed");
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
        <p>Dashboard URL: http://127.0.0.1:{status?.port ?? 45731}</p>
        <p>PID: {status?.pid ?? "-"}</p>
        <p>Port: {status?.port ?? 3400}</p>
        <p>Message: {status?.message ?? "-"}</p>
        <p>Backend Reachable: {runtime?.backendReachable ? "Yes" : "No"}</p>
        <p>Recovering: {runtime?.recovering ? "Yes" : "No"}</p>
        <p>Auto Recover Count: {runtime?.autoRecoverCount ?? 0}</p>
        <p>Last Recover Reason: {runtime?.lastRecoverReason ?? "-"}</p>
        <p>Last Recover Error: {runtime?.lastRecoverError ?? "-"}</p>
        {runtime?.lastRecoverAt ? (
          <p>Last Recover At: {new Date(runtime.lastRecoverAt).toLocaleString()}</p>
        ) : null}
        {status?.startedAt ? (
          <p>Started: {new Date(status.startedAt).toLocaleString()}</p>
        ) : null}
      </section>

      <section className="card">
        <h2>Account Relay Bridge</h2>
        <p>Control Plane Base URL</p>
        <input
          value={controlPlaneBaseUrl}
          onChange={(event) => setControlPlaneBaseUrl(event.target.value)}
          placeholder="http://127.0.0.1:4400"
          disabled={busy}
        />
        <p>Relay WebSocket URL (optional)</p>
        <input
          value={controlPlaneRelayWsUrl}
          onChange={(event) => setControlPlaneRelayWsUrl(event.target.value)}
          placeholder="ws://127.0.0.1:4400/ws"
          disabled={busy}
        />
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
      </section>

      <section className="actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => (desktopApi ? runAction(desktopApi.startServer) : undefined)}
        >
          Start Server
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (desktopApi ? runAction(desktopApi.stopServer) : undefined)}
        >
          Stop Server
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (desktopApi ? runAction(desktopApi.restartServer) : undefined)}
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
        <button type="button" disabled={busy} onClick={runControlPlaneLogin}>
          Login Control Plane
        </button>
        <button type="button" disabled={busy} onClick={runControlPlaneClear}>
          Clear Control Plane
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
