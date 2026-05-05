export {};

type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

interface ServerStatus {
  state: ServerState;
  pid: number | null;
  port: number;
  message?: string;
  startedAt?: number;
}

interface DesktopApi {
  getServerStatus: () => Promise<ServerStatus>;
  startServer: () => Promise<ServerStatus>;
  stopServer: () => Promise<ServerStatus>;
  restartServer: () => Promise<ServerStatus>;
  openDashboard: () => Promise<void>;
  onServerStatusChange: (listener: (status: ServerStatus) => void) => () => void;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
