import { put, head, BlobNotFoundError, type PutBlobResult } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/env";

const LOCAL_BLOB_DIR = path.resolve(process.cwd(), ".local-blob");

function localBase(): string {
  return env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002";
}

function localUrlFor(pathname: string): string {
  return `${localBase()}/api/_blob/${pathname}`;
}

function shouldUseLocalMode(): boolean {
  return !env.BLOB_READ_WRITE_TOKEN;
}

export function isBlobConfigured(): boolean {
  // Always true: local filesystem fallback is always available.
  return true;
}

export function isLocalBlobMode(): boolean {
  return shouldUseLocalMode();
}

export function getLocalBlobDir(): string {
  return LOCAL_BLOB_DIR;
}

export async function putObject(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<PutBlobResult> {
  if (shouldUseLocalMode()) {
    const filePath = resolveLocalPath(pathname);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType }));
    const url = localUrlFor(pathname);
    return {
      url,
      downloadUrl: url,
      pathname,
      contentType,
      contentDisposition: `inline; filename="${path.basename(pathname)}"`,
    };
  }
  return put(pathname, body, {
    access: "public",
    addRandomSuffix: false,
    contentType,
    token: env.BLOB_READ_WRITE_TOKEN,
  });
}

export async function headObject(
  url: string,
): Promise<{ size: number } | null> {
  if (isLocalUrl(url)) {
    const filePath = resolveLocalPathFromUrl(url);
    if (!filePath) return null;
    try {
      const stat = await fs.stat(filePath);
      return { size: stat.size };
    } catch {
      return null;
    }
  }
  if (!env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const res = await head(url, { token: env.BLOB_READ_WRITE_TOKEN });
    return { size: res.size };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

export async function getObjectBuffer(url: string): Promise<Buffer | null> {
  if (isLocalUrl(url)) {
    const filePath = resolveLocalPathFromUrl(url);
    if (!filePath) return null;
    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Blob fetch failed: ${response.status} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

export function buildDocumentStoragePath(
  procurementId: string,
  sequencial: number,
  title: string,
  extension: string,
): string {
  const safeExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `procurements/${procurementId}/${sequencial}-${slug || "doc"}.${safeExt}`;
}

function isLocalUrl(url: string): boolean {
  return url.includes("/api/_blob/");
}

function resolveLocalPath(pathname: string): string {
  const candidate = path.resolve(LOCAL_BLOB_DIR, pathname);
  if (!candidate.startsWith(LOCAL_BLOB_DIR + path.sep) && candidate !== LOCAL_BLOB_DIR) {
    throw new Error(`Refusing to write blob outside local dir: ${pathname}`);
  }
  return candidate;
}

function resolveLocalPathFromUrl(url: string): string | null {
  const marker = "/api/_blob/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const pathname = url.slice(idx + marker.length).split("?")[0]!;
  try {
    return resolveLocalPath(decodeURIComponent(pathname));
  } catch {
    return null;
  }
}

export async function readLocalBlob(
  pathname: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const filePath = resolveLocalPath(pathname);
    const buffer = await fs.readFile(filePath);
    let contentType = "application/octet-stream";
    try {
      const meta = await fs.readFile(`${filePath}.meta.json`, "utf-8");
      const parsed = JSON.parse(meta) as { contentType?: string };
      if (parsed.contentType) contentType = parsed.contentType;
    } catch {
      // No meta file — use default
    }
    return { buffer, contentType };
  } catch {
    return null;
  }
}
