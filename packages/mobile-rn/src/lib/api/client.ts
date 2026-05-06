export type LoginRequest = {
  email: string;
  password: string;
};

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
  deviceType: string;
};

export type SessionPlaceholder = {
  hostId: string;
  relayUsername: string;
  state: "pending";
  message: string;
};

type ControlPlaneDevice = {
  id: string;
  deviceName: string;
  deviceType: string;
  relayUsername: string;
  relayState: "offline" | "waiting" | "paired";
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) {
          message = data.error;
        }
      } catch {
        // ignore non-JSON error body
      }
      throw new Error(message);
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

  async listHosts(accessToken: string): Promise<HostItem[]> {
    const payload = await this.request<{ devices: ControlPlaneDevice[] }>(
      "/api/v1/devices",
      { method: "GET" },
      accessToken,
    );

    return payload.devices.map((device) => ({
      id: device.id,
      name: device.deviceName,
      status: device.relayState === "offline" ? "offline" : "online",
      relayState: device.relayState,
      relayUsername: device.relayUsername,
      deviceType: device.deviceType,
    }));
  }

  async getSessionPlaceholder(host: HostItem): Promise<SessionPlaceholder> {
    return {
      hostId: host.id,
      relayUsername: host.relayUsername,
      state: "pending",
      message: `已拿到 relay 用户名 ${host.relayUsername}，下一步接入加密会话通道。`,
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

const maybeEnv = (
  globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  }
).process?.env;

const defaultControlPlaneUrl =
  maybeEnv?.EXPO_PUBLIC_CONTROL_PLANE_URL ?? "http://10.0.2.2:4400";

export const apiClient = new ApiClient(defaultControlPlaneUrl);
