import {
  putObject as basePutObject,
  headObject as baseHeadObject,
  getObjectBuffer as baseGetObjectBuffer,
  deleteObject as baseDeleteObject,
  readLocalBlob as baseReadLocalBlob,
  isLocalBlobMode as baseIsLocalBlobMode,
  slugify,
  sanitizeExtension,
  joinPath,
  type PutBlobResult,
  type StorageOptions,
} from "@repo/storage";
import { randomUUID } from "node:crypto";
import { env } from "@/env";
import type { AttachmentKind } from "@/generated/prisma";

// Always pass localDir explicitly — @repo/storage defaults to
// cwd-relative (path.resolve(process.cwd(), ".local-blob")), which is
// exactly the fragility apps/attention's WHATSAPP_AUTH_DIR comment warns
// about: a systemd service's cwd is whatever WorkingDirectory says, and
// must not silently determine where uploaded files live.
function options(): StorageOptions {
  return {
    localDir: env.CAPITAL_BLOB_DIR,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  };
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

export function deleteObject(url: string) {
  return baseDeleteObject(url, options());
}

export function readLocalBlob(pathname: string) {
  return baseReadLocalBlob(pathname, options());
}

export function isLocalBlobMode(): boolean {
  return baseIsLocalBlobMode();
}

function pickExtensionFromName(originalName: string): string {
  const match = originalName.match(/\.([a-zA-Z0-9]{1,8})$/);
  return match ? match[1]!.toLowerCase() : "bin";
}

function kindFolder(kind: AttachmentKind): string {
  return kind.toLowerCase();
}

export function buildAttachmentPath(
  kind: AttachmentKind,
  ownerId: string,
  originalName: string,
): string {
  const ext = sanitizeExtension(pickExtensionFromName(originalName));
  const slug = slugify(originalName.replace(/\.[a-zA-Z0-9]+$/, "")).slice(0, 60) || "file";
  return joinPath(
    "capital",
    ownerId,
    kindFolder(kind),
    `${randomUUID()}-${slug}.${ext}`,
  );
}

export type { PutBlobResult };
