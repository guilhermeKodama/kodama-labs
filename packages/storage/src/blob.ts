import {
  put,
  head,
  del,
  BlobNotFoundError,
  type PutBlobResult,
} from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";

export type StorageOptions = {
  token?: string;
  localDir?: string;
  appUrl?: string;
};

const LOCAL_URL_MARKER = "/api/blob/";

function resolveToken(opts?: StorageOptions): string | undefined {
  return opts?.token ?? process.env.BLOB_READ_WRITE_TOKEN;
}

function resolveLocalDir(opts?: StorageOptions): string {
  return opts?.localDir ?? path.resolve(process.cwd(), ".local-blob");
}

function resolveAppUrl(opts?: StorageOptions): string {
  return (
    opts?.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}

function localUrlFor(pathname: string, opts?: StorageOptions): string {
  return `${resolveAppUrl(opts)}${LOCAL_URL_MARKER}${pathname}`;
}

export function isBlobConfigured(): boolean {
  return true;
}

export function isLocalBlobMode(opts?: StorageOptions): boolean {
  return !resolveToken(opts);
}

export function getLocalBlobDir(opts?: StorageOptions): string {
  return resolveLocalDir(opts);
}

function resolveLocalPath(pathname: string, opts?: StorageOptions): string {
  const baseDir = resolveLocalDir(opts);
  const candidate = path.resolve(baseDir, pathname);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) {
    throw new Error(`Refusing to access blob outside local dir: ${pathname}`);
  }
  return candidate;
}

function resolveLocalPathFromUrl(
  url: string,
  opts?: StorageOptions,
): string | null {
  const idx = url.indexOf(LOCAL_URL_MARKER);
  if (idx === -1) return null;
  const pathname = url.slice(idx + LOCAL_URL_MARKER.length).split("?")[0]!;
  try {
    return resolveLocalPath(decodeURIComponent(pathname), opts);
  } catch {
    return null;
  }
}

function isLocalUrl(url: string): boolean {
  return url.includes(LOCAL_URL_MARKER);
}

export async function putObject(
  pathname: string,
  body: Buffer,
  contentType: string,
  opts?: StorageOptions,
): Promise<PutBlobResult> {
  const token = resolveToken(opts);
  if (!token) {
    const filePath = resolveLocalPath(pathname, opts);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, body);
    await fs.writeFile(
      `${filePath}.meta.json`,
      JSON.stringify({ contentType }),
    );
    const url = localUrlFor(pathname, opts);
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
    token,
  });
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
  const token = resolveToken(opts);
  if (!token) return null;
  try {
    const res = await head(url, { token });
    return { size: res.size };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
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

export async function deleteObject(
  url: string,
  opts?: StorageOptions,
): Promise<void> {
  if (isLocalUrl(url)) {
    const filePath = resolveLocalPathFromUrl(url, opts);
    if (!filePath) return;
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.meta.json`, { force: true });
    return;
  }
  const token = resolveToken(opts);
  if (!token) return;
  try {
    await del(url, { token });
  } catch (err) {
    if (err instanceof BlobNotFoundError) return;
    throw err;
  }
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

export type { PutBlobResult } from "@vercel/blob";
