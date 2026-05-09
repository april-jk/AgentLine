/**
 * Desktop Electron uses a small port window so the app can recover from stale
 * dev processes while still keeping LAN discovery predictable.
 */
export const DESKTOP_DISCOVERY_PORT_CANDIDATES = [
  45731,
  45732,
  45733,
  45734,
  45735,
  45736,
] as const;

export const DEFAULT_DESKTOP_DISCOVERY_PORT =
  DESKTOP_DISCOVERY_PORT_CANDIDATES[0];

export function buildDesktopDiscoveryPorts(
  preferredPort?: number,
): number[] {
  const ports = preferredPort
    ? [preferredPort, ...DESKTOP_DISCOVERY_PORT_CANDIDATES]
    : [...DESKTOP_DISCOVERY_PORT_CANDIDATES];

  return Array.from(new Set(ports));
}
