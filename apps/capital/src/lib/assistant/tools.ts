import { MUTATION_EVENTS, type MutationEvent } from "@/lib/api/invalidation";

/**
 * Status lines for the agent's tool calls ("Buscando transações…"). The
 * server sends a pt-BR label with each call, but a resumed conversation
 * only has the tool's name, and English users need English: the label is
 * looked up by name in the `assistant.tools` messages, and the server's
 * label is the fallback for a tool added later.
 */

export const KNOWN_TOOLS = [
  "get_context_snapshot",
  "list_statement_files",
  "read_attachment",
  "get_parsed_rows",
  "reconcile_statement",
  "search_transactions",
  "search_transfers",
  "query_investment_holdings",
  "list_import_batches",
  "list_credit_card_bills",
  "search_bill_transactions",
  "propose_import_plan",
  "update_import_plan",
  "propose_revert_plan",
  "commit_plan",
  "record_merchant_category",
  "update_transactions",
  "manage_investment_account",
  "manage_investment_holding",
  "record_investment_transaction",
  "fund_investment_account",
  "manage_credit_card",
  "update_bill_transactions",
  "link_bill_to_transaction",
  "update_bill",
  "present_card",
  "web_search",
] as const;

export type KnownTool = (typeof KNOWN_TOOLS)[number];

const KNOWN: ReadonlySet<string> = new Set(KNOWN_TOOLS);

/** The message key under `assistant.tools` for a tool, or null when only the server's label can name it. */
export function toolLabelKey(tool: string): KnownTool | null {
  return KNOWN.has(tool) ? (tool as KnownTool) : null;
}

/**
 * Tools that change the user's data. After a turn that ran one of these,
 * the screens' queries are refreshed (ledger, accounts, investments…).
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "commit_plan",
  "record_merchant_category",
  "update_transactions",
  "manage_investment_account",
  "manage_investment_holding",
  "record_investment_transaction",
  "fund_investment_account",
  "manage_credit_card",
  "update_bill_transactions",
  "link_bill_to_transaction",
  "update_bill",
]);

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool);
}

/**
 * What a finished turn makes stale. A turn that wrote (a write tool, a
 * committed plan) can have touched anything — entries, accounts, cards,
 * holdings, categories, rules, imports — so every screen refreshes; a turn
 * that only read refreshes the conversation list.
 */
export function turnInvalidation(wrote: boolean): readonly MutationEvent[] {
  return wrote ? MUTATION_EVENTS : ["assistant.write"];
}
