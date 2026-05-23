import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteAccessRoutes } from "../../src/remote-access/routes.js";

function createRemoteAccessServiceStub() {
  return {
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
}

describe("Remote access routes - control-plane auth proxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns proxied login payload for register mode", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ user: { id: "u-1", email: "a@b.com" } }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accessToken: "token-123",
            expiresAt: "2099-01-01T00:00:00.000Z",
            user: { id: "u-1", email: "a@b.com" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const routes = createRemoteAccessRoutes({
      remoteAccessService: createRemoteAccessServiceStub() as never,
    });

    const response = await routes.request("/control-plane/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "register",
        baseUrl: "relay.oneceo.ai/",
        email: "a@b.com",
        password: "password-123",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://relay.oneceo.ai",
      accessToken: "token-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      user: { id: "u-1", email: "a@b.com" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps network errors to control-plane error codes", async () => {
    const networkError = Object.assign(new Error("connect failed"), {
      code: "ENOTFOUND",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(networkError),
    );

    const routes = createRemoteAccessRoutes({
      remoteAccessService: createRemoteAccessServiceStub() as never,
    });

    const response = await routes.request("/control-plane/auth", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "login",
        baseUrl: "https://relay.oneceo.ai",
        email: "a@b.com",
        password: "password-123",
      }),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "control_plane_dns_unresolved",
    });
  });

  it("returns desktop host account summary from saved control-plane auth", async () => {
    vi.stubEnv("CONTROL_PLANE_DESKTOP_MANAGED", "true");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: {
            id: "user-1",
            email: "desktop@example.com",
            createdAt: "2026-05-19T00:00:00.000Z",
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const routes = createRemoteAccessRoutes({
      remoteAccessService: createRemoteAccessServiceStub() as never,
      controlPlaneBridgeService: {
        getAuthContext: vi.fn().mockReturnValue({
          baseUrl: "https://relay.oneceo.ai",
          accessToken: "token-123",
        }),
      } as never,
      serverSettingsService: {
        getSetting: vi.fn((key: string) =>
          key === "controlPlaneLastEmail" ? "old@example.com" : undefined,
        ),
      } as never,
    });

    const response = await routes.request("/control-plane/account");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://relay.oneceo.ai",
      lastEmail: "desktop@example.com",
      hasAccessToken: true,
      authenticated: true,
      desktopManaged: true,
      user: {
        id: "user-1",
        email: "desktop@example.com",
        createdAt: "2026-05-19T00:00:00.000Z",
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.oneceo.ai/api/v1/me",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer token-123",
        },
      }),
    );
  });

  it("keeps saved login visible when account verification is unreachable", async () => {
    const networkError = Object.assign(new Error("connect failed"), {
      code: "ENOTFOUND",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(networkError),
    );

    const routes = createRemoteAccessRoutes({
      remoteAccessService: createRemoteAccessServiceStub() as never,
      serverSettingsService: {
        getSetting: vi.fn((key: string) => {
          if (key === "controlPlaneBaseUrl") return "https://relay.oneceo.ai";
          if (key === "controlPlaneAccessToken") return "token-123";
          if (key === "controlPlaneLastEmail") return "desktop@example.com";
          return undefined;
        }),
      } as never,
    });

    const response = await routes.request("/control-plane/account");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      baseUrl: "https://relay.oneceo.ai",
      lastEmail: "desktop@example.com",
      hasAccessToken: true,
      authenticated: false,
      verificationError: "control_plane_dns_unresolved",
    });
  });
});
