import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import type {
  AnalyzedImportRow,
  ImportAccountMatch,
  ImportAnalysis,
  ImportRowStatus,
} from "@capital/server/modules/bank-statements/services/analyze-import";
import type { AccountRecord, AccountType } from "@/lib/api/catalog";

/**
 * The import dialog's review, without React: what each analyzed row
 * becomes (a categorized entry, a transfer to another entity, an aporte
 * or resgate, a card bill payment), whether it is imported at all, the
 * status pills, the confirm KPIs and the plan POST /v2/imports receives.
 */

export type { AnalyzedImportRow, ImportAnalysis, ImportRowStatus };

export type ImportKind = ImportAnalysis["kind"];
export type ReviewFilter = "all" | ImportRowStatus;
export const REVIEW_STATUSES: readonly ImportRowStatus[] = ["rule", "ai", "need", "changed", "dup", "removed"];
/** Pills shown only when some row has the status (a card bill re-imported). */
export const OPTIONAL_STATUSES: readonly ImportRowStatus[] = ["changed", "removed"];

/** How a row is booked. Only bank rows can be transfers, aportes/resgates or bill payments. */
export type RowUse =
  | { as: "category"; categoryId: string | null }
  | { as: "transfer"; entityId: string }
  | { as: "invest"; accountId: string }
  | { as: "card_payment"; cardAccountId: string };

export interface RowDecision {
  /**
   * Acted on (checked): imported, a changed row updates its entry, a row
   * that left the bill goes to the trash. Duplicates and removals start
   * unchecked.
   */
  include: boolean;
  use: RowUse;
  /** The user chose the use in the review (a category picked here becomes a rule). */
  picked: boolean;
}

export type Decisions = Record<string, RowDecision>;

export const isCardKind = (kind: ImportKind) => kind === "card_ofx" || kind === "card_csv";
export const isAssistantKind = (kind: ImportKind) => kind === "pdf" || kind === "image";

/** Accounts that can receive a file of this kind. */
export function accountTypesFor(kind: ImportKind): AccountType[] {
  return isCardKind(kind) ? ["credit_card"] : ["checking", "cash"];
}

/** What the analysis proposes for a row. */
export function defaultUse(row: AnalyzedImportRow): RowUse {
  if (row.kind === "transfer" && row.transfer) return { as: "transfer", entityId: row.transfer.suggestedEntityId };
  if (row.kind === "investment_transfer" && row.investment?.accountId) return { as: "invest", accountId: row.investment.accountId };
  if (row.kind === "card_payment" && row.cardPayment?.cardAccountId) return { as: "card_payment", cardAccountId: row.cardPayment.cardAccountId };
  return { as: "category", categoryId: row.suggestedCategoryId };
}

/** Whether a row starts checked: not a duplicate, and not a removal (deleting is opt-in). */
export const includedByDefault = (row: AnalyzedImportRow) => row.status !== "dup" && row.status !== "removed";

/** A row standing for an entry already booked: its category is the entry's and stays. */
export const keepsEntry = (row: AnalyzedImportRow) => row.status === "changed" || row.status === "removed";

export function initialDecisions(analysis: Pick<ImportAnalysis, "rows">): Decisions {
  return Object.fromEntries(analysis.rows.map((row) => [row.id, { include: includedByDefault(row), use: defaultUse(row), picked: false }]));
}

const decisionOf = (row: AnalyzedImportRow, decisions: Decisions): RowDecision =>
  decisions[row.id] ?? { include: includedByDefault(row), use: defaultUse(row), picked: false };

const hasTarget = (use: RowUse) => use.as !== "category" || !!use.categoryId;

/** The status shown: a row that had no category turns into "Regra aplicada" once one is picked for it. */
export function effectiveStatus(row: AnalyzedImportRow, decision: RowDecision | undefined): ImportRowStatus {
  if (row.status === "need" && decision?.picked && hasTarget(decision.use)) return "rule";
  return row.status;
}

export function statusCounts(rows: readonly AnalyzedImportRow[], decisions: Decisions): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = { all: rows.length, rule: 0, ai: 0, need: 0, changed: 0, dup: 0, removed: 0 };
  for (const row of rows) counts[effectiveStatus(row, decisions[row.id])]++;
  return counts;
}

export function filterRows(rows: readonly AnalyzedImportRow[], decisions: Decisions, filter: ReviewFilter): AnalyzedImportRow[] {
  return filter === "all" ? [...rows] : rows.filter((row) => effectiveStatus(row, decisions[row.id]) === filter);
}

// ---------------------------------------------------------------------------
// The row's picker value ("cat:<id>", "tr:<entity>", "inv:<broker>", "card:<card>")
// ---------------------------------------------------------------------------

const PREFIX = { category: "cat", transfer: "tr", invest: "inv", card_payment: "card" } as const;

export function encodeUse(use: RowUse): string | null {
  switch (use.as) {
    case "category":
      return use.categoryId ? `${PREFIX.category}:${use.categoryId}` : null;
    case "transfer":
      return `${PREFIX.transfer}:${use.entityId}`;
    case "invest":
      return `${PREFIX.invest}:${use.accountId}`;
    case "card_payment":
      return `${PREFIX.card_payment}:${use.cardAccountId}`;
  }
}

export function decodeUse(value: string): RowUse | null {
  const at = value.indexOf(":");
  const id = at > 0 ? value.slice(at + 1) : "";
  if (!id) return null;
  switch (value.slice(0, at)) {
    case PREFIX.category:
      return { as: "category", categoryId: id };
    case PREFIX.transfer:
      return { as: "transfer", entityId: id };
    case PREFIX.invest:
      return { as: "invest", accountId: id };
    case PREFIX.card_payment:
      return { as: "card_payment", cardAccountId: id };
    default:
      return null;
  }
}

/** The review's picker changed a row: it is imported as chosen, and remembered as the user's choice. */
export function pickUse(decisions: Decisions, row: AnalyzedImportRow, value: string): Decisions {
  const use = decodeUse(value);
  if (!use) return decisions;
  const current = decisionOf(row, decisions);
  return { ...decisions, [row.id]: { ...current, use, picked: true } };
}

export function setIncluded(decisions: Decisions, row: AnalyzedImportRow, include: boolean): Decisions {
  return { ...decisions, [row.id]: { ...decisionOf(row, decisions), include } };
}

// ---------------------------------------------------------------------------
// Rules learned and the confirm step
// ---------------------------------------------------------------------------

/** Same normalization as the server's "equals" rules: one rule per description. */
export const ruleKey = (description: string) => description.toLowerCase().trim().replace(/\s+/g, " ");

/** A category the user picked here that no rule gives already: the commit learns a rule from it. */
export function learnsRule(row: AnalyzedImportRow, decision: RowDecision): boolean {
  if (!decision.include || !decision.picked || decision.use.as !== "category" || !decision.use.categoryId) return false;
  return !(row.source === "rule" && row.suggestedCategoryId === decision.use.categoryId);
}

export interface ReviewSummary {
  /** Rows of the file that will be imported (checked), changed rows included. */
  included: number;
  /** Of those, card rows that update the entry they are ("Mudou"). */
  updated: number;
  /** Rows of the statement that left the bill and go to the trash (checked "Saiu da fatura"). */
  removed: number;
  /** Rows of the file left out, and how many of them are duplicates. */
  ignored: number;
  ignoredDuplicates: number;
  /** Signed sum of the rows booked anew, as they hit the account. */
  total: number;
  /** Rules the commit will learn (distinct descriptions). */
  rules: number;
  /** Imported rows booked as transfers (entities, aportes/resgates, bill payments). */
  transfers: number;
}

export function reviewSummary(rows: readonly AnalyzedImportRow[], decisions: Decisions): ReviewSummary {
  const summary: ReviewSummary = { included: 0, updated: 0, removed: 0, ignored: 0, ignoredDuplicates: 0, total: 0, rules: 0, transfers: 0 };
  const rules = new Set<string>();
  let cents = 0;
  for (const row of rows) {
    const decision = decisionOf(row, decisions);
    if (row.status === "removed") {
      if (decision.include) summary.removed++;
      continue;
    }
    if (row.status === "changed") {
      if (decision.include) {
        summary.included++;
        summary.updated++;
      } else {
        summary.ignored++;
      }
      continue;
    }
    if (!decision.include) {
      summary.ignored++;
      if (row.status === "dup") summary.ignoredDuplicates++;
      continue;
    }
    summary.included++;
    cents += Math.round(row.amount * 100);
    if (decision.use.as !== "category") summary.transfers++;
    if (learnsRule(row, decision)) rules.add(ruleKey(row.description));
  }
  summary.total = cents / 100;
  summary.rules = rules.size;
  return summary;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

type EntityKind = "personal" | "business";

/**
 * Label of a transfer between the imported entity and another one, from
 * which way the money moved (port of suggestDirectionForFlow in
 * bank-statements/services/transfer-flow.ts).
 */
export function transferDirection(flow: "outflow" | "inflow", entityKind: EntityKind, counterpartKind: EntityKind): "profit_distribution" | "capital_injection" {
  if (entityKind === counterpartKind) return flow === "outflow" ? "capital_injection" : "profit_distribution";
  const payer = flow === "outflow" ? entityKind : counterpartKind;
  return payer === "business" ? "profit_distribution" : "capital_injection";
}

export interface PlanContext {
  /** The entity of the chosen account. */
  entity: { id: string; kind: EntityKind };
  /** The chosen account (a checking/cash account, or the card for a bill). */
  accountId: string;
  /** Kind of every other entity, for transfer labels. */
  entityKinds: ReadonlyMap<string, EntityKind>;
  /** Fallback when the file names no currency: the account's. */
  currency: string;
  /** Card bills: link the bank expense that paid the bill as its card_payment transfer. */
  linkPayment: boolean;
}

const abs2 = (n: number) => Math.round(Math.abs(n) * 100) / 100;

function bankPlanRows(rows: readonly AnalyzedImportRow[], decisions: Decisions, ctx: PlanContext) {
  const plan = {
    transactions: [] as ImportPlanPayload["transactions"],
    transfers: [] as ImportPlanPayload["transfers"],
    investmentTransfers: [] as ImportPlanPayload["investmentTransfers"],
    cardPayments: [] as NonNullable<ImportPlanPayload["cardPayments"]>,
    reconciliations: [] as ImportPlanPayload["reconciliations"],
    duplicateDecisions: [] as ImportPlanPayload["duplicateDecisions"],
  };
  for (const row of rows) {
    const decision = decisionOf(row, decisions);
    const externalId = row.externalId ?? row.id;
    const base = { externalId, date: row.date, amount: abs2(row.amount) };

    if (row.status === "dup") {
      const existingId = row.duplicateOf?.id ?? null;
      if (!decision.include) {
        // Left out: a look-alike typed by hand gets this row's id, so the next statement recognizes it.
        if (row.reconciliation === "fuzzy_match" && existingId) plan.duplicateDecisions.push({ externalId, resolution: "link_fuzzy", existingTransactionId: existingId });
        else plan.duplicateDecisions.push({ externalId, resolution: "skip_duplicate" });
        continue;
      }
      // Imported although it exists: a changed row updates the entry it is; an exact one is booked again.
      if (row.reconciliation === "changed" && existingId && row.diffs?.length) {
        plan.reconciliations.push({
          existingTransactionId: existingId,
          externalId,
          updates: Object.fromEntries(row.diffs.map((d) => [d.field, d.field === "amount" ? abs2(Number(d.ofxValue)) : d.ofxValue])),
        });
        continue;
      }
      if (row.reconciliation === "duplicate" || row.reconciliation === "changed") plan.duplicateDecisions.push({ externalId, resolution: "import_anyway" });
    } else if (!decision.include) {
      continue;
    }

    const use = decision.use;
    if (use.as === "transfer") {
      const flow = row.type === "expense" ? "outflow" : "inflow";
      const counterpartKind = ctx.entityKinds.get(use.entityId) ?? "personal";
      const suggested = row.transfer?.suggestedEntityId === use.entityId ? row.transfer.suggestedDirection : null;
      plan.transfers.push({
        ...base,
        description: row.description,
        flow,
        direction: suggested ?? transferDirection(flow, ctx.entity.kind, counterpartKind),
        counterpartyEntityType: counterpartKind,
        counterpartyEntityId: use.entityId,
      });
    } else if (use.as === "invest") {
      plan.investmentTransfers.push({
        ...base,
        description: row.description,
        direction: row.type === "expense" ? "investment_deposit" : "investment_withdrawal",
        investmentAccountId: use.accountId,
      });
    } else if (use.as === "card_payment" && row.type === "expense") {
      const month = row.cardPayment?.cardAccountId === use.cardAccountId ? row.cardPayment.statementMonth : null;
      plan.cardPayments.push({ ...base, description: row.description, cardAccountId: use.cardAccountId, ...(month ? { statementMonth: month } : {}) });
    } else {
      const categoryId = use.as === "category" ? use.categoryId : null;
      plan.transactions.push({
        ...base,
        description: row.description,
        type: row.type,
        ...(categoryId ? { categoryId } : {}),
        ...(learnsRule(row, decision) && { createRule: true }),
      });
    }
  }
  return plan;
}

function cardStatementPlan(analysis: ImportAnalysis, decisions: Decisions, ctx: PlanContext) {
  const card = analysis.card!;
  const rows: NonNullable<ImportPlanPayload["cardStatement"]>["rows"] = [];
  const reconciliations: ImportPlanPayload["reconciliations"] = [];
  const removeEntryIds: string[] = [];
  const matchedEntryIds: string[] = [];
  for (const row of analysis.rows) {
    const decision = decisionOf(row, decisions);
    const entryId = row.duplicateOf?.id ?? null;
    if ((row.status === "dup" || row.status === "changed") && entryId) matchedEntryIds.push(entryId);
    if (!decision.include) continue;
    if (row.status === "removed") {
      if (entryId) removeEntryIds.push(entryId);
      continue;
    }
    if (row.status === "changed") {
      // The entry keeps its id and category and takes the bill's values (amount unsigned: still a charge or a refund).
      if (!entryId || !row.diffs?.length) continue;
      reconciliations.push({
        existingTransactionId: entryId,
        externalId: row.externalId ?? row.id,
        updates: Object.fromEntries(row.diffs.map((d) => [d.field, d.field === "amount" ? abs2(Number(d.ofxValue)) : d.ofxValue])),
        ...(row.externalId && { linkExternalId: true }),
      });
      continue;
    }
    const categoryId = decision.use.as === "category" ? decision.use.categoryId : null;
    rows.push({
      date: row.date,
      description: row.description,
      // Statement convention: a charge is positive, a refund negative.
      amount: Math.round(-row.amount * 100) / 100,
      ...(categoryId ? { categoryId } : {}),
      ...(learnsRule(row, decision) && { createRule: true }),
      ...(row.installment && { installment: row.installment }),
      ...(row.status === "dup" && { allowDuplicate: true }),
      ...(row.externalId && { externalId: row.externalId }),
    });
  }
  const statement: NonNullable<ImportPlanPayload["cardStatement"]> = {
    month: card.month,
    closingDate: card.closingDate,
    ...(card.dueDate ? { dueDate: card.dueDate } : {}),
    total: card.total,
    rows,
    linkPayment: ctx.linkPayment,
    ...(removeEntryIds.length > 0 && { removeEntryIds }),
    ...(matchedEntryIds.length > 0 && { matchedEntryIds }),
  };
  return { statement, reconciliations };
}

/** The body of POST /v2/imports for the reviewed analysis. */
export function buildImportPlan(analysis: ImportAnalysis, decisions: Decisions, ctx: PlanContext): ImportPlanPayload {
  const plan: ImportPlanPayload = {
    entityType: ctx.entity.kind,
    entityId: ctx.entity.id,
    accountId: ctx.accountId,
    currency: analysis.currency ?? ctx.currency,
    ...(analysis.bank ? { bankName: analysis.bank } : {}),
    ...(analysis.fileName ? { fileName: analysis.fileName } : {}),
    transactions: [],
    transfers: [],
    investmentTransfers: [],
    creditCards: [],
    bills: [],
    reconciliations: [],
    transferReconciliations: [],
    duplicateDecisions: [],
    investmentTransactions: [],
  };
  if (isCardKind(analysis.kind)) {
    if (analysis.card) {
      const { statement, reconciliations } = cardStatementPlan(analysis, decisions, ctx);
      plan.cardStatement = statement;
      plan.reconciliations = reconciliations;
    }
    return plan;
  }
  const rows = bankPlanRows(analysis.rows, decisions, ctx);
  if (analysis.ledgerBalance != null) plan.ledgerBalance = analysis.ledgerBalance;
  plan.transactions = rows.transactions;
  plan.transfers = rows.transfers;
  plan.investmentTransfers = rows.investmentTransfers;
  plan.reconciliations = rows.reconciliations;
  plan.duplicateDecisions = rows.duplicateDecisions;
  if (rows.cardPayments.length) plan.cardPayments = rows.cardPayments;
  return plan;
}

/** Whether the plan can be committed: an account is chosen, and a card bill knows its statement. */
export function canCommit(analysis: ImportAnalysis | null, accountId: string | null): boolean {
  if (!analysis || !accountId || analysis.viaAssistant || !analysis.rows.length) return false;
  return !isCardKind(analysis.kind) || !!analysis.card;
}

// ---------------------------------------------------------------------------
// Account and entity
// ---------------------------------------------------------------------------

/**
 * The account an entity's import goes to when the entity is switched: its
 * main account of the right type, else its first one; null when it has none.
 */
export function accountForEntity(accounts: readonly AccountRecord[], entityId: string, kind: ImportKind): string | null {
  const types = accountTypesFor(kind);
  const fit = accounts.filter((a) => a.entityId === entityId && !a.archivedAt && types.includes(a.type));
  return (fit.find((a) => a.isDefault) ?? fit[0])?.id ?? null;
}

export type AccountHint = "cardNumber" | "accountNumber" | "only" | "bank" | "default" | "chooseCard" | "chooseAccount" | null;

/** Which hint "Importar na conta" shows: how the account was found, or a prompt to choose one. */
export function accountHint(kind: ImportKind, match: ImportAccountMatch | null, accountId: string | null): AccountHint {
  if (!accountId) return isCardKind(kind) ? "chooseCard" : "chooseAccount";
  switch (match) {
    case "number":
      return isCardKind(kind) ? "cardNumber" : "accountNumber";
    case "only":
    case "bank":
    case "default":
      return match;
    default:
      return null;
  }
}

/** "2026-09" → { month: 9, yy: "26" }, for the short statement label ("set/26"). */
export function statementMonthParts(month: string): { month: number; yy: string } {
  const [year, m] = month.split("-");
  return { month: Number(m), yy: (year ?? "").slice(-2) };
}
