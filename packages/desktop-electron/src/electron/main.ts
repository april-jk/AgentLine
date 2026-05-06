import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { ServerManager, type ServerStatus } from "./serverManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(packageRoot, "../..");

const DASHBOARD_PORT = 3400;
const DASHBOARD_URL = `http://localhost:${DASHBOARD_PORT}`;
const DASHBOARD_HEALTH_URL = `${DASHBOARD_URL}/health`;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let recoverInFlight = false;
let dashboardAttachTimer: ReturnType<typeof setInterval> | null = null;

const runtimeRoot = path.join(process.resourcesPath, "runtime", "agentline");

const serverManager = new ServerManager({
  repoRoot,
  runtimeRoot,
  packaged: app.isPackaged,
  dataDir: path.join(app.getPath("userData"), "agentline-data"),
  port: DASHBOARD_PORT,
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

const recoverServer = async (reason: string): Promise<void> => {
  if (isQuitting || recoverInFlight) {
    return;
  }

  recoverInFlight = true;
  try {
    console.warn(`[desktop-electron] Recover server triggered: ${reason}`);
    await serverManager.restart();
    await tryAttachDashboard();
  } catch (error) {
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
  const image = nativeImage
    .createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAKUlEQVR42mP8//8/Azbw////JxJQ0f///5mBiYGBQYEwGoaGhoZA1AAAwQwH+bgvi7wAAAABJRU5ErkJggg==",
    )
    .resize({ width: 16, height: 16 });

  tray = new Tray(image);
  tray.setToolTip("AgentLine Desktop Electron");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Dashboard",
      click: () => {
        void shell.openExternal(DASHBOARD_URL);
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
    if (!mainWindow) {
      void createWindow();
      return;
    }
    mainWindow.show();
    mainWindow.focus();
  });
};

const registerIpcHandlers = (): void => {
  ipcMain.handle("server:get-status", () => serverManager.getStatus());
  ipcMain.handle("server:start", () => serverManager.start());
  ipcMain.handle("server:stop", () => serverManager.stop());
  ipcMain.handle("server:restart", () => serverManager.restart());
  ipcMain.handle("server:open-dashboard", async () => {
    await shell.openExternal(DASHBOARD_URL);
  });
};

app.whenReady().then(async () => {
  registerIpcHandlers();
  serverManager.on("status", (status) => {
    broadcastStatus(status);
    if (status.state === "error") {
      void recoverServer(status.message ?? "unknown server error");
    }
  });

  await serverManager.start();
  await createWindow();
  createTray();

  dashboardAttachTimer = setInterval(() => {
    void tryAttachDashboard();
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
