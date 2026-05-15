import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
} from "electron";
import { DESKTOP_DISCOVERY_PORT_CANDIDATES } from "../../../shared/dist/desktop-discovery.js";
import {
  type ControlPlaneConfig,
  ServerManager,
  type ServerStatus,
} from "./serverManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(packageRoot, "../..");

interface ServerRuntimeState {
  backendReachable: boolean;
  autoRecoverCount: number;
  lastRecoverAt?: number;
  lastRecoverReason?: string;
  lastRecoverError?: string;
  recovering: boolean;
}

interface DesktopControlPlaneConfig extends ControlPlaneConfig {
  lastEmail?: string;
}

interface DesktopAppConfig {
  controlPlane?: DesktopControlPlaneConfig;
}

interface ControlPlaneLoginPayload {
  baseUrl: string;
  email: string;
  password: string;
  relayWsUrl?: string;
}

interface ControlPlaneLoginResponse {
  accessToken: string;
  expiresAt: string;
}

interface ControlPlaneAccountUser {
  id: string;
  email: string;
  createdAt: string;
}

interface ControlPlanePublicConfig {
  baseUrl?: string;
  relayWsUrl?: string;
  lastEmail?: string;
  hasAccessToken: boolean;
}

interface ControlPlaneAccountSummary extends ControlPlanePublicConfig {
  authenticated: boolean;
  user?: ControlPlaneAccountUser;
}

interface ControlPlaneAccountUpdatePayload {
  currentPassword: string;
  email?: string;
  newPassword?: string;
}

interface RemoteAccessConfig {
  enabled: boolean;
  username: string | null;
  hostAccessConfigured: boolean;
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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let recoverInFlight = false;
let dashboardAttachTimer: ReturnType<typeof setInterval> | null = null;
let consecutiveHealthFailures = 0;
let autoRecoverCount = 0;
let lastRecoverAt: number | undefined;
let lastRecoverReason: string | undefined;
let lastRecoverError: string | undefined;
let dashboardPort: number = DESKTOP_DISCOVERY_PORT_CANDIDATES[0];
let serverManager: ServerManager | null = null;
const FALLBACK_PORT_SCAN_START = 46000;
const FALLBACK_PORT_SCAN_END = 64998;
const FALLBACK_PORT_SCAN_STEP = 3;

const runtimeRoot = path.join(process.resourcesPath, "runtime", "agentline");
const desktopConfigPath = path.join(
  app.getPath("userData"),
  "desktop-config.json",
);

let desktopConfig: DesktopAppConfig = {};

const deriveRelayWsUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
};

const normalizeHttpUrl = (urlInput: string): string =>
  urlInput.trim().replace(/\/+$/, "");

const getControlPlanePublicConfig = (): ControlPlanePublicConfig => ({
  baseUrl: desktopConfig.controlPlane?.baseUrl,
  relayWsUrl: desktopConfig.controlPlane?.relayWsUrl,
  lastEmail: desktopConfig.controlPlane?.lastEmail,
  hasAccessToken: Boolean(desktopConfig.controlPlane?.accessToken),
});

const getControlPlaneAuthContext = (): {
  baseUrl: string;
  accessToken: string;
} | null => {
  const baseUrl = desktopConfig.controlPlane?.baseUrl?.trim();
  const accessToken = desktopConfig.controlPlane?.accessToken?.trim();
  if (!baseUrl || !accessToken) {
    return null;
  }
  return { baseUrl, accessToken };
};

const fetchControlPlaneUser = async (): Promise<ControlPlaneAccountUser> => {
  const auth = getControlPlaneAuthContext();
  if (!auth) {
    throw new Error("control_plane_not_configured");
  }
  const response = await fetch(`${auth.baseUrl}/api/v1/me`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    let message = `me_failed_${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as { user: ControlPlaneAccountUser };
  return payload.user;
};

const getControlPlaneAccount =
  async (): Promise<ControlPlaneAccountSummary> => {
    const config = getControlPlanePublicConfig();
    if (!config.hasAccessToken) {
      return { ...config, authenticated: false };
    }

    try {
      const user = await fetchControlPlaneUser();
      return {
        ...config,
        authenticated: true,
        user,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "unauthorized" || code.startsWith("me_failed_401")) {
        desktopConfig.controlPlane = {
          ...(desktopConfig.controlPlane ?? {}),
          accessToken: "",
        };
        await saveDesktopConfig();
        getServerManager().updateControlPlaneConfig(desktopConfig.controlPlane);
        return {
          ...getControlPlanePublicConfig(),
          authenticated: false,
        };
      }
      return { ...config, authenticated: false };
    }
  };

const loadDesktopConfig = async (): Promise<void> => {
  try {
    const raw = await readFile(desktopConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as DesktopAppConfig;
    desktopConfig = parsed ?? {};
  } catch {
    desktopConfig = {};
  }
};

const saveDesktopConfig = async (): Promise<void> => {
  await writeFile(
    desktopConfigPath,
    JSON.stringify(desktopConfig, null, 2),
    "utf-8",
  );
};

const getServerManager = (): ServerManager => {
  if (!serverManager) {
    throw new Error("Server manager not initialized");
  }
  return serverManager;
};

const getDashboardBaseUrl = (): string => `http://127.0.0.1:${dashboardPort}`;

const getDashboardUrl = (): string => getServerManager().getDashboardUrl();

const isDashboardLocation = (url: string): boolean =>
  url === getDashboardBaseUrl() || url.startsWith(`${getDashboardBaseUrl()}/`);

const portIsAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });

const findAvailablePortTriple = async (
  candidates: Iterable<number>,
): Promise<number | null> => {
  for (const candidate of candidates) {
    const [dashboardOk, maintenanceOk, viteOk] = await Promise.all([
      portIsAvailable(candidate),
      portIsAvailable(candidate + 1),
      portIsAvailable(candidate + 2),
    ]);

    if (dashboardOk && maintenanceOk && viteOk) {
      return candidate;
    }
  }
  return null;
};

const resolveDashboardPort = async (): Promise<number> => {
  const preferredPort = await findAvailablePortTriple(
    DESKTOP_DISCOVERY_PORT_CANDIDATES,
  );
  if (preferredPort !== null) {
    return preferredPort;
  }

  const fallbackCandidates: number[] = [];
  for (
    let candidate = FALLBACK_PORT_SCAN_START;
    candidate <= FALLBACK_PORT_SCAN_END;
    candidate += FALLBACK_PORT_SCAN_STEP
  ) {
    fallbackCandidates.push(candidate);
  }
  const fallbackPort = await findAvailablePortTriple(fallbackCandidates);
  if (fallbackPort !== null) {
    console.warn(
      `[desktop-electron] Preferred desktop discovery ports are busy; falling back to ${fallbackPort}-${fallbackPort + 2}`,
    );
    return fallbackPort;
  }

  throw new Error(
    "Unable to find a free dashboard/maintenance/Vite port triple (preferred and fallback ranges exhausted).",
  );
};

const broadcastStatus = (status: ServerStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("server:status", status);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isDashboardReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${getDashboardBaseUrl()}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const isDashboardContentReady = async (): Promise<boolean> => {
  try {
    const response = await fetch(getDashboardUrl(), {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.text();
    return !body.includes("Vite dev server not available");
  } catch {
    return false;
  }
};

const getRuntimeState = async (): Promise<ServerRuntimeState> => ({
  backendReachable: await isDashboardReachable(),
  autoRecoverCount,
  lastRecoverAt,
  lastRecoverReason,
  lastRecoverError,
  recovering: recoverInFlight,
});

const fetchControlPlaneBridgeStatus = async (): Promise<unknown> => {
  if (!(await isDashboardReachable())) {
    return {
      enabled: false,
      running: false,
      pausedReason: "backend_unreachable",
      consecutiveFailures: 0,
    };
  }

  const response = await fetch(
    `${getDashboardBaseUrl()}/api/remote-access/control-plane/status`,
    {
      signal: AbortSignal.timeout(2000),
      headers: {
        "x-agentline-api": "desktop-electron",
      },
    },
  );

  if (!response.ok) {
    return {
      enabled: false,
      running: false,
      pausedReason: `status_${response.status}`,
      consecutiveFailures: 0,
    };
  }

  return (await response.json()) as unknown;
};

const loginToControlPlane = async (
  payload: ControlPlaneLoginPayload,
): Promise<ControlPlanePublicConfig> => {
  const baseUrl = normalizeHttpUrl(payload.baseUrl);
  const relayWsUrl =
    payload.relayWsUrl && payload.relayWsUrl.trim().length > 0
      ? payload.relayWsUrl.trim()
      : deriveRelayWsUrl(baseUrl);

  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email.trim(),
      password: payload.password,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    let message = `login_failed_${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const data = (await response.json()) as ControlPlaneLoginResponse;
  desktopConfig.controlPlane = {
    baseUrl,
    relayWsUrl,
    accessToken: data.accessToken,
    lastEmail: payload.email.trim(),
    deviceType: "desktop-electron",
  };
  await saveDesktopConfig();
  getServerManager().updateControlPlaneConfig(desktopConfig.controlPlane);
  await getServerManager().restart();
  await waitForControlPlaneSync();
  return getControlPlanePublicConfig();
};

const registerControlPlaneAccount = async (
  payload: ControlPlaneLoginPayload,
): Promise<ControlPlanePublicConfig> => {
  const baseUrl = normalizeHttpUrl(payload.baseUrl);
  const registerResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email.trim(),
      password: payload.password,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!registerResponse.ok && registerResponse.status !== 409) {
    let message = `register_failed_${registerResponse.status}`;
    try {
      const data = (await registerResponse.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return loginToControlPlane(payload);
};

const updateControlPlaneAccount = async (
  payload: ControlPlaneAccountUpdatePayload,
): Promise<ControlPlaneAccountSummary> => {
  const auth = getControlPlaneAuthContext();
  if (!auth) {
    throw new Error("control_plane_not_configured");
  }

  const response = await fetch(`${auth.baseUrl}/api/v1/me`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: payload.currentPassword,
      email: payload.email,
      newPassword: payload.newPassword,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    let message = `update_failed_${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  const result = (await response.json()) as { user: ControlPlaneAccountUser };
  if (desktopConfig.controlPlane) {
    desktopConfig.controlPlane.lastEmail = result.user.email;
  }
  await saveDesktopConfig();
  return {
    ...getControlPlanePublicConfig(),
    authenticated: true,
    user: result.user,
  };
};

const logoutControlPlane = async (): Promise<ControlPlaneAccountSummary> => {
  const auth = getControlPlaneAuthContext();
  if (auth) {
    try {
      await fetch(`${auth.baseUrl}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
        },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // ignore network errors on logout, local token clear is authoritative
    }
  }

  try {
    await callDesktopProtectedApi<{ success: boolean }>(
      "/api/remote-access/control-plane/config",
      {
        method: "DELETE",
      },
    );
  } catch (error) {
    console.warn(
      "[desktop-electron] Failed to clear control-plane bridge during logout:",
      error,
    );
  }

  desktopConfig.controlPlane = {
    ...(desktopConfig.controlPlane ?? {}),
    accessToken: "",
  };
  await saveDesktopConfig();
  getServerManager().updateControlPlaneConfig(desktopConfig.controlPlane);
  await getServerManager().restart();
  return {
    ...getControlPlanePublicConfig(),
    authenticated: false,
  };
};

const callDesktopProtectedApi = async <T>(
  path: string,
  init: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("x-agentline-api", "desktop-electron");
  headers.set("x-desktop-token", getServerManager().getDesktopAuthToken());

  const response = await fetch(`${getDashboardBaseUrl()}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    let message = `request_failed_${response.status}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) {
        message = data.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
};

const waitForControlPlaneSync = async (): Promise<ControlPlaneBridgeState> => {
  const maxAttempts = 8;
  let lastError = "control_plane_sync_unavailable";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const ready = await waitForDashboard();
    if (!ready) {
      lastError = "dashboard_unavailable";
      await sleep(250);
      continue;
    }

    try {
      const state = await callDesktopProtectedApi<ControlPlaneBridgeState>(
        "/api/remote-access/control-plane/sync",
        {
          method: "POST",
        },
      );
      if (state.pausedReason === "unauthorized") {
        throw new Error("control_plane_unauthorized");
      }
      if (state.deviceId && state.relayUsername) {
        return state;
      }
      lastError = state.lastError ?? state.pausedReason ?? "sync_incomplete";
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "control_plane_sync_failed";
    }

    await sleep(300);
  }

  throw new Error(lastError);
};

const getRemoteAccessConfig = async (): Promise<RemoteAccessConfig> =>
  callDesktopProtectedApi<RemoteAccessConfig>("/api/remote-access/config");

const configureRemoteAccessPassword = async (
  password: string,
): Promise<RemoteAccessConfig> => {
  await callDesktopProtectedApi<{ success: boolean; username: string | null }>(
    "/api/remote-access/configure",
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
  return getRemoteAccessConfig();
};

const waitForDashboard = async (): Promise<boolean> => {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isDashboardContentReady()) {
      return true;
    }
    await sleep(250);
  }
  return false;
};

const ensureBackendReady = async (): Promise<boolean> => {
  const maxBootstrapAttempts = 3;
  for (let attempt = 1; attempt <= maxBootstrapAttempts; attempt += 1) {
    await getServerManager().start();
    const healthy = await waitForDashboard();
    if (healthy) {
      return true;
    }

    console.warn(
      `[desktop-electron] Backend bootstrap health timeout (attempt ${attempt}/${maxBootstrapAttempts}).`,
    );
    await recoverServer(
      `bootstrap health timeout (attempt ${attempt}/${maxBootstrapAttempts})`,
    );
    if (await waitForDashboard()) {
      return true;
    }
  }

  return false;
};

const tryAttachDashboard = async (): Promise<void> => {
  if (!mainWindow) {
    return;
  }
  const currentUrl = mainWindow.webContents.getURL();
  if (isDashboardLocation(currentUrl)) {
    return;
  }

  const ready = await waitForDashboard();
  if (!ready) {
    return;
  }

  await mainWindow.loadURL(getDashboardUrl());
};

const openMainProgram = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
  await tryAttachDashboard();
};

const recoverServer = async (reason: string): Promise<void> => {
  if (isQuitting || recoverInFlight) {
    return;
  }

  autoRecoverCount += 1;
  lastRecoverAt = Date.now();
  lastRecoverReason = reason;
  lastRecoverError = undefined;
  recoverInFlight = true;
  try {
    console.warn(`[desktop-electron] Recover server triggered: ${reason}`);
    await getServerManager().restart();
    await tryAttachDashboard();
  } catch (error) {
    lastRecoverError = error instanceof Error ? error.message : String(error);
    console.error(
      `[desktop-electron] Recover server failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    recoverInFlight = false;
  }
};

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    title: "AgentLine Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `[desktop-electron] renderer load failed: ${errorCode} ${errorDescription} ${validatedURL}`,
      );
    },
  );

  await waitForDashboard();
  await mainWindow.loadURL(getDashboardUrl());

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const createTray = (): void => {
  const trayIconPath = path.join(
    packageRoot,
    "runtime",
    "agentline",
    "client-dist",
    "icon-192.png",
  );
  const imageFromFile = nativeImage.createFromPath(trayIconPath);
  const image = imageFromFile.isEmpty()
    ? nativeImage
        .createFromDataURL(
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAKUlEQVR42mP8//8/Azbw////JxJQ0f///5mBiYGBQYEwGoaGhoZA1AAAwQwH+bgvi7wAAAABJRU5ErkJggg==",
        )
        .resize({ width: 16, height: 16 })
    : imageFromFile.resize({ width: 16, height: 16 });

  tray = new Tray(image);
  tray.setToolTip("AgentLine Desktop Electron");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        void openMainProgram();
      },
    },
    {
      label: "Restart Server",
      click: () => {
        void getServerManager().restart();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    void openMainProgram();
  });
};

const registerIpcHandlers = (): void => {
  ipcMain.handle("server:get-status", () => getServerManager().getStatus());
  ipcMain.handle("server:get-runtime-state", () => getRuntimeState());
  ipcMain.handle("server:start", () => getServerManager().start());
  ipcMain.handle("server:stop", () => getServerManager().stop());
  ipcMain.handle("server:restart", () => getServerManager().restart());
  ipcMain.handle("server:open-dashboard", async () => {
    await openMainProgram();
  });
  ipcMain.handle("control-plane:get-config", () =>
    getControlPlanePublicConfig(),
  );
  ipcMain.handle("control-plane:get-account", () => getControlPlaneAccount());
  ipcMain.handle("control-plane:get-status", () =>
    fetchControlPlaneBridgeStatus(),
  );
  ipcMain.handle(
    "control-plane:login",
    async (_event, payload: ControlPlaneLoginPayload) =>
      loginToControlPlane(payload),
  );
  ipcMain.handle(
    "control-plane:register",
    async (_event, payload: ControlPlaneLoginPayload) =>
      registerControlPlaneAccount(payload),
  );
  ipcMain.handle("control-plane:clear", async () => {
    desktopConfig.controlPlane = undefined;
    await saveDesktopConfig();
    getServerManager().updateControlPlaneConfig({});
    await getServerManager().restart();
    return getControlPlanePublicConfig();
  });
  ipcMain.handle(
    "control-plane:update-account",
    async (_event, payload: ControlPlaneAccountUpdatePayload) =>
      updateControlPlaneAccount(payload),
  );
  ipcMain.handle("control-plane:logout", () => logoutControlPlane());
  ipcMain.handle("remote-access:get-config", () => getRemoteAccessConfig());
  ipcMain.handle(
    "remote-access:configure",
    async (_event, payload: { password?: string }) => {
      if (!payload.password?.trim()) {
        throw new Error("password_required");
      }
      return configureRemoteAccessPassword(payload.password);
    },
  );
};

app
  .whenReady()
  .then(async () => {
    await loadDesktopConfig();
    dashboardPort = await resolveDashboardPort();
    serverManager = new ServerManager({
      repoRoot,
      runtimeRoot,
      packaged: app.isPackaged,
      dataDir: path.join(app.getPath("userData"), "agentline-data"),
      port: dashboardPort,
      controlPlane: desktopConfig.controlPlane,
    });

    getServerManager().updateControlPlaneConfig(
      desktopConfig.controlPlane ?? {},
    );
    registerIpcHandlers();
    getServerManager().on("status", (status) => {
      broadcastStatus(status);
      if (status.state === "error") {
        void recoverServer(status.message ?? "unknown server error");
      }
    });

    await ensureBackendReady();
    await createWindow();
    createTray();

    dashboardAttachTimer = setInterval(() => {
      void (async () => {
        const reachable = await isDashboardReachable();
        if (reachable) {
          consecutiveHealthFailures = 0;
          await tryAttachDashboard();
          return;
        }

        consecutiveHealthFailures += 1;
        if (consecutiveHealthFailures >= 3) {
          consecutiveHealthFailures = 0;
          await recoverServer("periodic health probe failed 3 times");
        }
      })();
    }, 4000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? `${error.message}\n\n${error.stack ?? ""}`
        : String(error);
    console.error("[desktop-electron] Failed to initialize app", error);
    dialog.showErrorBox("AgentLine Desktop startup failed", message);
    app.quit();
  });

app.on("before-quit", async () => {
  isQuitting = true;
  if (dashboardAttachTimer) {
    clearInterval(dashboardAttachTimer);
    dashboardAttachTimer = null;
  }
  if (serverManager) {
    await getServerManager().stop();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
