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

import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Toggle to disable StrictMode for easier debugging (avoids double renders)
const STRICT_MODE = false;
const Wrapper = STRICT_MODE ? StrictMode : Fragment;

import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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

  window.setTimeout(() => {
    const rootStyles = window.getComputedStyle(document.documentElement);
    const hasThemeVar =
      rootStyles.getPropertyValue("--text-primary").trim().length > 0;
    if (hasThemeVar) return;

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
      retryLink.href = `${href}${href.includes("?") ? "&" : "?"}v=${Date.now()}`;
      document.head.appendChild(retryLink);
    }
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
              <Route path="/login" element={<HostPickerPage />} />
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
