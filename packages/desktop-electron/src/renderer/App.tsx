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
    const load = async () => {
      try {
        const currentStatus = await desktopApi.getServerStatus();
        const currentRuntime = await desktopApi.getServerRuntimeState();
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
      void desktopApi
        .getServerRuntimeState()
        .then((currentRuntime) => {
          if (mounted) {
            setRuntime(currentRuntime);
          }
        })
        .catch(() => {});
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
        <p>Dashboard URL: http://localhost:3400</p>
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
          Open http://localhost:3400
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
