import {
  putObject as basePutObject,
  headObject as baseHeadObject,
  getObjectBuffer as baseGetObjectBuffer,
  readLocalBlob as baseReadLocalBlob,
  isBlobConfigured as baseIsBlobConfigured,
  isLocalBlobMode as baseIsLocalBlobMode,
  getLocalBlobDir as baseGetLocalBlobDir,
  slugify,
  sanitizeExtension,
  joinPath,
  type PutBlobResult,
  type StorageOptions,
} from "@repo/storage";
import { env } from "@/env";

function options(): StorageOptions {
  return {
    token: env.BLOB_READ_WRITE_TOKEN,
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3002",
  };
}

export function isBlobConfigured(): boolean {
  return baseIsBlobConfigured();
}

export function isLocalBlobMode(): boolean {
  return baseIsLocalBlobMode(options());
}

export function getLocalBlobDir(): string {
  return baseGetLocalBlobDir(options());
}

export function putObject(
  pathname: string,
  body: Buffer,
  contentType: string,
): Promise<PutBlobResult> {
  return basePutObject(pathname, body, contentType, options());
}

export function headObject(url: string) {
  return baseHeadObject(url, options());
}

export function getObjectBuffer(url: string) {
  return baseGetObjectBuffer(url, options());
}

export function readLocalBlob(pathname: string) {
  return baseReadLocalBlob(pathname, options());
}

export function buildDocumentStoragePath(
  procurementId: string,
  sequencial: number,
  title: string,
  extension: string,
): string {
  const slug = slugify(title).slice(0, 60) || "doc";
  const ext = sanitizeExtension(extension);
  return joinPath("procurements", procurementId, `${sequencial}-${slug}.${ext}`);
}

export type { PutBlobResult };
