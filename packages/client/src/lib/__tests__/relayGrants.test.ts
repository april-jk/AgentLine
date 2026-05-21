import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJSON } from "../../api/client";
import { requestClientConnectGrant } from "../relayGrants";

vi.mock("../../api/client", () => ({
  fetchJSON: vi.fn(),
}));

const ACCOUNT_STORAGE_KEY = "agentline.remote.account";

describe("requestClientConnectGrant fallback behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to direct control-plane request when SecureConnection is unavailable", async () => {
    const fetchJSONMock = vi.mocked(fetchJSON);
    fetchJSONMock.mockRejectedValueOnce(
      new Error("Remote client requires SecureConnection - not authenticated"),
    );

    localStorage.setItem(
      ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        controlPlaneUrl: "https://relay.agentline.com",
        accessToken: "token-123",
        email: "user@example.com",
      }),
    );

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          grant: "grant-1",
          grantId: "grant-id-1",
          expiresAt: "2099-01-01T00:00:00.000Z",
          relayUsername: "desk-a",
          deviceId: "device-1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await requestClientConnectGrant({
      relayUsername: "desk-a",
      deviceId: "device-1",
    });

    expect(fetchJSONMock).toHaveBeenCalledWith(
      "/remote-access/control-plane/grants/client-connect",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.agentline.com/api/v1/relay/grants/client-connect",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(payload).toMatchObject({
      grant: "grant-1",
      relayUsername: "desk-a",
      deviceId: "device-1",
      controlPlaneUrl: "https://relay.agentline.com",
    });
  });
});
