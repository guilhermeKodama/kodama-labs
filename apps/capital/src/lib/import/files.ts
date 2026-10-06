/**
 * The files picked in the import dialog, before the server reads them:
 * the badge, the size line, the request body (raw bytes as base64, so the
 * server sees the file's own encoding) and the PDFs and pictures that go
 * to the assistant instead.
 */

export type FileBadge = "OFX" | "CSV" | "PDF" | "IMG" | "TXT";

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif)$/i;

/** Badge of a file, from its name and type. */
export function fileBadge(name: string, type = ""): FileBadge {
  if (/\.(ofx|qfx)$/i.test(name)) return "OFX";
  if (/\.csv$/i.test(name) || type === "text/csv") return "CSV";
  if (/\.pdf$/i.test(name) || type === "application/pdf") return "PDF";
  if (IMAGE.test(name) || type.startsWith("image/")) return "IMG";
  return "TXT";
}

/** PDFs and pictures are read by the assistant, not by the statement parsers. */
export function goesToAssistant(file: { name: string; type?: string }): boolean {
  const badge = fileBadge(file.name, file.type);
  return badge === "PDF" || badge === "IMG";
}

/** The size in the unit the dialog shows: KB below 1 MB (at least 1), MB above with one decimal. */
export function fileSize(bytes: number): { value: number; unit: "KB" | "MB" } {
  if (bytes < 1024 * 1024) return { value: Math.max(1, Math.round(bytes / 1024)), unit: "KB" };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: "MB" };
}

/** Base64 of raw bytes (chunked, so large files do not overflow the argument list). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface ImportFilePayload {
  name: string;
  content: string;
  encoding: "base64";
}

/** Request body entry for one picked file. */
export async function filePayload(file: Pick<File, "name" | "arrayBuffer">): Promise<ImportFilePayload> {
  return { name: file.name, content: bytesToBase64(new Uint8Array(await file.arrayBuffer())), encoding: "base64" };
}
