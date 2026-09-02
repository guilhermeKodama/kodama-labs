import type { ChatMessage, MessageBlock, MessageAttachment, DuplicateReviewCard } from "@/types/assistant";

export interface RawAgentMessage {
  id: string;
  turnId: string | null;
  role: string;
  content: unknown;
  kind: string;
  createdAt: string;
}

interface AnthropicLikeBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  [key: string]: unknown;
}

const PLAN_TOOLS = new Set(["propose_import_plan", "update_import_plan", "propose_revert_plan"]);

function parseToolResultContent(content: unknown): Record<string, unknown> {
  if (typeof content === "string") {
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (content && typeof content === "object") return content as Record<string, unknown>;
  return {};
}

/**
 * Rebuild the client's block-based message list from the server's raw
 * persisted rows (Anthropic-shaped content). This is what turns
 * text/tool_use/tool_result pairs, spread across an assistant row and
 * the following tool_results row, into the single coherent
 * text-then-tool-then-card sequence the thread renders - the same
 * end-state the live SSE path builds up incrementally as events arrive.
 */
export function parseHistoryToMessages(rows: RawAgentMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  // toolCallId -> the ChatMessage.blocks index it lives in, so a later
  // tool_results row can fill in status/summary on the right block.
  const toolBlockLocation = new Map<string, { messageIndex: number; blockIndex: number }>();

  for (const row of rows) {
    if (row.kind === "tool_results") {
      const blocks = Array.isArray(row.content) ? (row.content as AnthropicLikeBlock[]) : [];
      for (const block of blocks) {
        if (block.type !== "tool_result" || !block.tool_use_id) continue;
        const location = toolBlockLocation.get(block.tool_use_id);
        if (!location) continue;
        const target = messages[location.messageIndex]?.blocks[location.blockIndex];
        if (!target) continue;
        const output = parseToolResultContent(block.content);

        if (target.kind === "tool") {
          target.status = block.is_error ? "error" : "success";
        } else if (target.kind === "plan" && !block.is_error) {
          target.planId = (output.planId as string) ?? target.planId;
          target.status = (output.status as typeof target.status) ?? target.status;
          target.summary = (output.summary as typeof target.summary) ?? target.summary;
          target.payloadHash = (output.payloadHash as string) ?? target.payloadHash;
          target.warnings = (output.warnings as string[]) ?? target.warnings;
        } else if (target.kind === "plan_result" && !block.is_error) {
          target.planId = (output.planId as string) ?? target.planId;
          target.result = output;
        } else if (target.kind === "card" && !block.is_error) {
          target.card = { ...target.card, ...(output as Partial<DuplicateReviewCard>) };
        }
      }
      continue;
    }

    if (row.role === "user") {
      const blocks = Array.isArray(row.content) ? (row.content as AnthropicLikeBlock[]) : [];
      const textBlock = blocks.find((b) => b.type === "text");
      const userBlocks: MessageBlock[] = [
        row.kind === "card_response"
          ? { kind: "card_response", text: textBlock?.text ?? "" }
          : { kind: "text", text: textBlock?.text ?? "" },
      ];
      // capital_file_ref is the marker the server persists in place of a
      // PDF/image's bytes - it's what lets a reloaded thread still show
      // the screenshot the user sent.
      const attachments: MessageAttachment[] = blocks
        .filter((b) => b.type === "capital_file_ref")
        .map((b) => ({
          fileId: String(b.fileId ?? ""),
          originalName: String(b.originalName ?? ""),
          mediaType: typeof b.mediaType === "string" ? b.mediaType : undefined,
          blobUrl: typeof b.blobUrl === "string" ? b.blobUrl : undefined,
        }));
      if (attachments.length > 0) {
        userBlocks.push({ kind: "attachments", files: attachments });
      }
      messages.push({
        id: row.id,
        role: "user",
        status: "complete",
        createdAt: row.createdAt,
        blocks: userBlocks,
      });
      continue;
    }

    // role === "assistant"
    const blocks = Array.isArray(row.content) ? (row.content as AnthropicLikeBlock[]) : [];
    const uiBlocks: MessageBlock[] = [];
    const messageIndex = messages.length;

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        uiBlocks.push({ kind: "text", text: block.text });
      } else if (block.type === "tool_use" && block.id && block.name) {
        const blockIndex = uiBlocks.length;
        if (PLAN_TOOLS.has(block.name)) {
          uiBlocks.push({
            kind: "plan",
            planId: "",
            planKind: block.name === "propose_revert_plan" ? "revert" : "import",
            summary: {},
            payloadHash: "",
            warnings: [],
            status: "proposed",
          });
        } else if (block.name === "commit_plan") {
          uiBlocks.push({ kind: "plan_result", planId: "", planKind: "import", result: {} });
        } else if (block.name === "present_card") {
          uiBlocks.push({
            kind: "card",
            card: { cardId: "", cardType: "duplicate_review", pairs: [], status: "pending" },
          });
        } else {
          uiBlocks.push({ kind: "tool", toolCallId: block.id, tool: block.name, status: "running" });
        }
        toolBlockLocation.set(block.id, { messageIndex, blockIndex });
      }
    }

    messages.push({
      id: row.id,
      role: "assistant",
      status: "complete",
      createdAt: row.createdAt,
      blocks: uiBlocks,
    });
  }

  return messages;
}
