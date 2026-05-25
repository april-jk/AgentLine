import type { UpdateManifest } from "./update.js";

export const AGENTLINE_UPDATE_URL = "https://relay.oneceo.ai/version";

export type UpdateCheckResult =
  | { status: "available"; update: UpdateManifest }
  | { status: "current" };

export async function fetchAgentLineUpdate(
  currentVersion: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const response = await fetchImpl(
    `${AGENTLINE_UPDATE_URL}/${currentVersion}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    },
  );

  if (response.status === 204) {
    return { status: "current" };
  }

  if (!response.ok) {
    throw new Error(`Update check failed: ${response.status}`);
  }

  const update = (await response.json()) as UpdateManifest;
  if (!update.version || !update.releaseUrl) {
    throw new Error("Update manifest is missing required fields");
  }

  return { status: "available", update };
}
