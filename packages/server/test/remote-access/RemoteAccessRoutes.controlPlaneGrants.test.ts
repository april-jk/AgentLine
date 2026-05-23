import { describe, expect, it, vi } from "vitest";
import { createRemoteAccessRoutes } from "../../src/remote-access/routes.js";

describe("Remote access routes - control-plane client grant status mapping", () => {
  it("returns 409 when control-plane reports device_offline", async () => {
    const remoteAccessService = {
      getConfig: vi.fn().mockReturnValue({
        enabled: true,
        username: "desktop-a1b2c3",
        hostAccessConfigured: true,
      }),
      getRelayConfig: vi.fn().mockReturnValue({
        url: "wss://relay.oneceo.ai/ws",
        username: "desktop-a1b2c3",
      }),
      getUsername: vi.fn().mockReturnValue("desktop-a1b2c3"),
      configure: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      clearCredentials: vi.fn(),
      setRelayConfig: vi.fn(),
      clearRelayConfig: vi.fn(),
    };

    const routes = createRemoteAccessRoutes({
      remoteAccessService: remoteAccessService as never,
      controlPlaneBridgeService: {
        getClientConnectGrant: vi
          .fn()
          .mockRejectedValue(new Error("device_offline")),
      } as never,
    });

    const response = await routes.request("/control-plane/grants/client-connect", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        relayUsername: "desktop-a1b2c3",
        deviceId: "device-1",
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "device_offline" });
  });
});
