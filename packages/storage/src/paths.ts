import path from "node:path";

export const LOCAL_URL_MARKER = "/api/blob/";

const VERCEL_BLOB_HOST = "blob.vercel-storage.com";

export function isVercelBlobUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === VERCEL_BLOB_HOST || host.endsWith(`.${VERCEL_BLOB_HOST}`);
  } catch {
    return false;
  }
}

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

export function pathnameFromVercelBlobUrl(url: string): string {
  if (!isVercelBlobUrl(url)) {
    throw new Error(`Not a Vercel Blob URL: ${url}`);
  }
  const pathname = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ""));
  assertSafePathname(pathname);
  return pathname;
}

export function isRelativeBlobKey(value: string): boolean {
  if (!value || value.includes("://")) return false;
  const stripped = value.replace(/^\/+/, "");
  try {
    assertSafePathname(stripped);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local object key for a stored blob.
 * A relative pathname column wins, because that is the key `putObject`
 * was called with. A full URL (sentinel stores the Vercel URL in
 * `storageKey`) falls back to the URL path.
 */
export function storageKeyForBlob(url: string, pathname?: string | null): string {
  if (pathname && isRelativeBlobKey(pathname)) {
    return pathname.replace(/^\/+/, "");
  }
  return pathnameFromVercelBlobUrl(url);
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

export function rewriteBlobReference(
  url: string,
  appUrl: string,
  pathname?: string | null,
): { key: string; localUrl: string } {
  const key = storageKeyForBlob(url, pathname);
  return { key, localUrl: localBlobUrl(appUrl, key) };
}
