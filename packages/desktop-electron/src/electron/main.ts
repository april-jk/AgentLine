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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

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

const createWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 620,
    title: "AgentLine Electron",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await mainWindow.loadURL(devUrl);
  } else {
    await mainWindow.loadFile(path.resolve(__dirname, "../../dist/index.html"));
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
  serverManager.on("status", broadcastStatus);

  await createWindow();
  createTray();
  await serverManager.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", async () => {
  await serverManager.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
