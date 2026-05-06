export {};

type ServerState = "stopped" | "starting" | "running" | "stopping" | "error";

interface ServerStatus {
  state: ServerState;
  pid: number | null;
  port: number;
  message?: string;
  startedAt?: number;
}

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

interface DesktopApi {
  getServerStatus: () => Promise<ServerStatus>;
  getServerRuntimeState: () => Promise<ServerRuntimeState>;
  startServer: () => Promise<ServerStatus>;
  stopServer: () => Promise<ServerStatus>;
  restartServer: () => Promise<ServerStatus>;
  openDashboard: () => Promise<void>;
  getControlPlaneConfig: () => Promise<ControlPlanePublicConfig>;
  getControlPlaneStatus: () => Promise<unknown>;
  loginControlPlane: (
    payload: ControlPlaneLoginPayload,
  ) => Promise<ControlPlanePublicConfig>;
  clearControlPlane: () => Promise<ControlPlanePublicConfig>;
  onServerStatusChange: (listener: (status: ServerStatus) => void) => () => void;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
