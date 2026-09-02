export const OPENAPI_TAGS = {
  v1: {
    name: "Assistant",
    description: "AI chat that reconciles uploaded statements into the ledger",
  },
} as const;

export const routeConfig = {
  v1: {
    defaultTags: [OPENAPI_TAGS.v1.name],
  },
} as const;

export const MAX_STATEMENT_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Anthropic rejects a single image above ~5MB, so images get a tighter
 * cap than the 15MB we allow a statement - failing at upload with a
 * clear message beats a 400 in the middle of a turn.
 */
export const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;

/** The only image media types the Messages API accepts. */
export const ALLOWED_IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type AllowedImageMediaType = (typeof ALLOWED_IMAGE_MEDIA_TYPES)[number];

export function isAllowedImageMediaType(value: string): value is AllowedImageMediaType {
  return (ALLOWED_IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

/** Shared byte ceiling for everything we base64 into one request (PDFs + images). */
export const MAX_FILE_REQUEST_BUDGET_BYTES = 25 * 1024 * 1024;
export const MAX_PDFS_PER_TURN = 5;
export const MAX_IMAGES_PER_TURN = 5;

export const MAX_TOOL_ITERATIONS_DEFAULT = 12;
export const MAX_TURN_COST_USD_DEFAULT = 0.5;

/** Anthropic's web_search server tool executes outside the client tool-call loop above, so it needs its own per-API-call cap. */
export const MAX_WEB_SEARCHES_PER_TURN = 5;

/** Plan confirmations older than this are treated as stale - the user must re-propose. */
export const PLAN_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;
