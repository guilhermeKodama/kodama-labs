import { putObject, deleteObject, slugify, sanitizeExtension, joinPath, type StorageOptions } from "@repo/storage";
import { env } from "../../env";

// Always pass localDir explicitly — @repo/storage defaults to
// cwd-relative (path.resolve(process.cwd(), ".local-blob")), which is
// exactly the fragility apps/attention's WHATSAPP_AUTH_DIR comment warns
// about: a systemd service's cwd is whatever WorkingDirectory says, and
// must not silently determine where uploaded files live.
function storageOpts(): StorageOptions {
  return {
    token: env.BLOB_READ_WRITE_TOKEN,
    localDir: env.CAREERS_BLOB_DIR,
    appUrl: env.NEXT_PUBLIC_APP_URL,
  };
}

function pickExtension(originalName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(originalName);
  return sanitizeExtension(match?.[1] ?? "bin");
}

export async function uploadResumeFile(params: {
  label: string;
  version: number;
  originalName: string;
  body: Buffer;
  contentType: string;
}): Promise<{ url: string; pathname: string }> {
  const ext = pickExtension(params.originalName);
  const slug = slugify(params.originalName.replace(/\.[a-zA-Z0-9]+$/, "")).slice(0, 60) || "resume";
  const pathname = joinPath("careers", "resumes", slugify(params.label), `v${params.version}-${slug}.${ext}`);
  const result = await putObject(pathname, params.body, params.contentType, storageOpts());
  return { url: result.url, pathname };
}

export async function uploadContextDocFile(params: {
  originalName: string;
  body: Buffer;
  contentType: string;
}): Promise<{ url: string; pathname: string }> {
  const ext = pickExtension(params.originalName);
  const slug = slugify(params.originalName.replace(/\.[a-zA-Z0-9]+$/, "")).slice(0, 60) || "doc";
  const pathname = joinPath("careers", "context", `${Date.now()}-${slug}.${ext}`);
  const result = await putObject(pathname, params.body, params.contentType, storageOpts());
  return { url: result.url, pathname };
}

export async function deleteStoredFile(url: string): Promise<void> {
  await deleteObject(url, storageOpts());
}

export function localBlobStorageOpts(): StorageOptions {
  return storageOpts();
}
