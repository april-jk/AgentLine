/**
 * RelayConnectionGate - Layout route for relay host connections.
 *
 * Used as a layout route for /:relayUsername/* in remote-main.tsx.
 * Manages the relay connection lifecycle:
 * - Extracts relayUsername from URL
 * - Looks up saved host by username
 * - Initiates connection if host found with valid session
 * - Redirects to login if no saved session
 * - Once connected, renders ConnectedAppContent + child routes via Outlet
 */

import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { ConnectedAppContent } from "../RemoteApp";
import { HostOfflineModal } from "../components/HostOfflineModal";
import {
  type AutoResumeError,
  useRemoteConnection,
} from "../contexts/RemoteConnectionContext";
import {
  getHostById,
  getHostByRelayUsername,
  upsertRelayHost,
} from "../lib/hostStorage";

type ConnectionState =
  | "checking"
  | "connecting"
  | "connected"
  | "no_host"
  | "no_session"
  | "error";

interface RelayHashCredentials {
  relayUsername: string;
  accessPassword: string;
  relayUrl: string;
  clientGrant?: string;
}

type NativeRelayBootstrap = {
  relay?: {
    relayUrl?: string;
    relayUsername?: string;
    relayPassword?: string;
    relayClientGrant?: string;
  };
};

function hasMobileEntry(search: string): boolean {
  try {
    return Boolean(new URLSearchParams(search).get("mobile_entry"));
  } catch {
    return false;
  }
}

function isNativeShellFlow(search: string): boolean {
  const nativeFlag = (
    window as { __AGENTLINE_NATIVE_SHELL__?: boolean } | undefined
  )?.__AGENTLINE_NATIVE_SHELL__;
  if (nativeFlag) return true;
  try {
    if (
      typeof window.ReactNativeWebView?.postMessage === "function" ||
      /reactnativewebview/i.test(navigator.userAgent)
    ) {
      return true;
    }
  } catch {
    // ignore runtime detection failures
  }
  try {
    if (window.localStorage.getItem("agentline-native-shell") === "1") {
      return true;
    }
  } catch {
    // ignore storage errors
  }
  return hasMobileEntry(search);
}

function clearHashPreservePathAndSearch(): void {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
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
    clearHashPreservePathAndSearch();
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

function consumeNativeRelayBootstrap(): RelayHashCredentials | null {
  try {
    const payload = (
      window as unknown as {
        __AGENTLINE_NATIVE_BOOTSTRAP__?: NativeRelayBootstrap;
      }
    ).__AGENTLINE_NATIVE_BOOTSTRAP__;
    const relay = payload?.relay;
    const relayUsername = relay?.relayUsername?.trim().toLowerCase() ?? "";
    const accessPassword = relay?.relayPassword ?? "";
    const relayUrl = relay?.relayUrl?.trim() || "wss://relay.oneceo.ai/ws";
    const clientGrant = relay?.relayClientGrant?.trim() || undefined;

    if (!relayUsername || !accessPassword) {
      return null;
    }

    // Consume once so later routes don't reuse stale credentials.
    if (payload) {
      payload.relay = undefined;
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

function buildRelayLoginRedirectPath(
  relayUsername: string | undefined,
  search: string,
  hash: string,
): string {
  const params = new URLSearchParams(search);
  const normalizedRelayUsername = relayUsername?.trim().toLowerCase() ?? "";
  if (normalizedRelayUsername && !params.get("u")) {
    params.set("u", normalizedRelayUsername);
  }
  const query = params.toString();
  return `/login/relay${query ? `?${query}` : ""}${hash ?? ""}`;
}

/** Create an AutoResumeError from an exception */
function createAutoResumeError(
  err: unknown,
  relayUsername: string,
  relayUrl?: string,
): AutoResumeError {
  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  let reason: AutoResumeError["reason"] = "other";
  if (lowerMessage.includes("server_offline")) {
    reason = "server_offline";
  } else if (lowerMessage.includes("unknown_username")) {
    reason = "unknown_username";
  } else if (
    lowerMessage.includes("resume_incompatible") ||
    lowerMessage.includes("session resume unsupported")
  ) {
    reason = "resume_incompatible";
  } else if (
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out")
  ) {
    reason = "relay_timeout";
  } else if (
    lowerMessage.includes("failed to connect to relay") ||
    lowerMessage.includes("relay connection closed") ||
    lowerMessage.includes("relay connection error")
  ) {
    reason = "relay_unreachable";
  } else if (
    lowerMessage.includes("authentication failed") ||
    lowerMessage.includes("auth") ||
    lowerMessage.includes("session")
  ) {
    reason = "auth_failed";
  }

  return {
    reason,
    mode: "relay",
    relayUsername,
    serverUrl: relayUrl,
    message,
  };
}

/**
 * Layout route that manages relay connection and renders child routes when connected.
 */
export function RelayConnectionGate() {
  const location = useLocation();
  const { relayUsername } = useParams<{ relayUsername: string }>();
  const {
    connection,
    connectViaRelay,
    isAutoResuming,
    setCurrentHostId,
    currentHostId,
    isIntentionalDisconnect,
    disconnect,
  } = useRemoteConnection();
  const isMobileEntryFlow = isNativeShellFlow(location.search);

  const [state, setState] = useState<ConnectionState>("checking");
  const [error, setError] = useState<AutoResumeError | null>(null);
  const connectInFlightRef = useRef(false);

  // Attempt to connect when username changes
  useEffect(() => {
    if (!relayUsername) {
      setState("no_host");
      return;
    }

    // If already connected, check if it's to the right host
    if (connection) {
      const currentHost = currentHostId ? getHostById(currentHostId) : null;
      const connectedRelayUsername = currentHost?.relayUsername;

      if (connectedRelayUsername === relayUsername) {
        setState("connected");
        return;
      }

      // If currentHostId is not set (e.g., after auto-resume from old storage),
      // try to find the host by relay username and set it
      if (!currentHostId) {
        const hostByUsername = getHostByRelayUsername(relayUsername);
        if (hostByUsername) {
          console.log(
            `[RelayConnectionGate] Connection without hostId, setting to "${hostByUsername.id}" for "${relayUsername}"`,
          );
          setCurrentHostId(hostByUsername.id);
          setState("connected");
          return;
        }
        console.log(
          `[RelayConnectionGate] Connection without hostId and no saved host for "${relayUsername}", redirecting to login`,
        );
        disconnect(false);
        setState("no_host");
        return;
      }

      // Connected to a different host - disconnect and let the effect reconnect
      console.log(
        `[RelayConnectionGate] Host mismatch: connected to "${connectedRelayUsername}" but URL wants "${relayUsername}", switching...`,
      );
      disconnect(false);
      setState("connecting");
      return;
    }

    // If user intentionally disconnected (e.g., clicked "Switch Host"),
    // don't try to reconnect - they're navigating away
    if (isIntentionalDisconnect) {
      console.log(
        `[RelayConnectionGate] Intentional disconnect, not reconnecting to "${relayUsername}"`,
      );
      return;
    }

    // If auto-resume is in progress, wait for it
    if (isAutoResuming) {
      console.log(
        `[RelayConnectionGate] Auto-resume in progress, waiting... (relayUsername="${relayUsername}")`,
      );
      setState("connecting");
      return;
    }

    // Look up saved host by relay username
    const host = getHostByRelayUsername(relayUsername);
    console.log(
      `[RelayConnectionGate] Looking up host for "${relayUsername}":`,
      host
        ? {
            id: host.id,
            hasSession: !!host.session,
            hasRelayUrl: !!host.relayUrl,
          }
        : "not found",
    );
    console.log(`[RelayConnectionGate] Flow flags for "${relayUsername}":`, {
      isMobileEntryFlow,
      hasHash: Boolean(window.location.hash),
      search: window.location.search,
    });

    if (!host) {
      if (isMobileEntryFlow) {
        const hashCreds = parseRelayHashCredentials();
        const bootstrapCreds = hashCreds ? null : consumeNativeRelayBootstrap();
        const resolvedCreds = hashCreds ?? bootstrapCreds;
        console.log(
          `[RelayConnectionGate] Mobile relay credential source for "${relayUsername}":`,
          hashCreds ? "hash" : bootstrapCreds ? "native_bootstrap" : "none",
        );
        if (!resolvedCreds) {
          console.log(
            `[RelayConnectionGate] Missing mobile relay credentials for "${relayUsername}", falling back to relay login route`,
          );
          setState("no_session");
          return;
        }

        const normalizedUsername =
          relayUsername?.trim().toLowerCase() || resolvedCreds.relayUsername;
        const mobileHost = upsertRelayHost({
          relayUrl: resolvedCreds.relayUrl,
          relayUsername: normalizedUsername,
          srpUsername: normalizedUsername,
        });

        setState("connecting");
        connectInFlightRef.current = true;
        setCurrentHostId(mobileHost.id);
        connectViaRelay({
          relayUrl: resolvedCreds.relayUrl,
          relayUsername: normalizedUsername,
          srpUsername: normalizedUsername,
          srpPassword: resolvedCreds.accessPassword,
          rememberMe: true,
          clientGrant: resolvedCreds.clientGrant,
          onStatusChange: () => {},
        })
          .then(() => {
            setState("connected");
          })
          .catch((err) => {
            setError(
              createAutoResumeError(
                err,
                normalizedUsername,
                resolvedCreds.relayUrl,
              ),
            );
            setState("error");
          })
          .finally(() => {
            connectInFlightRef.current = false;
          });
        return;
      }

      console.log(
        `[RelayConnectionGate] No saved host for "${relayUsername}", redirecting to login`,
      );
      setState("no_host");
      return;
    }

    if (!host.session || !host.relayUrl) {
      if (connectInFlightRef.current) {
        setState("connecting");
        return;
      }

      if (isMobileEntryFlow) {
        const hashCreds = parseRelayHashCredentials();
        const bootstrapCreds = hashCreds ? null : consumeNativeRelayBootstrap();
        const resolvedCreds = hashCreds ?? bootstrapCreds;
        console.log(
          `[RelayConnectionGate] Mobile relay re-auth source for "${relayUsername}":`,
          hashCreds ? "hash" : bootstrapCreds ? "native_bootstrap" : "none",
        );
        if (resolvedCreds) {
          setState("connecting");
          connectInFlightRef.current = true;
          setCurrentHostId(host.id);
          connectViaRelay({
            relayUrl: resolvedCreds.relayUrl,
            relayUsername: host.relayUsername ?? relayUsername,
            srpUsername: host.srpUsername,
            srpPassword: resolvedCreds.accessPassword,
            rememberMe: true,
            clientGrant: resolvedCreds.clientGrant,
            onStatusChange: () => {},
          })
            .then(() => {
              setState("connected");
            })
            .catch((err) => {
              setError(
                createAutoResumeError(
                  err,
                  host.relayUsername ?? relayUsername ?? "",
                  resolvedCreds.relayUrl,
                ),
              );
              setState("error");
            })
            .finally(() => {
              connectInFlightRef.current = false;
            });
          return;
        }
      }

      console.log(
        `[RelayConnectionGate] Host "${relayUsername}" has no session or relayUrl, redirecting to login`,
      );
      setState("no_session");
      return;
    }

    // Attempt to connect using saved session
    setState("connecting");
    connectInFlightRef.current = true;
    // Set host ID before auth so session refresh callbacks can sync hostStorage.
    setCurrentHostId(host.id);

    connectViaRelay({
      relayUrl: host.relayUrl,
      relayUsername: host.relayUsername ?? relayUsername,
      srpUsername: host.srpUsername,
      srpPassword: "", // Ignored when session is provided
      rememberMe: true,
      onStatusChange: () => {},
      session: host.session,
    })
      .then(() => {
        setState("connected");
      })
      .catch((err) => {
        setError(
          createAutoResumeError(
            err,
            host.relayUsername ?? relayUsername,
            host.relayUrl,
          ),
        );
        setState("error");
      })
      .finally(() => {
        connectInFlightRef.current = false;
      });
  }, [
    relayUsername,
    connection,
    connectViaRelay,
    isAutoResuming,
    setCurrentHostId,
    currentHostId,
    isIntentionalDisconnect,
    disconnect,
    isMobileEntryFlow,
  ]);

  switch (state) {
    case "checking":
    case "connecting":
      return (
        <div className="auto-resume-loading">
          <div className="loading-spinner" />
          <p>Connecting to {relayUsername}...</p>
        </div>
      );

    case "no_host":
    case "no_session": {
      const to = buildRelayLoginRedirectPath(
        relayUsername,
        location.search,
        location.hash ?? "",
      );
      console.log(
        `[RelayConnectionGate] Redirecting to relay login fallback for "${relayUsername}": ${to}`,
      );
      return <Navigate to={to} replace />;
    }

    case "error": {
      const defaultError: AutoResumeError = {
        reason: "other",
        mode: "relay",
        relayUsername: relayUsername ?? "",
        message: "Connection failed",
      };
      return (
        <HostOfflineModal
          error={error ?? defaultError}
          onRetry={() => {
            setState("connecting");
            setError(null);
            const host = getHostByRelayUsername(relayUsername ?? "");
            if (host?.relayUrl && host.relayUsername && host.session) {
              connectViaRelay({
                relayUrl: host.relayUrl,
                relayUsername: host.relayUsername,
                srpUsername: host.srpUsername,
                srpPassword: "", // Ignored when session is provided
                rememberMe: true,
                onStatusChange: () => {},
                session: host.session,
              })
                .then(() => {
                  setCurrentHostId(host.id);
                  setState("connected");
                })
                .catch((err) => {
                  setError(
                    createAutoResumeError(
                      err,
                      host.relayUsername ?? relayUsername ?? "",
                      host.relayUrl,
                    ),
                  );
                  setState("error");
                });
            } else {
              setState("no_session");
            }
          }}
          onGoToLogin={() => setState("no_session")}
        />
      );
    }

    case "connected":
      return (
        <ConnectedAppContent>
          <Outlet />
        </ConnectedAppContent>
      );
  }
}
