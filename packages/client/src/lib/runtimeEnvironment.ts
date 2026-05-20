interface DesktopShellDetectionOptions {
  hasDesktopApi?: boolean;
  userAgent?: string;
}

export function isElectronDesktopShell(
  options: DesktopShellDetectionOptions = {},
): boolean {
  if (options.hasDesktopApi) {
    return true;
  }

  const userAgent =
    options.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : "");

  return /\belectron\b/i.test(userAgent);
}
