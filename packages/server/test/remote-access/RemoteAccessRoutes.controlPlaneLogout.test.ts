import { describe, expect, it, vi } from "vitest";
import { createRemoteAccessRoutes } from "../../src/remote-access/routes.js";

describe("Remote access routes - control-plane logout hard invalidation", () => {
  it("DELETE /control-plane/config clears relay config and revokes remote sessions", async () => {
    const invalidateUserSessions = vi.fn().mockResolvedValue(2);
    const clearRelayConfig = vi.fn().mockResolvedValue(undefined);
    const onRelayConfigChanged = vi.fn().mockResolvedValue(undefined);
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    const reconfigure = vi.fn().mockResolvedValue({
      enabled: false,
      running: false,
      pausedReason: "control_plane_not_configured",
      consecutiveFailures: 0,
    });

    const remoteAccessService = {
      getUsername: vi.fn().mockReturnValue("desktop-a1b2c3"),
      clearRelayConfig,
      getConfig: vi.fn().mockReturnValue({
        enabled: true,
        username: "desktop-a1b2c3",
        hostAccessConfigured: true,
      }),
      getRelayConfig: vi.fn().mockReturnValue({
        url: "wss://relay.oneceo.ai/ws",
        username: "desktop-a1b2c3",
      }),
      configure: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      clearCredentials: vi.fn(),
      setRelayConfig: vi.fn(),
    };

    const routes = createRemoteAccessRoutes({
      remoteAccessService: remoteAccessService as never,
      remoteSessionService: {
        invalidateUserSessions,
      } as never,
      controlPlaneBridgeService: {
        reconfigure,
      } as never,
      serverSettingsService: {
        updateSettings,
      } as never,
      onRelayConfigChanged,
    });

    const response = await routes.request("/control-plane/config", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(reconfigure).toHaveBeenCalledWith({
      baseUrl: undefined,
      accessToken: undefined,
      relayUrl: undefined,
    });
    expect(invalidateUserSessions).toHaveBeenCalledWith("desktop-a1b2c3");
    expect(clearRelayConfig).toHaveBeenCalledTimes(1);
    expect(onRelayConfigChanged).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith({
      controlPlaneBaseUrl: undefined,
      controlPlaneAccessToken: undefined,
      controlPlaneRelayWsUrl: undefined,
      controlPlaneLastEmail: undefined,
    });
  });
});
