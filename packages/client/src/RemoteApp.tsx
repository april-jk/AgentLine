/**
 * RemoteApp - Wrapper for remote client mode.
 *
 * This replaces the regular App wrapper for the remote (static) client.
 * Key differences:
 * - No AuthProvider (SRP handles authentication)
 * - Shows login pages when not connected (handled via routing)
 * - Uses RemoteConnectionProvider for connection state
 *
 * Architecture:
 * RemoteApp provides all shared providers (Toast, RemoteConnection, Inbox, SchemaValidation).
 * Route-level gating is handled by layout routes in remote-main.tsx:
 * - UnauthenticatedGate: wraps login routes, redirects to app if already connected
 * - ConnectionGate: wraps direct-mode app routes, requires connection
 * - RelayConnectionGate: wraps relay-mode app routes, manages relay connection
 * Both ConnectionGate and RelayConnectionGate render ConnectedAppContent when connected.
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ConnectionBar } from "./components/ConnectionBar";
import { FloatingActionButton } from "./components/FloatingActionButton";
import { HostOfflineModal } from "./components/HostOfflineModal";
import { ReloadBanner } from "./components/ReloadBanner";
import { Modal } from "./components/ui/Modal";
import { InboxProvider } from "./contexts/InboxContext";
import {
  RemoteConnectionProvider,
  useRemoteConnection,
} from "./contexts/RemoteConnectionContext";
import { SchemaValidationProvider } from "./contexts/SchemaValidationContext";
import { ToastProvider } from "./contexts/ToastContext";
import { useNeedsAttentionBadge } from "./hooks/useNeedsAttentionBadge";
import { useSyncNotifyInAppSetting } from "./hooks/useNotifyInApp";
import { useReloadNotifications } from "./hooks/useReloadNotifications";
import { useRemoteActivityBusConnection } from "./hooks/useRemoteActivityBusConnection";
import { useRemoteBasePath } from "./hooks/useRemoteBasePath";
import { useVersion } from "./hooks/useVersion";
import { connectionManager } from "./lib/connection";
import { initClientLogCollection } from "./lib/diagnostics";
import { createDirectHost, getHostByWsUrl, saveHost } from "./lib/hostStorage";

interface Props {
  children: ReactNode;
}

interface DirectHashCredentials {
  wsUrl: string;
  username: string;
  password: string;
}

const MOBILE_ENTRY_QUERY_KEY = "mobile_entry";

function hasMobileEntry(search: string): boolean {
  try {
    const params = new URLSearchParams(search);
    return Boolean(params.get(MOBILE_ENTRY_QUERY_KEY));
  } catch {
    return false;
  }
}

function isNativeShellFlow(search: string): boolean {
  const nativeFlag = (
    window as { __AGENTLINE_NATIVE_SHELL__?: boolean } | undefined
  )?.__AGENTLINE_NATIVE_SHELL__;
  if (nativeFlag) return true;
  return hasMobileEntry(search);
}

function clearHashPreservePathAndSearch(): void {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

function parseDirectHashCredentials(): DirectHashCredentials | null {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return null;

  try {
    const params = new URLSearchParams(hash.slice(1));
    const wsUrl = params.get("ws");
    const username = params.get("u");
    const password = params.get("p") ?? "";

    if (!wsUrl || !username || !password) {
      return null;
    }

    clearHashPreservePathAndSearch();
    return { wsUrl, username, password };
  } catch {
    return null;
  }
}

function normalizeDirectWsUrl(rawValue: string): string {
  let wsUrl = rawValue.trim();
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

  return wsUrl;
}

/**
 * Wrapper for connected app content. Runs hooks that require an active
 * SecureConnection. Used by both ConnectionGate (direct mode) and
 * RelayConnectionGate (relay mode) once connected.
 */
export function ConnectedAppContent({ children }: { children: ReactNode }) {
  useRemoteActivityBusConnection();
  const { currentRelayUsername } = useRemoteConnection();
  const { version: versionInfo } = useVersion();
  const [dismissedRelayResumeWarning, setDismissedRelayResumeWarning] =
    useState(false);

  const {
    isManualReloadMode,
    pendingReloads,
    reloadBackend,
    reloadFrontend,
    dismiss,
    unsafeToRestart,
    workerActivity,
  } = useReloadNotifications();

  const showRelayResumeWarning = useMemo(() => {
    if (dismissedRelayResumeWarning) return false;
    if (!currentRelayUsername) return false;
    if (!versionInfo) return false;
    return (versionInfo.resumeProtocolVersion ?? 1) < 2;
  }, [dismissedRelayResumeWarning, currentRelayUsername, versionInfo]);

  return (
    <>
      {showRelayResumeWarning && (
        <Modal
          title="Server Update Required"
          onClose={() => setDismissedRelayResumeWarning(true)}
        >
          <div className="host-offline-modal-content">
            <p className="host-offline-message">
              The server on <strong>{currentRelayUsername}</strong> needs to be
              updated for improved session resume security. Until then, you'll
              need to log in again after refreshing or reconnecting.
            </p>
            <p className="host-offline-detail">
              <code>npm update -g agentline</code>
            </p>
            <p className="host-offline-hint">
              Then restart the server and reconnect.
            </p>
            <div className="host-offline-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => setDismissedRelayResumeWarning(true)}
              >
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}
      {isManualReloadMode && pendingReloads.backend && (
        <ReloadBanner
          target="backend"
          onReload={reloadBackend}
          onDismiss={() => dismiss("backend")}
          unsafeToRestart={unsafeToRestart}
          activeWorkers={workerActivity.activeWorkers}
        />
      )}
      {isManualReloadMode && pendingReloads.frontend && (
        <ReloadBanner
          target="frontend"
          onReload={reloadFrontend}
          onDismiss={() => dismiss("frontend")}
        />
      )}
      {children}
      <FloatingActionButton />
    </>
  );
}

/**
 * Layout route that redirects away from login pages if already connected.
 * Renders <Outlet /> (login pages) when not connected.
 */
export function UnauthenticatedGate() {
  const { connection, isIntentionalDisconnect } = useRemoteConnection();
  const basePath = useRemoteBasePath();

  // If connected and user didn't intentionally disconnect, redirect to app
  if (connection && !isIntentionalDisconnect) {
    return <Navigate to={`${basePath}/projects`} replace />;
  }

  return <Outlet />;
}

/**
 * Layout route for direct-mode app routes. Requires an active connection.
 *
 * - Reconnecting: stay on current page (don't redirect to /login)
 * - Auto-resuming: show loading spinner
 * - Not connected + auto-resume error: show HostOfflineModal
 * - Not connected: redirect to /login
 * - Connected: render ConnectedAppContent + child routes
 */
export function ConnectionGate() {
  const location = useLocation();
  const isMobileEntryFlow = isNativeShellFlow(location.search);
  const {
    connection,
    connect,
    isConnecting,
    isAutoResuming,
    autoResumeError,
    clearAutoResumeError,
    retryAutoResume,
    setCurrentHostId,
  } = useRemoteConnection();
  const [mobileDirectError, setMobileDirectError] = useState<string | null>(
    null,
  );
  const [mobileDirectAttempted, setMobileDirectAttempted] = useState(false);
  const directCredsRef = useRef<DirectHashCredentials | null>(null);

  const attemptMobileDirectConnect = useCallback(
    async (credentials: DirectHashCredentials) => {
      const normalizedWsUrl = normalizeDirectWsUrl(credentials.wsUrl);
      const normalizedUsername = credentials.username.trim();
      const password = credentials.password;

      if (!normalizedWsUrl || !normalizedUsername || !password) {
        throw new Error("Missing direct connection credentials.");
      }

      const existing = getHostByWsUrl(normalizedWsUrl);
      if (existing) {
        setCurrentHostId(existing.id);
      } else {
        const nextHost = createDirectHost({
          wsUrl: normalizedWsUrl,
          srpUsername: normalizedUsername,
        });
        saveHost(nextHost);
        setCurrentHostId(nextHost.id);
      }

      await connect(normalizedWsUrl, normalizedUsername, password, true);
    },
    [connect, setCurrentHostId],
  );

  useEffect(() => {
    if (!isMobileEntryFlow || connection || isAutoResuming) return;
    if (connectionManager.state === "reconnecting") return;
    if (mobileDirectAttempted) return;

    const parsed = parseDirectHashCredentials();
    if (!parsed) {
      setMobileDirectAttempted(true);
      setMobileDirectError("Direct credentials are missing from mobile link.");
      return;
    }

    directCredsRef.current = parsed;
    setMobileDirectAttempted(true);
    setMobileDirectError(null);
    void attemptMobileDirectConnect(parsed).catch((error) => {
      setMobileDirectError(
        error instanceof Error ? error.message : "Direct connection failed",
      );
    });
  }, [
    attemptMobileDirectConnect,
    connection,
    isAutoResuming,
    isMobileEntryFlow,
    mobileDirectAttempted,
  ]);

  const retryMobileDirectConnect = useCallback(() => {
    const credentials = directCredsRef.current;
    if (!credentials) {
      setMobileDirectError("Direct credentials are missing from mobile link.");
      return;
    }
    setMobileDirectError(null);
    void attemptMobileDirectConnect(credentials).catch((error) => {
      setMobileDirectError(
        error instanceof Error ? error.message : "Direct connection failed",
      );
    });
  }, [attemptMobileDirectConnect]);

  // During reconnection, stay on the current page — don't redirect to /login.
  // ConnectionManager is the source of truth; React connection state may be stale.
  if (connectionManager.state === "reconnecting") {
    return <Outlet />;
  }

  // During auto-resume, don't redirect - show loading state
  // This preserves the current URL so we stay on the same page after successful resume
  if (isAutoResuming) {
    return (
      <div className="auto-resume-loading">
        <div className="loading-spinner" />
        <p>Reconnecting...</p>
      </div>
    );
  }

  // Not connected (and not auto-resuming)
  if (!connection) {
    // If auto-resume failed with a connection error, show the modal
    if (autoResumeError) {
      return (
        <HostOfflineModal
          error={autoResumeError}
          onRetry={retryAutoResume}
          onGoToLogin={clearAutoResumeError}
        />
      );
    }

    if (isMobileEntryFlow) {
      return (
        <div className="auto-resume-loading">
          <div className="loading-spinner" />
          <p>
            {isConnecting
              ? "Authenticating direct session..."
              : "Preparing direct session..."}
          </p>
          {mobileDirectError ? (
            <div className="host-offline-actions">
              <p className="host-offline-message">{mobileDirectError}</p>
              <button
                type="button"
                className="btn-primary"
                onClick={retryMobileDirectConnect}
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    return <Navigate to="/login" replace />;
  }

  // Connected - render child routes with connected-state hooks
  return (
    <ConnectedAppContent>
      <Outlet />
    </ConnectedAppContent>
  );
}

/**
 * Inner component that runs hooks requiring InboxContext.
 * Must be rendered inside InboxProvider.
 */
function RemoteAppInner({ children }: Props) {
  useNeedsAttentionBadge();

  return (
    <>
      <ConnectionBar />
      {children}
    </>
  );
}

/**
 * RemoteApp wrapper for remote client mode.
 *
 * Provides shared context for all routes:
 * - ToastProvider (always available)
 * - RemoteConnectionProvider for connection management
 * - InboxProvider for inbox data (works without connection — gracefully empty)
 * - SchemaValidationProvider (localStorage only, no connection needed)
 * - Connection-independent hooks (notify sync, log collection)
 */
export function RemoteApp({ children }: Props) {
  useEffect(() => initClientLogCollection(), []);
  useSyncNotifyInAppSetting();

  return (
    <ToastProvider>
      <RemoteConnectionProvider>
        <InboxProvider>
          <SchemaValidationProvider>
            <RemoteAppInner>{children}</RemoteAppInner>
          </SchemaValidationProvider>
        </InboxProvider>
      </RemoteConnectionProvider>
    </ToastProvider>
  );
}
