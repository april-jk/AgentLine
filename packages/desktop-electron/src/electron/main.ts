import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
} from "electron";
import {
  ServerManager,
  type ControlPlaneConfig,
  type ServerStatus,
} from "./serverManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(packageRoot, "../..");

// Use uncommon, desktop-dedicated ports to avoid clashing with common
// development ports (3000/3400/5173/etc).
const DASHBOARD_PORT = 45731;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const DASHBOARD_HEALTH_URL = `${DASHBOARD_URL}/health`;

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

interface ControlPlanePublicConfig {
  baseUrl?: string;
  relayWsUrl?: string;
  lastEmail?: string;
  hasAccessToken: boolean;
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

const runtimeRoot = path.join(process.resourcesPath, "runtime", "agentline");
const desktopConfigPath = path.join(app.getPath("userData"), "desktop-config.json");

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
  await writeFile(desktopConfigPath, JSON.stringify(desktopConfig, null, 2), "utf-8");
};

const serverManager = new ServerManager({
  repoRoot,
  runtimeRoot,
  packaged: app.isPackaged,
  dataDir: path.join(app.getPath("userData"), "agentline-data"),
  port: DASHBOARD_PORT,
  controlPlane: desktopConfig.controlPlane,
});

const broadcastStatus = (status: ServerStatus): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("server:status", status);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isDashboardReachable = async (): Promise<boolean> => {
  try {
    const response = await fetch(DASHBOARD_HEALTH_URL, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
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
    `${DASHBOARD_URL}/api/remote-access/control-plane/status`,
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
  serverManager.updateControlPlaneConfig(desktopConfig.controlPlane);
  await serverManager.restart();
  return getControlPlanePublicConfig();
};

const waitForDashboard = async (): Promise<boolean> => {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isDashboardReachable()) {
      return true;
    }
    await sleep(250);
  }
  return false;
};

const ensureBackendReady = async (): Promise<boolean> => {
  const maxBootstrapAttempts = 3;
  for (let attempt = 1; attempt <= maxBootstrapAttempts; attempt += 1) {
    await serverManager.start();
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
  if (currentUrl.startsWith(DASHBOARD_URL)) {
    return;
  }

  const ready = await waitForDashboard();
  if (!ready) {
    return;
  }

  await mainWindow.loadURL(DASHBOARD_URL);
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
    await serverManager.restart();
    await tryAttachDashboard();
  } catch (error) {
    lastRecoverError =
      error instanceof Error ? error.message : String(error);
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

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    const dashboardReady = await waitForDashboard();
    if (dashboardReady) {
      await mainWindow.loadURL(DASHBOARD_URL);
    } else {
      console.error(
        "[desktop-electron] Dashboard health check timeout, fallback to local control panel renderer.",
      );
      await mainWindow.loadFile(path.resolve(__dirname, "../../dist/index.html"));
    }
  }

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
        void serverManager.restart();
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
  ipcMain.handle("server:get-status", () => serverManager.getStatus());
  ipcMain.handle("server:get-runtime-state", () => getRuntimeState());
  ipcMain.handle("server:start", () => serverManager.start());
  ipcMain.handle("server:stop", () => serverManager.stop());
  ipcMain.handle("server:restart", () => serverManager.restart());
  ipcMain.handle("server:open-dashboard", async () => {
    await openMainProgram();
  });
  ipcMain.handle("control-plane:get-config", () => getControlPlanePublicConfig());
  ipcMain.handle("control-plane:get-status", () => fetchControlPlaneBridgeStatus());
  ipcMain.handle(
    "control-plane:login",
    async (_event, payload: ControlPlaneLoginPayload) =>
      loginToControlPlane(payload),
  );
  ipcMain.handle("control-plane:clear", async () => {
    desktopConfig.controlPlane = undefined;
    await saveDesktopConfig();
    serverManager.updateControlPlaneConfig({});
    await serverManager.restart();
    return getControlPlanePublicConfig();
  });
};

app.whenReady().then(async () => {
  await loadDesktopConfig();
  serverManager.updateControlPlaneConfig(desktopConfig.controlPlane ?? {});
  registerIpcHandlers();
  serverManager.on("status", (status) => {
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
});

app.on("before-quit", async () => {
  isQuitting = true;
  if (dashboardAttachTimer) {
    clearInterval(dashboardAttachTimer);
    dashboardAttachTimer = null;
  }
  await serverManager.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
