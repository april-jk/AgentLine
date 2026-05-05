export type LoginRequest = {
  username: string;
  password: string;
};

export type LoginResponse = {
  accessToken: string;
  expiresAt: string;
};

export type HostItem = {
  id: string;
  name: string;
  status: "online" | "offline";
};

export type SessionPlaceholder = {
  hostId: string;
  state: "pending";
  message: string;
};

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async login(payload: LoginRequest): Promise<LoginResponse> {
    if (!payload.username || !payload.password) {
      throw new Error("Username and password are required.");
    }

    return {
      accessToken: `dev-token-${payload.username}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  async listHosts(): Promise<HostItem[]> {
    return [
      { id: "host-001", name: "MacBook-Pro", status: "online" },
      { id: "host-002", name: "Ubuntu-VM", status: "offline" },
    ];
  }

  async getSessionPlaceholder(hostId: string): Promise<SessionPlaceholder> {
    return {
      hostId,
      state: "pending",
      message: `Session stream for ${hostId} is not wired yet.`,
    };
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}

export const apiClient = new ApiClient("https://api.example.com");
