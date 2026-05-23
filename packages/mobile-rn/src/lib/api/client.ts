import { DEFAULT_CONTROL_PLANE_URL as PUBLIC_CONTROL_PLANE_URL } from "../../../../shared/dist/relay-defaults.js";

export type LoginRequest = {
  email: string;
  password: string;
};

export type ConnectionMode = "relay" | "direct";

export type AccountUser = {
  id: string;
  email: string;
  createdAt: string;
};

export type LoginResponse = {
  accessToken: string;
  expiresAt: string;
  user: AccountUser;
};

export type HostItem = {
  id: string;
  name: string;
  status: "online" | "offline";
  relayState: "offline" | "waiting" | "paired";
  relayUsername: string;
  installId?: string;
  deviceType: string;
  heartbeatLastSeenAt?: string;
  heartbeatAgeMs?: number;
  heartbeatOfflineTimeoutMs?: number;
  heartbeatOffline?: boolean;
  heartbeatFresh: boolean;
  hostServiceListening?: boolean;
  lanEndpoint?: {
    address: string;
    port: number;
  } | null;
};

export type SessionPlaceholder = {
  hostId: string;
  relayUsername: string;
  state: "pending";
  message: string;
};

export type RelayClientConnectGrant = {
  grant: string;
  grantId: string;
  expiresAt: string;
  relayUsername: string;
  deviceId: string;
};

type ControlPlaneDevice = {
  id: string;
  deviceName: string;
  deviceType: string;
  installId?: string;
  relayUsername: string;
  relayState: "offline" | "waiting" | "paired";
  lastSeenAt?: string;
  machine?: {
    hostService?: {
      listening?: boolean;
    };
    heartbeat?: {
      lastSeenAt?: string;
      ageMs?: number;
      offlineTimeoutMs?: number;
      offline?: boolean;
    };
    endpoints?: {
      lan?: {
        address?: string;
        port?: number;
      } | null;
    };
  };
};

const RELAY_HEARTBEAT_STALE_MS = 60 * 1000;

const maybeEnv = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env;

export const DEFAULT_CONTROL_PLANE_URL =
  maybeEnv?.EXPO_PUBLIC_CONTROL_PLANE_URL?.trim() || PUBLIC_CONTROL_PLANE_URL;

function resolveHeartbeatAgeMs(lastSeenAt?: string): number | undefined {
  if (!lastSeenAt) return undefined;
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return undefined;
  const ageMs = Date.now() - lastSeenMs;
  return ageMs >= 0 ? ageMs : 0;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;

  constructor(status: number, code: string, message: string, details?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function normalizeHttpBaseUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return normalizeBaseUrl(value);
  }
  if (value.startsWith("ws://")) {
    return normalizeBaseUrl(value.replace("ws://", "http://"));
  }
  if (value.startsWith("wss://")) {
    return normalizeBaseUrl(value.replace("wss://", "https://"));
  }
  return normalizeBaseUrl(`http://${value}`);
}

export function normalizeWsUrl(rawValue: string): string {
  let wsUrl = rawValue.trim();
  if (wsUrl.startsWith("http://")) {
    wsUrl = wsUrl.replace("http://", "ws://");
  } else if (wsUrl.startsWith("https://")) {
    wsUrl = wsUrl.replace("https://", "wss://");
  } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
    wsUrl = `ws://${wsUrl}`;
  }
  if (!wsUrl.endsWith("/api/ws")) {
    wsUrl = `${wsUrl.replace(/\/$/, "")}/api/ws`;
  }
  return wsUrl;
}

export function toDirectWsUrl(rawHttpBaseUrl: string): string {
  const base = normalizeHttpBaseUrl(rawHttpBaseUrl);
  return normalizeWsUrl(`${base}/api/ws`);
}

export class ApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    accessToken?: string,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const requestUrl = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        ...init,
        headers,
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(
        `无法连接平台服务 ${this.baseUrl}。请检查网络连接或稍后重试。${details ? ` (${details})` : ""}`,
      );
    }
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let code = `request_failed_${response.status}`;
      let details: string | undefined;
      try {
        const data = (await response.json()) as {
          error?: string;
          message?: string;
        };
        if (data.error) {
          code = data.error;
          message = data.message?.trim() || data.error;
          details = data.message?.trim() || undefined;
        }
      } catch {
        // ignore non-JSON error body
      }
      throw new ApiRequestError(response.status, code, message, details);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  async login(payload: LoginRequest): Promise<LoginResponse> {
    if (!payload.email || !payload.password) {
      throw new Error("Email and password are required.");
    }

    return this.request<LoginResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async register(payload: LoginRequest): Promise<LoginResponse> {
    if (!payload.email || !payload.password) {
      throw new Error("Email and password are required.");
    }

    await this.request<{ user: AccountUser }>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    return this.login(payload);
  }

  async listHosts(accessToken: string): Promise<HostItem[]> {
    const payload = await this.request<{ devices: ControlPlaneDevice[] }>(
      "/api/v1/devices",
      { method: "GET" },
      accessToken,
    );

    return payload.devices.map((device) => ({
      ...(() => {
        const heartbeatAgeMs =
          typeof device.machine?.heartbeat?.ageMs === "number"
            ? Math.max(0, device.machine.heartbeat.ageMs)
            : resolveHeartbeatAgeMs(
                device.machine?.heartbeat?.lastSeenAt ?? device.lastSeenAt,
              );
        const heartbeatOfflineTimeoutMs =
          typeof device.machine?.heartbeat?.offlineTimeoutMs === "number"
            ? Math.max(0, device.machine.heartbeat.offlineTimeoutMs)
            : RELAY_HEARTBEAT_STALE_MS;
        const heartbeatOffline =
          device.machine?.heartbeat?.offline === true ||
          (typeof heartbeatAgeMs === "number"
            ? heartbeatAgeMs > heartbeatOfflineTimeoutMs
            : true);
        const heartbeatFresh =
          !heartbeatOffline &&
          typeof heartbeatAgeMs === "number" &&
          heartbeatAgeMs <= heartbeatOfflineTimeoutMs;
        return {
          heartbeatAgeMs,
          heartbeatOfflineTimeoutMs,
          heartbeatOffline,
          heartbeatFresh,
        };
      })(),
      heartbeatLastSeenAt:
        device.machine?.heartbeat?.lastSeenAt ?? device.lastSeenAt,
      id: device.id,
      installId: device.installId,
      hostServiceListening: device.machine?.hostService?.listening,
      lanEndpoint:
        device.machine?.endpoints?.lan &&
        typeof device.machine.endpoints.lan.address === "string" &&
        typeof device.machine.endpoints.lan.port === "number"
          ? {
              address: device.machine.endpoints.lan.address,
              port: device.machine.endpoints.lan.port,
            }
          : null,
      name: device.deviceName,
      status:
        device.relayState === "offline" ||
        device.machine?.heartbeat?.offline === true
          ? "offline"
          : "online",
      relayState: device.relayState,
      relayUsername: device.relayUsername,
      deviceType: device.deviceType,
    }));
  }

  async isRelayHostOnline(relayUsername: string): Promise<boolean> {
    const normalized = relayUsername.trim().toLowerCase();
    if (!normalized) return false;
    const payload = await this.request<{
      online?: boolean;
      heartbeat?: {
        lastSeenAt?: string;
        ageMs?: number;
        offlineTimeoutMs?: number;
        offline?: boolean;
      };
    }>(`/online/${encodeURIComponent(normalized)}`, { method: "GET" });
    if (payload.online !== true) return false;
    const heartbeat = payload.heartbeat;
    if (!heartbeat) return true;
    if (heartbeat.offline === true) return false;
    if (
      typeof heartbeat.ageMs === "number" &&
      typeof heartbeat.offlineTimeoutMs === "number"
    ) {
      return heartbeat.ageMs <= heartbeat.offlineTimeoutMs;
    }
    return true;
  }

  async getSessionPlaceholder(host: HostItem): Promise<SessionPlaceholder> {
    return {
      hostId: host.id,
      relayUsername: host.relayUsername,
      state: "pending",
      message: `已拿到 relay 用户名 ${host.relayUsername}，下一步接入加密会话通道。`,
    };
  }

  async requestClientConnectGrant(
    accessToken: string,
    relayUsername: string,
    deviceId?: string,
  ): Promise<RelayClientConnectGrant> {
    if (!accessToken.trim()) {
      throw new Error("缺少平台账号令牌");
    }
    if (!relayUsername.trim()) {
      throw new Error("缺少 relay 用户名");
    }

    return this.request<RelayClientConnectGrant>(
      "/api/v1/relay/grants/client-connect",
      {
        method: "POST",
        body: JSON.stringify({
          relayUsername: relayUsername.trim().toLowerCase(),
          deviceId,
        }),
      },
      accessToken,
    );
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export type DirectServerHealth = {
  status: string;
  timestamp: string;
};

export type DirectServerInfo = {
  host: string;
  port: number;
  boundToAllInterfaces: boolean;
  localhostOnly: boolean;
  installId?: string;
  hostAccess?: {
    configured: boolean;
    username?: string;
  };
  capabilities?: {
    deviceBridge: boolean;
  };
};

export function isDirectServerInfo(
  value: DirectServerInfo | null | undefined,
): value is DirectServerInfo {
  return Boolean(
    value &&
      typeof value.host === "string" &&
      value.host.trim().length > 0 &&
      Number.isInteger(value.port) &&
      value.port > 0 &&
      value.port <= 65535 &&
      typeof value.boundToAllInterfaces === "boolean" &&
      typeof value.localhostOnly === "boolean",
  );
}

export type DirectProject = {
  id: string;
  name: string;
  path?: string;
  provider?: string;
  activeOwnedCount?: number;
  activeExternalCount?: number;
};

export type DirectSessionSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
  provider?: string;
};

export type DirectSessionMessage = {
  id: string;
  role?: "user" | "assistant";
  type?: "user" | "assistant";
  content: string | Array<{ type?: string; text?: string }>;
  timestamp?: string;
};

export type DirectSessionDetail = {
  session: {
    id: string;
    title: string | null;
    updatedAt: string;
    provider?: string;
    messages?: DirectSessionMessage[];
  };
  messages?: DirectSessionMessage[];
};

export class DirectServerClient {
  private readonly baseUrl: string;

  constructor(serverUrl: string) {
    this.baseUrl = normalizeHttpBaseUrl(serverUrl);
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`请求失败 (${response.status})：${path}`);
    }
    return (await response.json()) as T;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AgentLine-Request": "true",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = `请求失败 (${response.status})：${path}`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
    return (await response.json()) as T;
  }

  async getHealth(): Promise<DirectServerHealth> {
    return this.getJson<DirectServerHealth>("/health");
  }

  async getServerInfo(): Promise<DirectServerInfo | null> {
    try {
      return await this.getJson<DirectServerInfo>("/api/server-info");
    } catch {
      return null;
    }
  }

  async listProjects(): Promise<DirectProject[]> {
    const payload = await this.getJson<{ projects?: DirectProject[] }>(
      "/api/projects",
    );
    return payload.projects ?? [];
  }

  async listProjectSessions(
    projectId: string,
  ): Promise<DirectSessionSummary[]> {
    const payload = await this.getJson<{ sessions?: DirectSessionSummary[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions`,
    );
    return payload.sessions ?? [];
  }

  async getSession(
    projectId: string,
    sessionId: string,
  ): Promise<DirectSessionDetail> {
    return this.getJson<DirectSessionDetail>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    await this.postJson(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        message,
      },
    );
  }

  async resumeSession(
    projectId: string,
    sessionId: string,
    message: string,
  ): Promise<void> {
    await this.postJson(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/resume`,
      { message },
    );
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const apiClient = new ApiClient(DEFAULT_CONTROL_PLANE_URL);
