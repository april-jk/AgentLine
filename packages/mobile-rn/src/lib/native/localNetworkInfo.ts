import { NativeModules } from "react-native";

type LocalNetworkInfoNativeModule = {
  getLocalIPv4Address?: () => Promise<string | null>;
};

const nativeModule = NativeModules.LocalNetworkInfo as
  | LocalNetworkInfoNativeModule
  | undefined;

export const hasLocalNetworkInfoModule =
  typeof nativeModule?.getLocalIPv4Address === "function";

function isRoutableLanPrefix(prefix: string): boolean {
  const match = prefix.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const a = Number(match[1] ?? -1);
  const b = Number(match[2] ?? -1);
  const c = Number(match[3] ?? -1);
  if (![a, b, c].every((part) => Number.isInteger(part))) return false;
  if ([a, b, c].some((part) => part < 0 || part > 255)) return false;
  if (a === 127 || a === 0) return false;
  if (a === 169 && b === 254) return false;
  return true;
}

function extractSubnetPrefix(ipAddress: string): string | null {
  const match = ipAddress
    .trim()
    .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  const prefix = match?.[1] ?? null;
  if (!prefix || !isRoutableLanPrefix(prefix)) return null;
  return prefix;
}

export async function getLocalSubnetPrefix(): Promise<string | null> {
  try {
    const ipAddress = await nativeModule?.getLocalIPv4Address?.();
    if (!ipAddress) return null;
    return extractSubnetPrefix(ipAddress);
  } catch {
    return null;
  }
}
