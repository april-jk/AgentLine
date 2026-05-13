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
}

export const DEFAULT_CONTROL_PLANE_URL = "https://relay.oneceo.ai";
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

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers,
  });
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

export async function authenticateAccount(
  baseUrl: string,
  mode: AccountMode,
  email: string,
  password: string,
): Promise<AccountAuthResponse> {
  if (mode === "register") {
    await requestJson<{ user: AccountUser }>(baseUrl, "/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  return requestJson<AccountAuthResponse>(baseUrl, "/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
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
