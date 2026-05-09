import {
  DEFAULT_DESKTOP_DISCOVERY_PORT,
  buildDesktopDiscoveryPorts,
} from "../../../../shared/dist/desktop-discovery.js";
import { DirectServerClient, normalizeHttpBaseUrl } from "../api/client";

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
  phase: "current-subnet";
  subnetPrefix: string;
};

function parseBaseUrl(baseUrl: string): { host: string; port: number } | null {
  const match = baseUrl.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
  if (!match?.[1]) return null;
  const port = Number(match[2] ?? DEFAULT_DESKTOP_DISCOVERY_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: match[1], port };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

function normalizeHostForDisplay(host: string, fallbackHost: string): string {
  const normalized = host.trim();
  if (
    !normalized ||
    normalized === "unknown" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "localhost"
  ) {
    return fallbackHost;
  }
  return normalized;
}

function extractSubnetPrefix(host: string): string | null {
  const match = host.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  return match?.[1] ?? null;
}

function isRoutableLanPrefix(prefix: string): boolean {
  const match = prefix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }
  const a = Number(match[1] ?? -1);
  const b = Number(match[2] ?? -1);
  const c = Number(match[3] ?? -1);
  if (![a, b, c].every((part) => Number.isInteger(part))) return false;
  if ([a, b, c].some((part) => part < 0 || part > 255)) return false;
  if (a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function resolvePreferredSubnetPrefix(options?: {
  preferredSubnetPrefix?: string;
  recentServers?: string[];
}): string {
  const explicit = options?.preferredSubnetPrefix?.trim();
  if (
    explicit &&
    /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(explicit) &&
    isRoutableLanPrefix(explicit)
  ) {
    return explicit;
  }

  const recent = options?.recentServers ?? [];
  for (const url of recent) {
    const host = parseBaseUrl(normalizeHttpBaseUrl(url))?.host ?? "";
    const prefix = extractSubnetPrefix(host);
    if (prefix && isRoutableLanPrefix(prefix)) return prefix;
  }

  return "192.168.1";
}

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
    const parsed = parseBaseUrl(client.getBaseUrl());
    const health = await withTimeout(client.getHealth(), 900);
    if (health.status !== "ok") return null;
    const info = await withTimeout(client.getServerInfo(), 1200);
    const fallbackHost = parsed?.host ?? "unknown";
    const fallbackPort = parsed?.port ?? DEFAULT_DESKTOP_DISCOVERY_PORT;
    return {
      baseUrl: client.getBaseUrl(),
      host: normalizeHostForDisplay(info?.host ?? "", fallbackHost),
      port: info?.port ?? fallbackPort,
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
  if (!isRoutableLanPrefix(normalizedPrefix)) {
    throw new Error(
      `Invalid subnet prefix for LAN scan: "${normalizedPrefix}"`,
    );
  }
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
  const normalizedPrefix = subnetPrefix.trim().replace(/\.$/, "");
  if (!isRoutableLanPrefix(normalizedPrefix)) {
    throw new Error(`Invalid subnet prefix: "${normalizedPrefix}"`);
  }
  const results = await scanCandidates(
    buildSubnetCandidates(normalizedPrefix, port),
  );
  return results.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}

export async function smartScanLanServers(options?: {
  port?: number;
  recentServers?: string[];
  preferredSubnetPrefix?: string;
  onProgress?: (progress: SmartScanProgress) => void;
}): Promise<LanScanResult[]> {
  const preferredPort = options?.port ?? DEFAULT_DESKTOP_DISCOVERY_PORT;
  const quickPorts = buildDesktopDiscoveryPorts(preferredPort);
  const recent = options?.recentServers ?? [];
  const preferredSubnetPrefix = resolvePreferredSubnetPrefix({
    preferredSubnetPrefix: options?.preferredSubnetPrefix,
    recentServers: recent,
  });

  const recentHostCandidates = dedupeUrls(
    recent.flatMap((url) => {
      const parsed = parseBaseUrl(normalizeHttpBaseUrl(url));
      if (!parsed || isLoopbackHost(parsed.host)) return [];
      return quickPorts.map((port) =>
        normalizeHttpBaseUrl(`http://${parsed.host}:${String(port)}`),
      );
    }),
  );

  const quickCandidates = dedupeUrls(
    quickPorts.flatMap((port) => [
      ...recentHostCandidates,
      `http://${preferredSubnetPrefix}.2:${String(port)}`,
      `http://${preferredSubnetPrefix}.3:${String(port)}`,
      `http://${preferredSubnetPrefix}.4:${String(port)}`,
      `http://${preferredSubnetPrefix}.5:${String(port)}`,
      `http://${preferredSubnetPrefix}.10:${String(port)}`,
      `http://${preferredSubnetPrefix}.100:${String(port)}`,
      `http://${preferredSubnetPrefix}.101:${String(port)}`,
      `http://${preferredSubnetPrefix}.102:${String(port)}`,
    ]),
  );

  const quickResults = await scanCandidates(quickCandidates, {
    concurrency: 12,
    onProgress: ({ scanned, total }) =>
      options?.onProgress?.({
        scanned,
        total,
        phase: "current-subnet",
        subnetPrefix: preferredSubnetPrefix,
      }),
  });
  if (quickResults.length > 0) {
    return quickResults.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
  }

  for (const port of quickPorts) {
    const subnetCandidates = dedupeUrls(
      buildSubnetCandidates(preferredSubnetPrefix, port),
    );
    const subnetResults = await scanCandidates(subnetCandidates, {
      concurrency: 28,
      onProgress: ({ scanned, total }) =>
        options?.onProgress?.({
          scanned,
          total,
          phase: "current-subnet",
          subnetPrefix: preferredSubnetPrefix,
        }),
    });
    if (subnetResults.length > 0) {
      return subnetResults.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
    }
  }

  return [];
}
