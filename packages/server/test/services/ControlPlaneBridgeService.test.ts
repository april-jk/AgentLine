import { afterEach, describe, expect, it, vi } from "vitest";
import type { RelayConfig } from "../../src/remote-access/RemoteAccessService.js";
import { ControlPlaneBridgeService } from "../../src/services/ControlPlaneBridgeService.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ControlPlaneBridgeService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers device, configures relay, and sends heartbeat", async () => {
    const setRelayConfig = vi.fn(async () => {});
    const onRelayConfigChanged = vi.fn(async () => {});
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/api/v1/devices/register")) {
          return jsonResponse(200, {
            device: {
              id: "device-1",
              relayUsername: "desk-abc",
              deviceName: "Desk",
            },
          });
        }

        if (url.endsWith("/api/v1/devices/device-1/heartbeat")) {
          return jsonResponse(200, {
            device: {
              id: "device-1",
              relayUsername: "desk-abc",
              deviceName: "Desk",
            },
          });
        }

        return jsonResponse(404, { error: "not_found" });
      },
    );

    let relayConfig: RelayConfig | null = null;
    const service = new ControlPlaneBridgeService({
      config: {
        baseUrl: "http://relay.local:4400",
        accessToken: "token",
        relayUrl: "ws://relay.local:4400/ws",
        installId: "install-123",
        deviceName: "Desktop Mac",
        deviceType: "desktop-electron",
        heartbeatIntervalMs: 60_000,
      },
      remoteAccessService: {
        getRelayConfig: () => relayConfig,
        setRelayConfig: async (next: RelayConfig) => {
          relayConfig = next;
          setRelayConfig(next);
        },
      } as never,
      onRelayConfigChanged,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await service.start();
    service.stop();

    const state = service.getState();
    expect(state.running).toBe(false);
    expect(state.deviceId).toBe("device-1");
    expect(state.relayUsername).toBe("desk-abc");
    expect(state.lastHeartbeatAt).toBeTruthy();
    expect(setRelayConfig).toHaveBeenCalledWith({
      url: "ws://relay.local:4400/ws",
      username: "desk-abc",
    });
    const heartbeatCall = fetchImpl.mock.calls.find(([input]) =>
      String(input).endsWith("/api/v1/devices/device-1/heartbeat"),
    );
    expect(heartbeatCall).toBeTruthy();
    const heartbeatBody = JSON.parse(
      String(heartbeatCall?.[1]?.body ?? "{}"),
    ) as {
      owner?: { role?: string; status?: string };
      machine?: { endpoints?: { relay?: { routeId?: string } } };
    };
    expect(heartbeatBody.owner?.role).toBe("owner");
    expect(heartbeatBody.machine?.endpoints?.relay?.routeId).toBe("desk-abc");
    expect(onRelayConfigChanged).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("pauses bridge on unauthorized token", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return jsonResponse(401, { error: "unauthorized" });
    });

    const service = new ControlPlaneBridgeService({
      config: {
        baseUrl: "http://relay.local:4400",
        accessToken: "bad-token",
        relayUrl: "ws://relay.local:4400/ws",
        installId: "install-123",
        deviceName: "Desktop Mac",
        deviceType: "desktop-electron",
        heartbeatIntervalMs: 60_000,
      },
      remoteAccessService: {
        getRelayConfig: () => null,
        setRelayConfig: async () => {},
      } as never,
      onRelayConfigChanged: async () => {},
      fetchImpl: fetchImpl as typeof fetch,
    });

    await service.start();

    const state = service.getState();
    expect(state.running).toBe(false);
    expect(state.pausedReason).toBe("unauthorized");
    expect(state.lastError).toBe("unauthorized");
    expect(state.consecutiveFailures).toBe(1);
  });

  it("supports runtime reconfigure for web-host login flows", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/api/v1/devices/register")) {
          return jsonResponse(200, {
            device: {
              id: "device-runtime",
              relayUsername: "desk-runtime",
              deviceName: "Desk",
            },
          });
        }
        if (url.endsWith("/api/v1/devices/device-runtime/heartbeat")) {
          return jsonResponse(200, {
            device: {
              id: "device-runtime",
              relayUsername: "desk-runtime",
              deviceName: "Desk",
            },
          });
        }
        return jsonResponse(404, { error: "not_found" });
      },
    );

    let relayConfig: RelayConfig | null = null;
    const service = new ControlPlaneBridgeService({
      config: {
        installId: "install-web-1",
        deviceName: "Desktop Web",
        deviceType: "desktop-web",
        heartbeatIntervalMs: 60_000,
      },
      remoteAccessService: {
        getRelayConfig: () => relayConfig,
        setRelayConfig: async (next: RelayConfig) => {
          relayConfig = next;
        },
      } as never,
      onRelayConfigChanged: async () => {},
      fetchImpl: fetchImpl as typeof fetch,
    });

    const activeState = await service.reconfigure({
      baseUrl: "http://relay.local:4400",
      accessToken: "token-runtime",
      relayUrl: "ws://relay.local:4400/ws",
    });
    expect(activeState.enabled).toBe(true);
    expect(activeState.running).toBe(true);
    expect(activeState.deviceId).toBe("device-runtime");
    expect(activeState.relayUsername).toBe("desk-runtime");

    const inactiveState = await service.reconfigure({
      baseUrl: undefined,
      accessToken: undefined,
      relayUrl: undefined,
    });
    expect(inactiveState.enabled).toBe(false);
    expect(inactiveState.running).toBe(false);
    expect(inactiveState.pausedReason).toBe("control_plane_not_configured");
    expect(inactiveState.deviceId).toBeUndefined();
    expect(inactiveState.relayUsername).toBeUndefined();
  });
});
