import { fetchJSON } from "../api/client";
import {
  deriveRelayWsUrl as deriveRelayWsUrlFromControlPlane,
  mapControlPlaneNetworkError,
  normalizeControlPlaneBaseUrl as normalizeControlPlaneBaseUrlShared,
} from "./controlPlane";

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
  if (!raw.trim()) {
    return "";
  }
  return normalizeControlPlaneBaseUrlShared(raw);
}

export function deriveRelayWsUrl(controlPlaneUrl: string): string {
  const normalized = normalizeControlPlaneBaseUrl(controlPlaneUrl);
  return normalized
    ? deriveRelayWsUrlFromControlPlane(normalized)
    : "wss://relay.oneceo.ai/ws";
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

function shouldFallbackToDirectGrantRequest(error: unknown): boolean {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;

  if (status === 404 || status === 405 || status === 503) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("api error: 404") ||
    message.includes("route not found") ||
    message.includes("remote client requires secureconnection") ||
    message.includes("control_plane_bridge_unavailable") ||
    message.includes("control_plane_not_configured")
  );
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

  try {
    const payload = await fetchJSON<ClientConnectGrantPayload>(
      "/remote-access/control-plane/grants/client-connect",
      {
        method: "POST",
        body: JSON.stringify({
          relayUsername: params.relayUsername,
          deviceId: params.deviceId,
        }),
      },
    );
    if (!payload.grant || !payload.relayUsername) {
      throw new Error("grant_response_invalid");
    }
    return {
      ...payload,
      controlPlaneUrl,
    };
  } catch (error) {
    if (!shouldFallbackToDirectGrantRequest(error)) {
      throw mapControlPlaneNetworkError(error);
    }
  }

  let response: Response;
  try {
    response = await fetch(
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
  } catch (error) {
    throw mapControlPlaneNetworkError(error);
  }

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
