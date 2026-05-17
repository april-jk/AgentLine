import { fetchJSON } from "../api/client";
import {
  DEFAULT_CONTROL_PLANE_URL,
  mapControlPlaneNetworkError,
  normalizeControlPlaneBaseUrl,
} from "../lib/controlPlane";
export { DEFAULT_CONTROL_PLANE_URL };

export type AccountMode = "login" | "register";

export interface AccountUser {
  id: string;
  email: string;
}

export interface AccountAuthResponse {
  accessToken: string;
  expiresAt: string;
  user: AccountUser;
}

export interface AccountDevice {
  id: string;
  relayUsername: string;
  deviceName: string;
  deviceType: string;
  relayState: "offline" | "waiting" | "paired";
  machine?: {
    heartbeat?: {
      lastSeenAt?: string;
      ageMs?: number;
      offlineTimeoutMs?: number;
      offline?: boolean;
    };
  };
}

export const ACCOUNT_STORAGE_KEY = "agentline.remote.account";

export interface SavedAccountAuth {
  controlPlaneUrl: string;
  accessToken: string;
  email: string;
}

export function loadSavedAccount(): SavedAccountAuth | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      controlPlaneUrl?: string;
      accessToken?: string;
      email?: string;
    };
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

export function saveAccount(params: SavedAccountAuth): void {
  localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(params));
}

export function clearAccount(): void {
  localStorage.removeItem(ACCOUNT_STORAGE_KEY);
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw mapControlPlaneNetworkError(error);
  }
  if (!response.ok) {
    let message = `request_failed_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // ignore non-json response
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

function shouldFallbackToDirectAuth(error: unknown): boolean {
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
    message.includes("remote client requires secureconnection")
  );
}

export async function authenticateAccount(
  baseUrl: string,
  mode: AccountMode,
  email: string,
  password: string,
): Promise<AccountAuthResponse> {
  const normalizedBaseUrl = normalizeControlPlaneBaseUrl(baseUrl);
  const credentials = {
    email,
    password,
  };

  try {
    const payload = await fetchJSON<{
      baseUrl?: string;
      accessToken: string;
      expiresAt: string;
      user?: AccountUser;
    }>("/remote-access/control-plane/auth", {
      method: "POST",
      body: JSON.stringify({
        mode,
        baseUrl: normalizedBaseUrl,
        email,
        password,
      }),
    });

    return {
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt,
      user: payload.user ?? { id: "", email },
    };
  } catch (error) {
    if (!shouldFallbackToDirectAuth(error)) {
      throw mapControlPlaneNetworkError(error);
    }
  }

  if (mode === "register") {
    await requestJson<{ user: AccountUser }>(
      normalizedBaseUrl,
      "/api/v1/auth/register",
      {
        method: "POST",
        body: JSON.stringify(credentials),
      },
    );
  }

  return requestJson<AccountAuthResponse>(
    normalizedBaseUrl,
    "/api/v1/auth/login",
    {
      method: "POST",
      body: JSON.stringify(credentials),
    },
  );
}

export async function fetchDevices(
  baseUrl: string,
  accessToken: string,
): Promise<AccountDevice[]> {
  const payload = await requestJson<{ devices: AccountDevice[] }>(
    baseUrl,
    "/api/v1/devices",
    { method: "GET" },
    accessToken,
  );
  return payload.devices ?? [];
}
