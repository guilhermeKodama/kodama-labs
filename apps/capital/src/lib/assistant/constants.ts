// Client-safe mirror of apps/capital/src/server/modules/assistant/constants.ts
// (MAX_STATEMENT_FILE_BYTES, MAX_IMAGE_FILE_BYTES) - kept separate since
// client components can't import server-only modules, and these are the
// values the composer needs before ever hitting the network.

export const MAX_STATEMENT_FILE_BYTES = 15 * 1024 * 1024;

/** Tighter than a statement: Anthropic rejects a single image above this. */
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_STATEMENT_EXTENSIONS = ["ofx", "csv", "pdf"];
export const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];

export const ALLOWED_ASSISTANT_EXTENSIONS = [
  ...ALLOWED_STATEMENT_EXTENSIONS,
  ...ALLOWED_IMAGE_EXTENSIONS,
];

/** `accept` for both composers' file inputs. */
export const ASSISTANT_FILE_ACCEPT = ALLOWED_ASSISTANT_EXTENSIONS.map((e) => `.${e}`).join(",");

export type AssistantFileRejection =
  | { reason: "type" }
  | { reason: "tooLarge"; maxLabel: string };

/**
 * The single validation both composers use. The server sniffs content
 * and is the real authority - this only exists to fail fast with a
 * useful message instead of round-tripping a 15MB file to be rejected.
 */
export function validateAssistantFile(file: File): AssistantFileRejection | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_ASSISTANT_EXTENSIONS.includes(ext)) return { reason: "type" };

  const isImage = ALLOWED_IMAGE_EXTENSIONS.includes(ext);
  const max = isImage ? MAX_IMAGE_FILE_BYTES : MAX_STATEMENT_FILE_BYTES;
  if (file.size > max) {
    return { reason: "tooLarge", maxLabel: isImage ? "5MB" : "15MB" };
  }
  return null;
}

/**
 * A pasted screenshot arrives as a File with an empty or generic name -
 * give it something recognizable, since the name is what the user sees
 * on the chip and what the agent sees in list_statement_files.
 */
export function namePastedImage(file: File, now: number): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type.split("/")[1] ?? "png";
  return new File([file], `screenshot-${now}.${ext}`, { type: file.type });
}
