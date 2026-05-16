import { put, head, BlobNotFoundError, type PutBlobResult } from "@vercel/blob";
import { env } from "@/env";

export function isBlobConfigured(): boolean {
  return !!env.BLOB_READ_WRITE_TOKEN;
}

export async function putObject(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<PutBlobResult> {
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Vercel Blob not configured (BLOB_READ_WRITE_TOKEN missing)");
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
