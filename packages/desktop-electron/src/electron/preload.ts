import { contextBridge, ipcRenderer } from "electron";
import type { ServerStatus } from "./serverManager.js";

interface ServerRuntimeState {
  backendReachable: boolean;
  autoRecoverCount: number;
  lastRecoverAt?: number;
  lastRecoverReason?: string;
  lastRecoverError?: string;
  recovering: boolean;
}

interface ControlPlanePublicConfig {
  baseUrl?: string;
  relayWsUrl?: string;
  lastEmail?: string;
  hasAccessToken: boolean;
}

interface ControlPlaneLoginPayload {
  baseUrl: string;
  email: string;
  password: string;
  relayWsUrl?: string;
}

const api = {
  getServerStatus: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("server:get-status"),
  getServerRuntimeState: (): Promise<ServerRuntimeState> =>
    ipcRenderer.invoke("server:get-runtime-state"),
  startServer: (): Promise<ServerStatus> => ipcRenderer.invoke("server:start"),
  stopServer: (): Promise<ServerStatus> => ipcRenderer.invoke("server:stop"),
  restartServer: (): Promise<ServerStatus> =>
    ipcRenderer.invoke("server:restart"),
  openDashboard: (): Promise<void> =>
    ipcRenderer.invoke("server:open-dashboard"),
  getControlPlaneConfig: (): Promise<ControlPlanePublicConfig> =>
    ipcRenderer.invoke("control-plane:get-config"),
  getControlPlaneStatus: (): Promise<unknown> =>
    ipcRenderer.invoke("control-plane:get-status"),
  loginControlPlane: (
    payload: ControlPlaneLoginPayload,
  ): Promise<ControlPlanePublicConfig> =>
    ipcRenderer.invoke("control-plane:login", payload),
  clearControlPlane: (): Promise<ControlPlanePublicConfig> =>
    ipcRenderer.invoke("control-plane:clear"),
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
