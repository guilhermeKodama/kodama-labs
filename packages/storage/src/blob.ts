import { promises as fs } from "node:fs";
import path from "node:path";
import {
  LOCAL_URL_MARKER,
  localBlobFilePath,
  localBlobUrl,
} from "./paths";

export type StorageOptions = {
  localDir?: string;
  appUrl?: string;
};

export type PutBlobResult = {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  contentDisposition: string;
};

function resolveLocalDir(opts?: StorageOptions): string {
  return opts?.localDir ?? path.resolve(process.cwd(), ".local-blob");
}

/**
 * Origin baked into absolute blob URLs.
 * `APP_URL` is read when the URL is built, so a server restart picks up a
 * new domain. `buildTime` is the inlined `NEXT_PUBLIC_APP_URL`.
 */
export function runtimeAppUrl(buildTime?: string): string | undefined {
  // Bracket access so the bundler does not inline this at build time.
  const runtime = process.env["APP_URL"];
  if (runtime) return runtime;
  return buildTime;
}

function resolveAppUrl(opts?: StorageOptions): string {
  return (
    runtimeAppUrl(opts?.appUrl) ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

function resolveLocalPath(pathname: string, opts?: StorageOptions): string {
  return localBlobFilePath(resolveLocalDir(opts), pathname);
}

function resolveLocalPathFromUrl(url: string, opts?: StorageOptions): string | null {
  const idx = url.indexOf(LOCAL_URL_MARKER);
  if (idx === -1) return null;
  const pathname = url.slice(idx + LOCAL_URL_MARKER.length).split("?")[0]!;
  try {
    return resolveLocalPath(decodeURIComponent(pathname), opts);
  } catch {
    return null;
  }
}

export function isLocalUrl(url: string): boolean {
  return url.includes(LOCAL_URL_MARKER);
}

export function isBlobConfigured(): boolean {
  return true;
}

export function isLocalBlobMode(): boolean {
  return true;
}

export function getLocalBlobDir(opts?: StorageOptions): string {
  return resolveLocalDir(opts);
}

export async function putObject(
  pathname: string,
  body: Buffer,
  contentType: string,
  opts?: StorageOptions,
): Promise<PutBlobResult> {
  const filePath = resolveLocalPath(pathname, opts);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }));
  const url = localBlobUrl(resolveAppUrl(opts), pathname);
  return {
    url,
    downloadUrl: url,
    pathname,
    contentType,
    contentDisposition: `inline; filename="${path.basename(pathname)}"`,
  };
}

export async function headObject(
  url: string,
  opts?: StorageOptions,
): Promise<{ size: number } | null> {
  if (isLocalUrl(url)) {
    const filePath = resolveLocalPathFromUrl(url, opts);
    if (!filePath) return null;
    try {
      const stat = await fs.stat(filePath);
      return { size: stat.size };
    } catch {
      return null;
    }
  }
  const response = await fetch(url, { method: "HEAD" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Blob head failed: ${response.status} for ${url}`);
  }
  const length = response.headers.get("content-length");
  return { size: length ? Number(length) : 0 };
}

export async function getObjectBuffer(
  url: string,
  opts?: StorageOptions,
): Promise<Buffer | null> {
  if (isLocalUrl(url)) {
    const filePath = resolveLocalPathFromUrl(url, opts);
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Blob fetch failed: ${response.status} for ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function deleteObject(url: string, opts?: StorageOptions): Promise<void> {
  if (!isLocalUrl(url)) return;
  const filePath = resolveLocalPathFromUrl(url, opts);
  if (!filePath) return;
  await fs.rm(filePath, { force: true });
  await fs.rm(`${filePath}.meta.json`, { force: true });
}

export async function readLocalBlob(
  pathname: string,
  opts?: StorageOptions,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const filePath = resolveLocalPath(pathname, opts);
    const buffer = await fs.readFile(filePath);
    let contentType = "application/octet-stream";
    try {
      const meta = await fs.readFile(`${filePath}.meta.json`, "utf-8");
      const parsed = JSON.parse(meta) as { contentType?: string };
      if (parsed.contentType) contentType = parsed.contentType;
    } catch {
      // No meta file — use default content type
    }
    return { buffer, contentType };
  } catch {
    return null;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sanitizeExtension(extension: string): string {
  return extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
}

export function joinPath(...segments: string[]): string {
  return segments
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .join("/");
}
