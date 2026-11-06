import path from "node:path";

export const LOCAL_URL_MARKER = "/api/blob/";

function assertSafePathname(pathname: string): void {
  if (!pathname || pathname.includes("\0")) {
    throw new Error(`Refusing blob key: ${pathname}`);
  }
  const normalized = path.posix.normalize(pathname.replaceAll("\\", "/"));
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(`Refusing to access blob outside local dir: ${pathname}`);
  }
}

export function localBlobUrl(appUrl: string, pathname: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}${LOCAL_URL_MARKER}${pathname}`;
}

export function localBlobFilePath(localDir: string, pathname: string): string {
  assertSafePathname(pathname);
  const baseDir = path.resolve(localDir);
  const candidate = path.resolve(baseDir, pathname);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) {
    throw new Error(`Refusing to access blob outside local dir: ${pathname}`);
  }
  return candidate;
}
