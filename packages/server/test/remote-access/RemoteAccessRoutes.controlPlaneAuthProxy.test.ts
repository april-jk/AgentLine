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
});
