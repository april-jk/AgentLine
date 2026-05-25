export type NativeShellPlatform = "android" | "ios" | "macos" | "windows" | "linux";

export interface NativeShellInfo {
  type: "mobile-rn" | "desktop-electron";
  version?: string;
  platform?: NativeShellPlatform;
  legacy?: boolean;
}

export function getNativeShellAppVersion(): string | null {
  return getNativeShellInfo()?.version ?? null;
}

function getDesktopPlatform(): NativeShellPlatform {
  const platform =
    typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  return "macos";
}

function getMobilePlatform(): NativeShellPlatform {
  const userAgent =
    typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
  return userAgent.includes("android") ? "android" : "ios";
}

export function getNativeShellInfo(): NativeShellInfo | null {
  if (typeof window === "undefined") return null;

  const desktopApi = (
    window as Window & { desktopApi?: { getAppVersion?: () => string } }
  ).desktopApi;
  const desktopVersion = desktopApi?.getAppVersion?.();
  if (typeof desktopVersion === "string" && desktopVersion.trim()) {
    return {
      type: "desktop-electron",
      version: desktopVersion.trim(),
      platform: getDesktopPlatform(),
    };
  }

  const fromWindow = window.__AGENTLINE_NATIVE_APP_VERSION__;
  if (typeof fromWindow === "string" && fromWindow.trim()) {
    return {
      type: "mobile-rn",
      version: fromWindow.trim(),
      platform: getMobilePlatform(),
    };
  }

  try {
    const fromStorage = window.localStorage.getItem(
      "agentline-native-app-version",
    );
    const version = fromStorage?.trim();
    if (version) {
      return {
        type: "mobile-rn",
        version,
        platform: getMobilePlatform(),
      };
    }
  } catch {
    // Continue to legacy shell detection below.
  }

  try {
    if (
      window.__AGENTLINE_NATIVE_SHELL__ ||
      window.localStorage.getItem("agentline-native-shell") === "1" ||
      typeof window.ReactNativeWebView?.postMessage === "function" ||
      new URLSearchParams(window.location.search).has("mobile_entry") ||
      /reactnativewebview/i.test(navigator.userAgent)
    ) {
      return {
        type: "mobile-rn",
        platform: getMobilePlatform(),
        legacy: true,
      };
    }
  } catch {
    return null;
  }

  return null;
}
