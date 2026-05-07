import {
  DirectServerClient,
  normalizeHttpBaseUrl,
} from "../api/client";

export type LanScanResult = {
  baseUrl: string;
  host: string;
  port: number;
  installId?: string;
  deviceBridge?: boolean;
};

export type SmartScanProgress = {
  scanned: number;
  total: number;
  phase: "quick" | "expanded";
};

const DESKTOP_DEDICATED_PORT = 45731;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function probeServer(baseUrl: string): Promise<LanScanResult | null> {
  try {
    const client = new DirectServerClient(baseUrl);
    const health = await withTimeout(client.getHealth(), 900);
    if (health.status !== "ok") return null;
    const info = await withTimeout(client.getServerInfo(), 1200);
    return {
      baseUrl: client.getBaseUrl(),
      host: info?.host ?? "unknown",
      port: info?.port ?? 3400,
      installId: info?.installId,
      deviceBridge: info?.capabilities?.deviceBridge,
    };
  } catch {
    return null;
  }
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((url) => normalizeHttpBaseUrl(url))));
}

function buildSubnetCandidates(subnetPrefix: string, port: number): string[] {
  const normalizedPrefix = subnetPrefix.trim().replace(/\.$/, "");
  const candidates: string[] = [];
  for (let i = 1; i <= 254; i += 1) {
    candidates.push(
      normalizeHttpBaseUrl(`http://${normalizedPrefix}.${String(i)}:${String(port)}`),
    );
  }
  return candidates;
}

async function scanCandidates(
  candidates: string[],
  options?: {
    concurrency?: number;
    onProgress?: (progress: { scanned: number; total: number }) => void;
  },
): Promise<LanScanResult[]> {
  const concurrency = options?.concurrency ?? 24;
  const total = candidates.length;

  const results: LanScanResult[] = [];
  let cursor = 0;
  let scanned = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const target = candidates[index];
      if (!target) continue;
      const item = await probeServer(target);
      if (item) results.push(item);
      scanned += 1;
      options?.onProgress?.({ scanned, total });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function scanLanServers(
  subnetPrefix: string,
  port = 3400,
): Promise<LanScanResult[]> {
  const results = await scanCandidates(buildSubnetCandidates(subnetPrefix, port));
  return results.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}

export async function smartScanLanServers(options?: {
  port?: number;
  recentServers?: string[];
  onProgress?: (progress: SmartScanProgress) => void;
}): Promise<LanScanResult[]> {
  const preferredPort = options?.port ?? 3400;
  const quickPorts = Array.from(new Set([preferredPort, DESKTOP_DEDICATED_PORT]));
  const recent = options?.recentServers ?? [];

  const quickCandidates = dedupeUrls(
    quickPorts.flatMap((port) => [
      ...recent,
      `http://127.0.0.1:${String(port)}`,
      `http://localhost:${String(port)}`,
      `http://192.168.1.2:${String(port)}`,
      `http://192.168.1.3:${String(port)}`,
      `http://192.168.1.4:${String(port)}`,
      `http://192.168.1.5:${String(port)}`,
      `http://192.168.1.10:${String(port)}`,
      `http://192.168.1.100:${String(port)}`,
      `http://192.168.1.101:${String(port)}`,
      `http://192.168.1.102:${String(port)}`,
      `http://192.168.0.2:${String(port)}`,
      `http://192.168.0.3:${String(port)}`,
      `http://192.168.0.10:${String(port)}`,
      `http://10.0.0.2:${String(port)}`,
      `http://10.0.0.10:${String(port)}`,
      `http://10.0.1.2:${String(port)}`,
      `http://10.0.1.10:${String(port)}`,
      `http://10.0.2.2:${String(port)}`,
      `http://172.16.0.2:${String(port)}`,
      `http://172.16.1.2:${String(port)}`,
    ]),
  );

  const quickResults = await scanCandidates(quickCandidates, {
    concurrency: 12,
    onProgress: ({ scanned, total }) =>
      options?.onProgress?.({ scanned, total, phase: "quick" }),
  });
  if (quickResults.length > 0) {
    return quickResults.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
  }

  const expandedCandidates = dedupeUrls([
    ...buildSubnetCandidates("192.168.1", preferredPort),
    ...buildSubnetCandidates("192.168.0", preferredPort),
    ...buildSubnetCandidates("10.0.0", preferredPort),
    ...buildSubnetCandidates("10.0.1", preferredPort),
    ...buildSubnetCandidates("172.16.0", preferredPort),
    ...buildSubnetCandidates("172.16.1", preferredPort),
  ]);

  const expandedResults = await scanCandidates(expandedCandidates, {
    concurrency: 28,
    onProgress: ({ scanned, total }) =>
      options?.onProgress?.({ scanned, total, phase: "expanded" }),
  });
  return expandedResults.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}
