import type Anthropic from "@anthropic-ai/sdk";
import { getObjectBuffer } from "@/lib/storage";
import { MAX_PDF_REQUEST_BUDGET_BYTES, MAX_PDFS_PER_TURN } from "../constants";

/**
 * What we persist in AgentMessage.content for an attached PDF, instead of
 * its base64 bytes - keeps the DB row small and avoids storing the same
 * megabytes once per message. Not a real Anthropic block type; only
 * buildApiMessages understands it.
 */
export interface CapitalFileRefBlock {
  type: "capital_file_ref";
  fileId: string;
  originalName: string;
  blobUrl: string;
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

interface DbMessageRow {
  role: string;
  content: unknown;
}

/**
 * Rebuild the Anthropic messages array from persisted rows. PDF markers
 * in the MOST RECENT user message are hydrated into real base64 document
 * blocks (subject to the request's PDF budget); markers in older
 * messages are replaced with a short text placeholder instead of
 * re-fetching and re-encoding the same bytes on every later turn - the
 * agent can still see the file via list_statement_files if it needs the
 * summary again.
 */
export async function buildApiMessages(
  rows: DbMessageRow[]
): Promise<Anthropic.MessageParam[]> {
  const lastUserIndex = rows.map((r) => r.role).lastIndexOf("user");

  let pdfBudgetBytes = 0;
  let pdfCount = 0;

  const messages: Anthropic.MessageParam[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const blocks = Array.isArray(row.content) ? row.content : [row.content];
    const hydrated: Anthropic.ContentBlockParam[] = [];

    for (const block of blocks) {
      if (isFileRefBlock(block)) {
        if (i === lastUserIndex && pdfCount < MAX_PDFS_PER_TURN) {
          try {
            const buffer = await getObjectBuffer(block.blobUrl);
            if (buffer && pdfBudgetBytes + buffer.byteLength <= MAX_PDF_REQUEST_BUDGET_BYTES) {
              hydrated.push({
                type: "document",
                title: block.originalName,
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: buffer.toString("base64"),
                },
              });
              pdfBudgetBytes += buffer.byteLength;
              pdfCount++;
              continue;
            }
          } catch {
            // fall through to placeholder on any storage error
          }
        }
        hydrated.push({
          type: "text",
          text: `[Arquivo PDF "${block.originalName}" anexado anteriormente nesta conversa - use list_statement_files ou peça para o usuário reenviar se precisar reler o conteúdo.]`,
        });
        continue;
      }
      // Silently drop UI-only markers (e.g. capital_card_response) - the
      // adjacent text block already carries the same information for
      // the model; never forward an unrecognized shape to the API.
      if (isKnownAnthropicBlock(block)) {
        hydrated.push(block as Anthropic.ContentBlockParam);
      }
    }

    messages.push({ role: row.role === "assistant" ? "assistant" : "user", content: hydrated });
  }

  return messages;
}
