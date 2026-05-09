import type { RemoteAccessService } from "../remote-access/RemoteAccessService.js";

interface ControlPlaneBridgeDevice {
  id: string;
  relayUsername: string;
  deviceName: string;
}

interface ControlPlaneLanEndpoint {
  host: string;
  port: number;
  boundToAllInterfaces: boolean;
  localhostOnly: boolean;
}

interface RegisterDeviceResponse {
  device: ControlPlaneBridgeDevice;
}

interface HeartbeatResponse {
  device: ControlPlaneBridgeDevice;
}

interface ErrorResponse {
  error?: string;
}

class ControlPlaneRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ControlPlaneBridgeConfig {
  baseUrl?: string;
  accessToken?: string;
  relayUrl?: string;
  installId: string;
  deviceName: string;
  deviceType: string;
  heartbeatIntervalMs: number;
  hostEndpointProvider?: () => ControlPlaneLanEndpoint | null;
}

export interface ControlPlaneBridgeState {
  enabled: boolean;
  running: boolean;
  pausedReason?: string;
  deviceId?: string;
  relayUsername?: string;
  lastSyncAt?: string;
  lastHeartbeatAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

export interface ControlPlaneBridgeServiceOptions {
  config: ControlPlaneBridgeConfig;
  remoteAccessService: RemoteAccessService;
  onRelayConfigChanged: () => Promise<void>;
  fetchImpl?: typeof fetch;
}

export class ControlPlaneBridgeService {
  private readonly config: ControlPlaneBridgeConfig;
  private readonly remoteAccessService: RemoteAccessService;
  private readonly onRelayConfigChanged: () => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly state: ControlPlaneBridgeState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;

  constructor(options: ControlPlaneBridgeServiceOptions) {
    this.config = options.config;
    this.remoteAccessService = options.remoteAccessService;
    this.onRelayConfigChanged = options.onRelayConfigChanged;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.state = {
      enabled: this.isConfigured(),
      running: false,
      consecutiveFailures: 0,
      pausedReason: this.isConfigured()
        ? undefined
        : "control_plane_not_configured",
    };
  }

  getState(): ControlPlaneBridgeState {
    return { ...this.state };
  }

  async start(): Promise<void> {
    if (!this.isConfigured()) {
      this.state.enabled = false;
      this.state.running = false;
      this.state.pausedReason = "control_plane_not_configured";
      return;
    }
    if (this.timer) {
      return;
    }

    this.state.enabled = true;
    this.state.running = true;
    this.state.pausedReason = undefined;
    await this.syncNow();
    if (!this.state.running) {
      return;
    }

    this.timer = setInterval(() => {
      void this.syncNow();
    }, this.config.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state.running = false;
  }

  async syncNow(): Promise<ControlPlaneBridgeState> {
    if (!this.isConfigured()) {
      return this.getState();
    }
    if (this.syncing) {
      return this.getState();
    }

    this.syncing = true;
    try {
      const registration = await this.registerDevice();
      const device = registration.device;
      this.state.deviceId = device.id;
      this.state.relayUsername = device.relayUsername;
      await this.ensureRelayConfig(device.relayUsername);
      await this.sendHeartbeat(device.id);

      this.state.lastSyncAt = new Date().toISOString();
      this.state.lastError = undefined;
      this.state.pausedReason = undefined;
      this.state.consecutiveFailures = 0;
    } catch (error) {
      this.state.consecutiveFailures += 1;
      this.state.lastError =
        error instanceof Error ? error.message : "control_plane_sync_failed";

      if (error instanceof ControlPlaneRequestError && error.status === 401) {
        this.stop();
        this.state.pausedReason = "unauthorized";
      }
    } finally {
      this.syncing = false;
    }

    return this.getState();
  }

  private isConfigured(): boolean {
    return Boolean(
      this.config.baseUrl && this.config.accessToken && this.config.relayUrl,
    );
  }

  private getAuthorizationHeader(): string {
    return `Bearer ${this.config.accessToken ?? ""}`;
  }

  private async registerDevice(): Promise<RegisterDeviceResponse> {
    return this.request<RegisterDeviceResponse>("/api/v1/devices/register", {
      method: "POST",
      body: JSON.stringify({
        installId: this.config.installId,
        deviceName: this.config.deviceName,
        deviceType: this.config.deviceType,
      }),
    });
  }

  private async sendHeartbeat(deviceId: string): Promise<HeartbeatResponse> {
    const nowIso = new Date().toISOString();
    const lanEndpoint = this.config.hostEndpointProvider?.() ?? null;
    const expiresAt = new Date(
      Date.now() + this.config.heartbeatIntervalMs * 2,
    ).toISOString();

    const response = await this.request<HeartbeatResponse>(
      `/api/v1/devices/${encodeURIComponent(deviceId)}/heartbeat`,
      {
        method: "POST",
        body: JSON.stringify({
          owner: {
            role: "owner",
            status: "active",
          },
          machine: {
            id: deviceId,
            routeId: this.state.relayUsername,
            hostService: {
              listening: true,
              boundToAllInterfaces: lanEndpoint?.boundToAllInterfaces ?? false,
              localhostOnly: lanEndpoint?.localhostOnly ?? true,
            },
            endpoints: {
              lan: lanEndpoint
                ? {
                    kind: "lan",
                    address: lanEndpoint.host,
                    port: lanEndpoint.port,
                    boundToAllInterfaces: lanEndpoint.boundToAllInterfaces,
                    localhostOnly: lanEndpoint.localhostOnly,
                    lastSeenAt: nowIso,
                    expiresAt,
                  }
                : null,
              relay: {
                kind: "relay",
                routeId: this.state.relayUsername,
                relayUrl: this.config.relayUrl,
                lastSeenAt: nowIso,
                expiresAt,
              },
            },
          },
        }),
      },
    );
    this.state.lastHeartbeatAt = new Date().toISOString();
    return response;
  }

  private async ensureRelayConfig(relayUsername: string): Promise<void> {
    const currentConfig = this.remoteAccessService.getRelayConfig();
    if (
      currentConfig?.url === this.config.relayUrl &&
      currentConfig?.username === relayUsername
    ) {
      return;
    }

    await this.remoteAccessService.setRelayConfig({
      url: this.config.relayUrl ?? "",
      username: relayUsername,
    });
    await this.onRelayConfigChanged();
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const baseUrl = (this.config.baseUrl ?? "").replace(/\/+$/, "");
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.getAuthorizationHeader(),
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      let errorMessage = `control_plane_${response.status}`;
      try {
        const body = (await response.json()) as ErrorResponse;
        if (body.error) {
          errorMessage = body.error;
        }
      } catch {
        // ignore non-json response
      }

      throw new ControlPlaneRequestError(response.status, errorMessage);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
