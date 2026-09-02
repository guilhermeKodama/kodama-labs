import type Anthropic from "@anthropic-ai/sdk";
import { getObjectBuffer } from "@/lib/storage";
import {
  MAX_FILE_REQUEST_BUDGET_BYTES,
  MAX_IMAGES_PER_TURN,
  MAX_PDFS_PER_TURN,
  isAllowedImageMediaType,
} from "../constants";

/**
 * What we persist in AgentMessage.content for an attached PDF or image,
 * instead of its base64 bytes - keeps the DB row small and avoids
 * storing the same megabytes once per message. Not a real Anthropic
 * block type; only buildApiMessages understands it.
 */
export interface CapitalFileRefBlock {
  type: "capital_file_ref";
  fileId: string;
  originalName: string;
  blobUrl: string;
  /**
   * Absent on rows written before image support shipped, where every ref
   * was a PDF - so an undefined mediaType must keep meaning PDF.
   */
  mediaType?: string;
}

export function isFileRefBlock(block: unknown): block is CapitalFileRefBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "capital_file_ref"
  );
}

/** Anthropic content-block types we ever persist and can replay verbatim. */
const KNOWN_ANTHROPIC_BLOCK_TYPES = new Set([
  "text",
  "thinking",
  "redacted_thinking",
  "tool_use",
  "tool_result",
  "document",
  "image",
  // web_search server tool: the query Claude issued, and the results it
  // got back - preserved so a later turn still has the grounding for
  // whatever the model concluded from the search, not just its prose.
  "server_tool_use",
  "web_search_tool_result",
]);

function isKnownAnthropicBlock(block: unknown): boolean {
  return (
    typeof block === "object" &&
    block !== null &&
    KNOWN_ANTHROPIC_BLOCK_TYPES.has((block as { type?: unknown }).type as string)
  );
}

function isImageRef(block: CapitalFileRefBlock): boolean {
  return typeof block.mediaType === "string" && block.mediaType.startsWith("image/");
}

function stalePlaceholder(block: CapitalFileRefBlock): Anthropic.TextBlockParam {
  if (isImageRef(block)) {
    return {
      type: "text",
      text: `[Imagem "${block.originalName}" anexada anteriormente nesta conversa - peça para o usuário reenviar se precisar vê-la de novo.]`,
    };
  }
  return {
    type: "text",
    text: `[Arquivo PDF "${block.originalName}" anexado anteriormente nesta conversa - use list_statement_files ou peça para o usuário reenviar se precisar reler o conteúdo.]`,
  };
}

interface DbMessageRow {
  role: string;
  content: unknown;
}

interface HydrationBudget {
  bytes: number;
  pdfs: number;
  images: number;
}

/**
 * Turn a file ref into the real block Claude reads, or null when the
 * per-turn caps or the shared byte budget are already spent (the caller
 * then falls back to a text placeholder).
 */
async function hydrateFileRef(
  block: CapitalFileRefBlock,
  budget: HydrationBudget
): Promise<Anthropic.ContentBlockParam | null> {
  const image = isImageRef(block);
  if (image ? budget.images >= MAX_IMAGES_PER_TURN : budget.pdfs >= MAX_PDFS_PER_TURN) {
    return null;
  }

  let buffer: Buffer | null = null;
  try {
    buffer = await getObjectBuffer(block.blobUrl);
  } catch {
    return null; // any storage error falls back to the placeholder
  }
  if (!buffer || budget.bytes + buffer.byteLength > MAX_FILE_REQUEST_BUDGET_BYTES) {
    return null;
  }

  if (image) {
    // Guard the API contract at the boundary: mediaType comes from a DB
    // row, and only four types are accepted.
    const mediaType = block.mediaType!;
    if (!isAllowedImageMediaType(mediaType)) return null;
    budget.bytes += buffer.byteLength;
    budget.images++;
    return {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: buffer.toString("base64") },
    };
  }

  budget.bytes += buffer.byteLength;
  budget.pdfs++;
  return {
    type: "document",
    title: block.originalName,
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: buffer.toString("base64"),
    },
  };
}

/**
 * Load a file a tool asked Claude to look at, as a real content block.
 * Unlike buildApiMessages' hydration this is not budgeted per turn - a
 * read_attachment call is an explicit, model-initiated fetch of at most
 * MAX_IMAGES_PER_TURN files, not history replay. Returns null on any
 * storage error or unsupported type so the caller can substitute text.
 */
export async function hydrateMediaRef(ref: {
  originalName: string;
  blobUrl: string;
  mediaType: string;
}): Promise<Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | null> {
  let buffer: Buffer | null = null;
  try {
    buffer = await getObjectBuffer(ref.blobUrl);
  } catch {
    return null;
  }
  if (!buffer || buffer.byteLength > MAX_FILE_REQUEST_BUDGET_BYTES) return null;

  if (isAllowedImageMediaType(ref.mediaType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: ref.mediaType, data: buffer.toString("base64") },
    };
  }
  if (ref.mediaType === "application/pdf") {
    return {
      type: "document",
      title: ref.originalName,
      source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
    };
  }
  return null;
}

/**
 * tool_result blocks can carry file refs too (read_attachment persists
 * the marker rather than the bytes it actually sent the API). Those are
 * never re-hydrated: by the time a row is replayed the turn that fetched
 * them is over, and the model can call the tool again if it still needs
 * to look. Collapse them to a placeholder in place.
 */
function stripNestedFileRefs(block: Anthropic.ContentBlockParam): Anthropic.ContentBlockParam {
  if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
  return {
    ...block,
    content: block.content.map((inner) =>
      isFileRefBlock(inner) ? stalePlaceholder(inner) : inner
    ) as Anthropic.ToolResultBlockParam["content"],
  };
}

/**
 * Rebuild the Anthropic messages array from persisted rows. File markers
 * in the MOST RECENT user message are hydrated into real base64
 * document/image blocks (subject to the request's shared byte budget and
 * the per-type caps); markers in older messages are replaced with a short
 * text placeholder instead of re-fetching and re-encoding the same bytes
 * on every later turn - the agent can still see the file via
 * list_statement_files if it needs the summary again.
 */
export async function buildApiMessages(
  rows: DbMessageRow[]
): Promise<Anthropic.MessageParam[]> {
  const lastUserIndex = rows.map((r) => r.role).lastIndexOf("user");
  const budget: HydrationBudget = { bytes: 0, pdfs: 0, images: 0 };

  const messages: Anthropic.MessageParam[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const blocks = Array.isArray(row.content) ? row.content : [row.content];
    const hydrated: Anthropic.ContentBlockParam[] = [];

    for (const block of blocks) {
      if (isFileRefBlock(block)) {
        const real = i === lastUserIndex ? await hydrateFileRef(block, budget) : null;
        hydrated.push(real ?? stalePlaceholder(block));
        continue;
      }
      // Silently drop UI-only markers (e.g. capital_card_response) - the
      // adjacent text block already carries the same information for
      // the model; never forward an unrecognized shape to the API.
      if (isKnownAnthropicBlock(block)) {
        hydrated.push(stripNestedFileRefs(block as Anthropic.ContentBlockParam));
      }
    }

    messages.push({ role: row.role === "assistant" ? "assistant" : "user", content: hydrated });
  }

  return messages;
}
