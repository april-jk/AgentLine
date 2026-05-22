const rawBase = import.meta.env.BASE_URL || "/";

export function withBase(path: string): string {
  if (
    !path ||
    path.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    path.startsWith("//")
  ) {
    return path;
  }

  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;

  return `${base}${cleanPath}`;
}
