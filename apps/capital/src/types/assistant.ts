// Client-side mirror of the server's message/block/card shapes
// (apps/capital/src/server/modules/assistant/agent/events.ts and
// agent/tools/schemas/import-plan-payload.ts). Kept intentionally loose
// (unknown payloads) since the server is the source of truth for shape -
// these types exist for the UI to dispatch on `kind`/`type`, not to
// re-validate the server's output.

export type ConversationStatus = "active" | "archived";

export interface ConversationSummary {
  id: string;
  title: string | null;
  status: ConversationStatus;
  lastMessageAt: string;
  createdAt: string;
}

export type FileType = "ofx" | "csv" | "pdf" | "image";
export type ParseStatus = "pending" | "parsed" | "failed" | "not_applicable";

export interface ConversationFile {
  id: string;
  fileType: FileType;
  statementKind: string | null;
  originalName: string;
  mimeType: string;
  /** Only needed to render an image thumbnail; absent on optimistic rows. */
  blobUrl?: string;
  sizeBytes: number;
  parseStatus: ParseStatus;
  parseError: string | null;
  rowCount?: number;
  processed?: number;
  total?: number;
  /** Client-only: true once the user removes a file from future turns' context. */
  active?: boolean;
  createdAt?: string;
}

export type PlanKind = "import" | "revert";
export type PlanStatus =
  | "proposed"
  | "confirmed"
  | "committed"
  | "rejected"
  | "superseded"
  | "reverted";

export interface ImportPlan {
  id: string;
  kind: PlanKind;
  status: PlanStatus;
  fileId: string | null;
  payload: unknown;
  payloadHash: string;
  summary: {
    newTransactionCount?: number;
    skipDuplicateCount?: number;
    linkFuzzyCount?: number;
    reconciliationCount?: number;
    transferReconciliationCount?: number;
    transferCount?: number;
    transferOutflow?: number;
    transferInflow?: number;
    creditCardCount?: number;
    billCount?: number;
    billTransactionPreviewCount?: number;
    billTotalPreviewAmount?: number;
    investmentTransactionCount?: number;
    totalIncome?: number;
    totalExpense?: number;
    currency?: string;
    ledgerBalance?: number;
    [key: string]: unknown;
  };
  warnings: string[];
  confirmedAt: string | null;
  committedAt: string | null;
  createdAt: string;
}

export type DuplicateConfidence = "high" | "medium" | "low";

export interface DuplicatePair {
  pairId: string;
  incoming: { description: string; date: string; amount: number; type: "income" | "expense" };
  existing: { id: string; description: string; date: string; amount: number; type: "income" | "expense" };
  confidence: DuplicateConfidence;
  reason: string;
  diffs?: Array<{ field: string; existingValue: string; incomingValue: string }>;
}

export interface DuplicateReviewCard {
  cardId: string;
  cardType: "duplicate_review";
  pairs: DuplicatePair[];
  status: "pending" | "answered";
  decisions?: Record<string, "keep_both" | "merge" | "skip">;
}

// ---- Message content blocks (client-rendered) ----

export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolCallId: string; tool: string; label?: string; status: "running" | "success" | "error"; summary?: string }
  | { kind: "plan"; planId: string; planKind: PlanKind; summary: ImportPlan["summary"]; payloadHash: string; warnings: string[]; status: PlanStatus }
  | { kind: "plan_result"; planId: string; planKind: PlanKind; result: Record<string, unknown> }
  | { kind: "card"; card: DuplicateReviewCard }
  | { kind: "card_response"; text: string }
  | { kind: "attachments"; files: MessageAttachment[] };

/** A file the user attached to their own message, rendered under the bubble. */
export interface MessageAttachment {
  fileId: string;
  originalName: string;
  mediaType?: string;
  blobUrl?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  status: "sending" | "streaming" | "complete" | "error";
  createdAt: string;
  blocks: MessageBlock[];
  /** Raw text accumulator while a message is actively streaming. */
  streamingText?: string;
}

export interface AgentTurnCost {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
}
