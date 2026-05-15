/**
 * Remote client entry point.
 *
 * This is a separate entry point for the remote (static) client that:
 * - Uses SecureConnection for all communication (SRP + NaCl encryption)
 * - Shows a login page before connecting
 * - Does NOT use cookie-based auth (uses SRP instead)
 *
 * Route structure:
 * - UnauthenticatedGate: wraps login routes, redirects to app if already connected
 * - ConnectionGate: wraps direct-mode app routes (no relay username in URL)
 * - RelayConnectionGate: wraps relay-mode app routes (/:relayUsername/...)
 *
 * ConnectionGate and RelayConnectionGate share the same APP_ROUTES.
 * This avoids duplicating route definitions or provider wrapping.
 */

console.log("[RemoteClient] Loading remote-main.tsx entry point");

import { Fragment, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

// Toggle to disable StrictMode for easier debugging (avoids double renders)
const STRICT_MODE = false;
const Wrapper = STRICT_MODE ? StrictMode : Fragment;

import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ConnectionGate, RemoteApp, UnauthenticatedGate } from "./RemoteApp";
import { initializeFontSize } from "./hooks/useFontSize";
import { initializeTabSize } from "./hooks/useTabSize";
import { initializeTheme } from "./hooks/useTheme";
import { I18nProvider } from "./i18n";
import { NavigationLayout } from "./layouts";
import { ActivityPage } from "./pages/ActivityPage";
import { AgentsPage } from "./pages/AgentsPage";
import { DirectLoginPage } from "./pages/DirectLoginPage";
import { EmulatorPage } from "./pages/EmulatorPage";
import { FilePage } from "./pages/FilePage";
import { GitStatusPage } from "./pages/GitStatusPage";
import { GlobalSessionsPage } from "./pages/GlobalSessionsPage";
import { HostAccountLoginPage } from "./pages/HostAccountLoginPage";
import { HostLoginEntryPage } from "./pages/HostLoginEntryPage";
import { HostPickerPage } from "./pages/HostPickerPage";
import { InboxPage } from "./pages/InboxPage";
import { NewSessionPage } from "./pages/NewSessionPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RelayConnectionGate } from "./pages/RelayConnectionGate";
import { RelayLoginPage } from "./pages/RelayLoginPage";
import { SessionPage } from "./pages/SessionPage";
import { VoiceSecretaryPage } from "./pages/VoiceSecretaryPage";
import { SettingsLayout } from "./pages/settings";
import "./styles/index.css";

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage(message: string): void;
    };
  }
}

// Apply saved preferences before React renders to avoid flash
initializeTheme();
initializeFontSize();
initializeTabSize();

/**
 * Some mobile WebViews can keep a stale cached 404 for hashed CSS files after
 * relay route migrations. If core CSS vars are missing, retry styles once with
 * cache-busting query params so the remote UI does not render unstyled.
 */
function ensureRemoteStylesLoaded() {
  if (typeof window === "undefined") return;
  const mobileEntryMarker =
    new URLSearchParams(window.location.search).get("mobile_entry") ?? "native";

  const hasThemeVariables = () => {
    const rootStyles = window.getComputedStyle(document.documentElement);
    return rootStyles.getPropertyValue("--text-primary").trim().length > 0;
  };

  const postRecoveryEvent = (status: "bust" | "inline" | "failed") => {
    try {
      window.ReactNativeWebView?.postMessage(
        JSON.stringify({
          type: "agentline-style-recovery",
          status,
        }),
      );
    } catch {
      // no-op: browser mode has no ReactNativeWebView bridge
    }
  };

  const injectInlineCssFallback = async (
    stylesheetLinks: HTMLLinkElement[],
  ): Promise<boolean> => {
    for (const link of stylesheetLinks) {
      const href = link.getAttribute("href");
      if (!href || !href.includes("/assets/")) continue;

      const fetchUrl =
        `${href}${href.includes("?") ? "&" : "?"}` +
        `inline=${Date.now()}&mobile_entry=${encodeURIComponent(mobileEntryMarker)}`;
      try {
        const response = await fetch(fetchUrl, {
          cache: "reload",
          credentials: "same-origin",
        });
        if (!response.ok) continue;

        const cssText = await response.text();
        if (!cssText.trim()) continue;

        if (
          document.head.querySelector(
            'style[data-agentline-inline-style-fallback="1"]',
          )
        ) {
          return true;
        }

        const styleElement = document.createElement("style");
        styleElement.setAttribute("data-agentline-inline-style-fallback", "1");
        styleElement.textContent = cssText;
        document.head.appendChild(styleElement);
        return true;
      } catch {
        // try next candidate stylesheet
      }
    }

    return false;
  };

  window.setTimeout(async () => {
    if (hasThemeVariables()) return;

    const stylesheetLinks = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    );
    if (stylesheetLinks.length === 0) return;

    for (const link of stylesheetLinks) {
      const href = link.getAttribute("href");
      if (!href || !href.includes("/assets/")) continue;

      const retryLink = document.createElement("link");
      retryLink.rel = "stylesheet";
      retryLink.crossOrigin = link.crossOrigin || "anonymous";
      retryLink.href =
        `${href}${href.includes("?") ? "&" : "?"}` +
        `v=${Date.now()}&mobile_entry=${encodeURIComponent(mobileEntryMarker)}`;
      document.head.appendChild(retryLink);
    }

    postRecoveryEvent("bust");
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    if (hasThemeVariables()) return;

    const inlined = await injectInlineCssFallback(stylesheetLinks);
    if (inlined) {
      postRecoveryEvent("inline");
      return;
    }

    postRecoveryEvent("failed");
  }, 1200);
}

ensureRemoteStylesLoaded();

function resolveRemoteBasename(): string | undefined {
  // Build-time base URL from Vite (may be "/" in some relay deployments).
  const configuredBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Runtime fallback: when served under /remote on relay, force basename /remote
  // so /remote/login/relay matches login routes instead of /:relayUsername.
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    if (path === "/remote" || path.startsWith("/remote/")) {
      return "/remote";
    }
  }

  return configuredBase || undefined;
}

const basename = resolveRemoteBasename();

function detectNativeShellRuntime(): boolean {
  if (typeof window === "undefined") return false;

  const nativeFlag = (
    window as { __AGENTLINE_NATIVE_SHELL__?: boolean } | undefined
  )?.__AGENTLINE_NATIVE_SHELL__;
  if (nativeFlag) {
    try {
      localStorage.setItem("agentline-native-shell", "1");
    } catch {
      // ignore storage failures
    }
    return true;
  }

  try {
    const queryFlag = Boolean(
      new URLSearchParams(window.location.search).get("mobile_entry"),
    );
    if (queryFlag) {
      localStorage.setItem("agentline-native-shell", "1");
      return true;
    }
  } catch {
    // ignore malformed query
  }

  try {
    if (
      typeof window.ReactNativeWebView?.postMessage === "function" ||
      /reactnativewebview/i.test(navigator.userAgent)
    ) {
      localStorage.setItem("agentline-native-shell", "1");
      return true;
    }
  } catch {
    // ignore runtime detection failures
  }

  try {
    return localStorage.getItem("agentline-native-shell") === "1";
  } catch {
    return false;
  }
}

const nativeShellRuntime = detectNativeShellRuntime();

function inferNativeLoginReason(pathname: string, search: string): string {
  try {
    const params = new URLSearchParams(search);
    const explicitReason = params.get("reason");
    if (explicitReason?.trim()) return explicitReason.trim();
  } catch {
    // ignore malformed query
  }

  if (pathname.includes("/login/relay")) return "relay_auth_required";
  if (pathname.includes("/login/direct")) return "direct_auth_required";
  return "web_login_blocked";
}

function NativeShellLoginBypass() {
  const location = useLocation();

  useEffect(() => {
    const reason = inferNativeLoginReason(location.pathname, location.search);
    const emit = () => {
      try {
        window.ReactNativeWebView?.postMessage(
          JSON.stringify({
            type: "agentline-login-route-blocked",
            reason,
            pathname: location.pathname,
          }),
        );
      } catch {
        // ignore bridge errors
      }
    };

    if (reason === "web_login_blocked") {
      const timer = window.setTimeout(emit, 1000);
      return () => window.clearTimeout(timer);
    }

    try {
      emit();
    } catch {
      // ignore bridge errors
    }
  }, [location.pathname, location.search]);

  return (
    <div className="auto-resume-loading">
      <div className="loading-spinner" />
      <p>Returning to mobile sign-in…</p>
    </div>
  );
}

/**
 * Shared app routes used by both direct mode (ConnectionGate) and
 * relay mode (RelayConnectionGate). Uses relative paths so they resolve
 * correctly under both "/" and "/:relayUsername/".
 */
const APP_ROUTES = (
  <>
    <Route index element={<Navigate to="projects" replace />} />

    {/* IMPORTANT: Keep routes in sync with main.tsx — adding a route here? Add it there too! */}
    <Route element={<NavigationLayout />}>
      <Route path="projects" element={<ProjectsPage />} />
      <Route path="sessions" element={<GlobalSessionsPage />} />
      <Route path="agents" element={<AgentsPage />} />
      <Route path="inbox" element={<InboxPage />} />
      <Route path="voice-secretary" element={<VoiceSecretaryPage />} />
      <Route path="git-status" element={<GitStatusPage />} />
      <Route path="devices" element={<EmulatorPage />} />
      <Route path="devices/:deviceId" element={<EmulatorPage />} />
      <Route path="settings" element={<SettingsLayout />} />
      <Route path="settings/:category" element={<SettingsLayout />} />
      <Route path="new-session" element={<NewSessionPage />} />
      <Route
        path="projects/:projectId/sessions/:sessionId"
        element={<SessionPage />}
      />
    </Route>

    {/* Pages with custom layouts */}
    <Route path="projects/:projectId/file" element={<FilePage />} />
    <Route path="activity" element={<ActivityPage />} />

    {/* Catch-all redirect to projects (must use ../ to escape splat route's relative resolution) */}
    <Route path="*" element={<Navigate to="../projects" replace />} />
  </>
);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <Wrapper>
    <BrowserRouter basename={basename}>
      <I18nProvider>
        <RemoteApp>
          <Routes>
            {/* Login routes — redirect to app if already connected */}
            <Route element={<UnauthenticatedGate />}>
              <Route
                path="/login"
                element={
                  nativeShellRuntime ? (
                    <NativeShellLoginBypass />
                  ) : (
                    <HostLoginEntryPage />
                  )
                }
              />
              <Route
                path="/login/account"
                element={
                  nativeShellRuntime ? (
                    <NativeShellLoginBypass />
                  ) : (
                    <HostAccountLoginPage />
                  )
                }
              />
              <Route
                path="/login/devices"
                element={
                  nativeShellRuntime ? (
                    <NativeShellLoginBypass />
                  ) : (
                    <HostPickerPage />
                  )
                }
              />
              <Route
                path="/login/new"
                element={<Navigate to="/login" replace />}
              />
              <Route path="/login/direct" element={<DirectLoginPage />} />
              <Route path="/login/relay" element={<RelayLoginPage />} />
            </Route>

            {/* Direct mode — requires connection, no relay username in URL */}
            <Route element={<ConnectionGate />}>{APP_ROUTES}</Route>

            {/* Relay mode — manages relay connection by URL username.
                React Router ranks static segments above dynamic params,
                so /projects matches ConnectionGate, not /:relayUsername. */}
            <Route path="/:relayUsername" element={<RelayConnectionGate />}>
              {APP_ROUTES}
            </Route>
          </Routes>
        </RemoteApp>
      </I18nProvider>
    </BrowserRouter>
  </Wrapper>,
);
