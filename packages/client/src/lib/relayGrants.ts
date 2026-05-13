const ACCOUNT_STORAGE_KEY = "agentline.remote.account";

export interface StoredAccountAuth {
  controlPlaneUrl: string;
  accessToken: string;
  email: string;
}

export interface ClientConnectGrantPayload {
  grant: string;
  grantId: string;
  expiresAt: string;
  relayUsername: string;
  deviceId: string;
}

export function normalizeControlPlaneBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function deriveRelayWsUrl(controlPlaneUrl: string): string {
  const normalized = normalizeControlPlaneBaseUrl(controlPlaneUrl);
  if (!normalized) return "wss://relay.oneceo.ai/ws";
  try {
    const url = new URL(normalized);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "wss://relay.oneceo.ai/ws";
  }
}

export function loadStoredAccountAuth(): StoredAccountAuth | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAccountAuth>;
    if (!parsed.controlPlaneUrl || !parsed.accessToken || !parsed.email) {
      return null;
    }
    return {
      controlPlaneUrl: parsed.controlPlaneUrl,
      accessToken: parsed.accessToken,
      email: parsed.email,
    };
  } catch {
    return null;
  }
}

interface GrantRequestParams {
  relayUsername: string;
  deviceId?: string;
  controlPlaneUrl?: string;
}

export async function requestClientConnectGrant(
  params: GrantRequestParams,
): Promise<
  ClientConnectGrantPayload & {
    controlPlaneUrl: string;
  }
> {
  const stored = loadStoredAccountAuth();
  const controlPlaneUrl = normalizeControlPlaneBaseUrl(
    params.controlPlaneUrl || stored?.controlPlaneUrl || "",
  );
  if (!controlPlaneUrl || !stored?.accessToken) {
    throw new Error("account_auth_required");
  }

  const response = await fetch(
    `${controlPlaneUrl}/api/v1/relay/grants/client-connect`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stored.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: params.deviceId,
        relayUsername: params.relayUsername,
      }),
    },
  );

  if (!response.ok) {
    let errorMessage = `grant_request_failed_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) errorMessage = payload.error;
    } catch {
      // ignore non-json response
    }
    throw new Error(errorMessage);
  }

  const payload = (await response.json()) as ClientConnectGrantPayload;
  if (!payload.grant || !payload.relayUsername) {
    throw new Error("grant_response_invalid");
  }

  return {
    ...payload,
    controlPlaneUrl,
  };
}
