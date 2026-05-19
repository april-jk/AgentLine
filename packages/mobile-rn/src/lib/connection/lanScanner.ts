import {
  DEFAULT_DESKTOP_DISCOVERY_PORT,
  buildDesktopDiscoveryPorts,
} from "../../../../shared/dist/desktop-discovery.js";
import {
  type DirectServerHealth,
  type DirectServerInfo,
  isDirectServerInfo,
  normalizeHttpBaseUrl,
} from "../api/client";

export type LanScanResult = {
  baseUrl: string;
  host: string;
  port: number;
  installId?: string;
  hostAccessUsername?: string;
  hostAccessConfigured?: boolean;
  deviceBridge?: boolean;
};

export type SmartScanProgress = {
  scanned: number;
  total: number;
  phase: "current-subnet";
  subnetPrefix: string;
};

const COMMON_DIRECT_SERVER_PORTS = [3400, 4000] as const;

function parseBaseUrl(baseUrl: string): { host: string; port: number } | null {
  const match = baseUrl.match(/^https?:\/\/([^/:]+)(?::(\d+))?/i);
  if (!match?.[1]) return null;
  const port = Number(match[2] ?? DEFAULT_DESKTOP_DISCOVERY_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: match[1], port };
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function normalizeHostForDisplay(host: string, fallbackHost: string): string {
  const normalized = host.trim();
  if (
    !normalized ||
    normalized === "unknown" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    isLoopbackHost(normalized)
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
  currentServerUrl?: string;
}): string {
  const explicit = options?.preferredSubnetPrefix?.trim();
  if (
    explicit &&
    /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(explicit) &&
    isRoutableLanPrefix(explicit)
  ) {
    return explicit;
  }

  const candidateUrls = [
    options?.currentServerUrl ?? "",
    ...(options?.recentServers ?? []),
  ];
  for (const url of candidateUrls) {
    const host = parseBaseUrl(normalizeHttpBaseUrl(url))?.host ?? "";
    const prefix = extractSubnetPrefix(host);
    if (prefix && isRoutableLanPrefix(prefix)) return prefix;
  }

  return "192.168.1";
}

async function fetchJsonWithTimeout<T>(
  baseUrl: string,
  path: string,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`request_failed_${String(response.status)}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function probeServer(baseUrl: string): Promise<LanScanResult | null> {
  try {
    const normalizedBaseUrl = normalizeHttpBaseUrl(baseUrl);
    const parsed = parseBaseUrl(normalizedBaseUrl);
    const health = await fetchJsonWithTimeout<DirectServerHealth>(
      normalizedBaseUrl,
      "/health",
      900,
    );
    if (health.status !== "ok") return null;
    const info = await fetchJsonWithTimeout<DirectServerInfo>(
      normalizedBaseUrl,
      "/api/server-info",
      1200,
    );
    if (!isDirectServerInfo(info)) return null;
    const fallbackHost = parsed?.host ?? "unknown";
    const fallbackPort = parsed?.port ?? DEFAULT_DESKTOP_DISCOVERY_PORT;
    return {
      baseUrl: normalizedBaseUrl,
      host: normalizeHostForDisplay(info.host, fallbackHost),
      port: info.port ?? fallbackPort,
      installId: info.installId,
      hostAccessUsername: info.hostAccess?.username,
      hostAccessConfigured: info.hostAccess?.configured,
      deviceBridge: info.capabilities?.deviceBridge,
    };
  } catch {
    return null;
  }
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.map((url) => normalizeHttpBaseUrl(url))));
}

function dedupeResults(results: LanScanResult[]): LanScanResult[] {
  const byUrl = new Map<string, LanScanResult>();
  for (const result of results) {
    byUrl.set(result.baseUrl, result);
  }
  return Array.from(byUrl.values()).sort((a, b) =>
    a.baseUrl.localeCompare(b.baseUrl),
  );
}

function buildPortCandidates(options?: {
  preferredPort?: number;
  recentServers?: string[];
  currentServerUrl?: string;
  knownBaseUrls?: string[];
}): number[] {
  const ports: number[] = [];

  const pushPort = (port: number | null | undefined) => {
    const normalizedPort = typeof port === "number" ? port : Number.NaN;
    if (
      !Number.isInteger(normalizedPort) ||
      normalizedPort <= 0 ||
      normalizedPort > 65535
    ) {
      return;
    }
    if (!ports.includes(normalizedPort)) {
      ports.push(normalizedPort);
    }
  };

  pushPort(options?.preferredPort);

  const candidateUrls = [
    options?.currentServerUrl ?? "",
    ...(options?.recentServers ?? []),
    ...(options?.knownBaseUrls ?? []),
  ];
  for (const url of candidateUrls) {
    pushPort(parseBaseUrl(normalizeHttpBaseUrl(url))?.port);
  }

  for (const port of COMMON_DIRECT_SERVER_PORTS) {
    pushPort(port);
  }

  for (const port of buildDesktopDiscoveryPorts(options?.preferredPort)) {
    pushPort(port);
  }

  return ports;
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
      normalizeHttpBaseUrl(
        `http://${normalizedPrefix}.${String(i)}:${String(port)}`,
      ),
    );
  }
  return candidates;
}

async function scanCandidates(
  candidates: string[],
  options?: {
    concurrency?: number;
    onProgress?: (progress: { scanned: number; total: number }) => void;
    onResult?: (result: LanScanResult) => void;
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
      if (item) {
        results.push(item);
        options?.onResult?.(item);
      }
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
  options?: {
    onResult?: (result: LanScanResult) => void;
  },
): Promise<LanScanResult[]> {
  const normalizedPrefix = subnetPrefix.trim().replace(/\.$/, "");
  if (!isRoutableLanPrefix(normalizedPrefix)) {
    throw new Error(`Invalid subnet prefix: "${normalizedPrefix}"`);
  }
  const results = await scanCandidates(
    buildSubnetCandidates(normalizedPrefix, port),
    options,
  );
  return results.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl));
}

export async function smartScanLanServers(options?: {
  port?: number;
  recentServers?: string[];
  preferredSubnetPrefix?: string;
  currentServerUrl?: string;
  knownBaseUrls?: string[];
  expectedInstallIds?: string[];
  onProgress?: (progress: SmartScanProgress) => void;
  onResult?: (result: LanScanResult) => void;
}): Promise<LanScanResult[]> {
  const expectedInstallIds = Array.from(
    new Set(
      (options?.expectedInstallIds ?? []).filter(
        (installId): installId is string => installId.trim().length > 0,
      ),
    ),
  );
  const getMatchingResults = (results: LanScanResult[]): LanScanResult[] => {
    if (expectedInstallIds.length <= 0) return dedupeResults(results);
    return dedupeResults(
      results.filter(
        (result) =>
          result.installId && expectedInstallIds.includes(result.installId),
      ),
    );
  };
  const prioritizeResults = (results: LanScanResult[]): LanScanResult[] => {
    const dedupedResults = dedupeResults(results);
    if (expectedInstallIds.length <= 0) {
      return dedupedResults;
    }

    const matching = dedupedResults.filter(
      (result) =>
        result.installId && expectedInstallIds.includes(result.installId),
    );
    if (matching.length <= 0) {
      return dedupedResults;
    }

    const others = dedupedResults.filter(
      (result) =>
        !result.installId || !expectedInstallIds.includes(result.installId),
    );
    return matching.concat(others);
  };

  const preferredPort = options?.port ?? DEFAULT_DESKTOP_DISCOVERY_PORT;
  const quickPorts = buildPortCandidates({
    preferredPort,
    recentServers: options?.recentServers,
    currentServerUrl: options?.currentServerUrl,
    knownBaseUrls: options?.knownBaseUrls,
  });
  const recent = options?.recentServers ?? [];
  const knownBaseUrls = dedupeUrls(options?.knownBaseUrls ?? []);
  const preferredSubnetPrefix = resolvePreferredSubnetPrefix({
    preferredSubnetPrefix: options?.preferredSubnetPrefix,
    recentServers: recent,
    currentServerUrl: options?.currentServerUrl,
  });

  const exactKnownCandidates = knownBaseUrls.filter((url) => {
    const parsed = parseBaseUrl(url);
    return parsed !== null && !isLoopbackHost(parsed.host);
  });

  const recentHostCandidates = dedupeUrls(
    [options?.currentServerUrl ?? "", ...recent, ...knownBaseUrls].flatMap(
      (url) => {
        const parsed = parseBaseUrl(normalizeHttpBaseUrl(url));
        if (!parsed || isLoopbackHost(parsed.host)) return [];
        return quickPorts.map((port) =>
          normalizeHttpBaseUrl(`http://${parsed.host}:${String(port)}`),
        );
      },
    ),
  );

  const quickCandidates = dedupeUrls(
    exactKnownCandidates.concat(
      quickPorts.flatMap((port) => {
        const quickSubnetCandidates = [
          `http://${preferredSubnetPrefix}.2:${String(port)}`,
          `http://${preferredSubnetPrefix}.3:${String(port)}`,
          `http://${preferredSubnetPrefix}.4:${String(port)}`,
          `http://${preferredSubnetPrefix}.5:${String(port)}`,
          `http://${preferredSubnetPrefix}.10:${String(port)}`,
          `http://${preferredSubnetPrefix}.100:${String(port)}`,
          `http://${preferredSubnetPrefix}.101:${String(port)}`,
          `http://${preferredSubnetPrefix}.102:${String(port)}`,
        ];
        return [...recentHostCandidates, ...quickSubnetCandidates];
      }),
    ),
  );

  const quickResults = await scanCandidates(quickCandidates, {
    concurrency: 12,
    onResult: options?.onResult,
    onProgress: ({ scanned, total }) =>
      options?.onProgress?.({
        scanned,
        total,
        phase: "current-subnet",
        subnetPrefix: preferredSubnetPrefix,
      }),
  });
  const fallbackResults: LanScanResult[] = [...quickResults];
  const matchingQuickResults = getMatchingResults(quickResults);
  if (matchingQuickResults.length > 0) {
    return prioritizeResults(quickResults);
  }
  if (expectedInstallIds.length <= 0 && quickResults.length > 0) {
    return prioritizeResults(quickResults);
  }

  for (const port of quickPorts) {
    const subnetCandidates = dedupeUrls(
      buildSubnetCandidates(preferredSubnetPrefix, port),
    );
    const subnetResults = await scanCandidates(subnetCandidates, {
      concurrency: 28,
      onResult: options?.onResult,
      onProgress: ({ scanned, total }) =>
        options?.onProgress?.({
          scanned,
          total,
          phase: "current-subnet",
          subnetPrefix: preferredSubnetPrefix,
        }),
    });
    fallbackResults.push(...subnetResults);
    const matchingSubnetResults = getMatchingResults(subnetResults);
    if (matchingSubnetResults.length > 0) {
      return prioritizeResults(subnetResults);
    }
  }

  return prioritizeResults(fallbackResults);
}
