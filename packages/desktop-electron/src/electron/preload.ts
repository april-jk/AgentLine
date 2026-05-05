import { contextBridge, ipcRenderer } from "electron";
import type { ServerStatus } from "./serverManager.js";

const api = {
  getServerStatus: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("server:get-status"),
  startServer: (): Promise<ServerStatus> => ipcRenderer.invoke("server:start"),
  stopServer: (): Promise<ServerStatus> => ipcRenderer.invoke("server:stop"),
  restartServer: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("server:restart"),
  openDashboard: (): Promise<void> =>
    ipcRenderer.invoke("server:open-dashboard"),
  onServerStatusChange: (
    listener: (status: ServerStatus) => void,
  ): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, status: ServerStatus) =>
      listener(status);
    ipcRenderer.on("server:status", wrapped);
    return () => {
      ipcRenderer.removeListener("server:status", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("desktopApi", api);
