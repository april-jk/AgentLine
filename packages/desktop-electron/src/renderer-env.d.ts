export {};

/** Build-time version from package.json (injected by Vite define). */
declare global {
  const __APP_VERSION__: string;
}

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

interface ControlPlaneAccountUser {
  id: string;
  email: string;
  createdAt: string;
}

interface ControlPlaneAccountSummary extends ControlPlanePublicConfig {
  authenticated: boolean;
  user?: ControlPlaneAccountUser;
}

interface ControlPlaneLoginPayload {
  baseUrl: string;
  email: string;
  password: string;
  relayWsUrl?: string;
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

interface DesktopApi {
  getServerStatus: () => Promise<ServerStatus>;
  getServerRuntimeState: () => Promise<ServerRuntimeState>;
  startServer: () => Promise<ServerStatus>;
  stopServer: () => Promise<ServerStatus>;
  restartServer: () => Promise<ServerStatus>;
  openDashboard: () => Promise<void>;
  getControlPlaneConfig: () => Promise<ControlPlanePublicConfig>;
  getControlPlaneAccount: () => Promise<ControlPlaneAccountSummary>;
  getControlPlaneStatus: () => Promise<unknown>;
  loginControlPlane: (
    payload: ControlPlaneLoginPayload,
  ) => Promise<ControlPlanePublicConfig>;
  registerControlPlane: (
    payload: ControlPlaneLoginPayload,
  ) => Promise<ControlPlanePublicConfig>;
  clearControlPlane: () => Promise<ControlPlanePublicConfig>;
  updateControlPlaneAccount: (
    payload: ControlPlaneAccountUpdatePayload,
  ) => Promise<ControlPlaneAccountSummary>;
  logoutControlPlane: () => Promise<ControlPlaneAccountSummary>;
  getRemoteAccessConfig: () => Promise<RemoteAccessConfig>;
  configureRemoteAccessPassword: (password: string) => Promise<RemoteAccessConfig>;
  onServerStatusChange: (listener: (status: ServerStatus) => void) => () => void;
}

declare global {
  interface Window {
    desktopApi: DesktopApi;
  }
}
