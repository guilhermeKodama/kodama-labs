export const OPENAPI_TAGS = {
  v1: {
    name: "Attachments",
    description: "File attachments for transactions, transfers, and recurring entries",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type AttachmentOwnerType =
  | "transaction"
  | "transfer"
  | "recurringTransaction"
  | "recurringTransfer";
