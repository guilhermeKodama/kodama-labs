import type { Account, Entity } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { categorizeBillTransactions, categorizeStatementTransactions } from "@capital/server/lib/claude";
import { BILL_LABEL_KEYS, STATEMENT_LABEL_KEYS } from "@capital/server/lib/category-prompt";
import { fetchReconciliationContext } from "@capital/server/modules/assistant/data/queries/fetch-reconciliation-context";
import { getSystemCategory, getSystemCategoryNames } from "@capital/server/modules/categories/lib/system-categories";
import type { AiCategorizers } from "@capital/server/modules/categories/services/ai-categorize";
import { calculateBillTotal, dedupeKey, isProjected } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { round } from "@capital/server/modules/ledger/lib/money";
import { loadRuleMatcher } from "@capital/server/modules/ledger/services/rules";
import { closingDateFor, dueDateFor, statementMonthFor } from "@capital/server/modules/ledger/services/statements";
import { findStatementPaymentEntry, paymentStatementMonth } from "./card-payments";
import {
  accountNumberMatches,
  decodeImportFiles,
  lastDigits,
  parseBankFiles,
  parseCardFiles,
  type ImportFileInput,
  type ImportFileKind,
  type ParsedCardRow,
} from "./import-files";
import {
  classifyTransactions,
  detectReconciliation,
  normalizeTransactions,
  type ClassificationCandidate,
  type FieldDiff,
  type TransferDetails,
} from "./reconciliation";

/**
 * POST /v2/imports/analyze: what the import dialog shows before anything is
 * written. One analysis covers one or more files of the same kind (a bank
 * OFX, a card OFX or a card CSV): the bank, the period, the account the
 * file belongs to, and per row whether it is already in the ledger (dup),
 * categorized by a rule (rule), by an AI suggestion (ai), or still needs a
 * category (need). PDFs and images are read by the assistant instead.
 * Reads only, except that an AI pass may seed the user's system categories.
 */

export type ImportRowStatus = "dup" | "rule" | "ai" | "need";
export type ImportRowKind = "entry" | "transfer" | "investment_transfer" | "card_payment";
export type ImportCategorySource = "rule" | "ai" | "existing" | "classification";

export interface AnalyzedImportRow {
  /** FITID for bank rows, "c<index>" for card rows; the review keys its decisions by it. */
  id: string;
  /** FITID of a bank row (the plan's externalId); null on card rows. */
  externalId: string | null;
  date: string;
  description: string;
  /** Bank memo before shortening. */
  fullDescription?: string;
  /** Signed as it hits the account: money out (an expense, a card purchase) is negative. */
  amount: number;
  type: "income" | "expense";
  kind: ImportRowKind;
  status: ImportRowStatus;
  /** The ledger row this one repeats (dup rows). */
  duplicateOf: { id: string | null; description: string; date: string } | null;
  /** Bank rows: how the row compares with the ledger (a "changed" row updates its existing entry). */
  reconciliation?: "new" | "duplicate" | "changed" | "fuzzy_match";
  diffs?: FieldDiff[];
  suggestedCategoryId: string | null;
  source: ImportCategorySource | null;
  ruleId: string | null;
  rulePattern: string | null;
  installment?: { number: number; total: number };
  /** Card installment that replaces the projected one already booked. */
  replacesProjected?: boolean;
  transfer?: TransferDetails;
  investment?: { direction: "investment_deposit" | "investment_withdrawal"; accountId: string | null };
  cardPayment?: { cardAccountId: string | null; statementMonth: string | null };
  /** Several classifications fit (needs a choice). */
  candidates?: ClassificationCandidate[];
}

export interface ImportCardTarget {
  accountId: string;
  /** Statement month (YYYY-MM) the rows go to. */
  month: string;
  closingDate: string;
  dueDate: string | null;
  statementId: string | null;
  /** Bill total from the file (charges minus this cycle's refunds). */
  total: number;
  /** Live rows the statement already has. */
  existingCount: number;
  paid: boolean;
  payFromAccountId: string | null;
  /** Bank expense that looks like this bill's payment (linkPayment turns it into the card_payment transfer). */
  payment: { entryId: string; description: string; date: string; amount: number } | null;
}

export type ImportAccountMatch = "explicit" | "number" | "only" | "bank" | "default";

export interface ImportAnalysis {
  kind: ImportFileKind;
  /** PDFs and images: send them through the assistant (nothing else is filled). */
  viaAssistant?: true;
  files: { name: string; size: number; kind: ImportFileKind }[];
  fileName: string;
  bank: string | null;
  currency: string | null;
  period: { from: string; to: string } | null;
  count: number;
  /** Account or card number read from the file. */
  externalAccountId: string | null;
  suggestedAccountId: string | null;
  accountMatch: ImportAccountMatch | null;
  entityId: string | null;
  ledgerBalance: number | null;
  /** Card-bill payment lines in the file (left out of the rows). */
  payments: number;
  card: ImportCardTarget | null;
  rows: AnalyzedImportRow[];
  summary: { counts: Record<"all" | ImportRowStatus, number>; income: number; expense: number };
  ai: { requested: boolean; available: boolean; used: boolean };
}

export interface AnalyzeImportInput {
  files: ImportFileInput[];
  /** Account chosen in the dialog; otherwise the analysis suggests one. */
  accountId?: string | null;
  /** Ask the AI for categories of rows no rule covers. */
  ai?: boolean;
}

export interface AnalyzeImportOptions {
  /** Injected categorizers (tests); by default the Claude ones, only with ANTHROPIC_API_KEY set. */
  categorizers?: AiCategorizers;
}

const BANK_TYPES = ["checking", "cash"] as const;
const FUZZY_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

function emptyAnalysis(kind: ImportFileKind, files: ImportAnalysis["files"]): ImportAnalysis {
  return {
    kind,
    files,
    fileName: files[0]?.name ?? "",
    bank: null,
    currency: null,
    period: null,
    count: 0,
    externalAccountId: null,
    suggestedAccountId: null,
    accountMatch: null,
    entityId: null,
    ledgerBalance: null,
    payments: 0,
    card: null,
    rows: [],
    summary: { counts: { all: 0, dup: 0, rule: 0, ai: 0, need: 0 }, income: 0, expense: 0 },
    ai: { requested: false, available: false, used: false },
  };
}

async function explicitAccount(userId: string, accountId: string, card: boolean, db: DbClient): Promise<Account> {
  const account = await db.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound("Account", "account.not_found");
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  const fits = card ? account.type === "credit_card" : (BANK_TYPES as readonly string[]).includes(account.type);
  if (!fits) {
    throw new LedgerError(`Account "${account.name}" cannot receive this file`, 422, { code: "import.account_kind_mismatch", params: { name: account.name } });
  }
  return account;
}

/** The one account whose institution or name mentions the bank, if exactly one does. */
function byBankName(accounts: Account[], bank: string | null): Account | null {
  if (!bank) return null;
  const needle = normalize(bank);
  const hits = accounts.filter((a) => normalize(`${a.institution ?? ""} ${a.name}`).includes(needle));
  return hits.length === 1 ? hits[0] : null;
}

async function suggestAccount(
  userId: string,
  input: { accountId?: string | null; card: boolean; externalAccountId: string | null; bank: string | null },
  db: DbClient
): Promise<{ account: Account | null; match: ImportAccountMatch | null }> {
  if (input.accountId) return { account: await explicitAccount(userId, input.accountId, input.card, db), match: "explicit" };
  const accounts = await db.account.findMany({
    where: { userId, archivedAt: null, type: input.card ? "credit_card" : { in: [...BANK_TYPES] } },
    orderBy: { createdAt: "asc" },
  });
  if (input.externalAccountId) {
    const hit = input.card
      ? accounts.find((a) => lastDigits(a.externalId) && lastDigits(a.externalId) === lastDigits(input.externalAccountId))
      : accounts.find((a) => accountNumberMatches(input.externalAccountId, a.externalId));
    if (hit) return { account: hit, match: "number" };
  }
  if (accounts.length === 1) return { account: accounts[0], match: "only" };
  const named = byBankName(accounts, input.bank);
  if (named) return { account: named, match: "bank" };
  if (input.card) return { account: null, match: null };
  const personal = await db.entity.findFirst({ where: { userId, kind: "personal" }, orderBy: { createdAt: "asc" } });
  const fallback = accounts.find((a) => a.isDefault && a.entityId === personal?.id) ?? accounts.find((a) => a.isDefault) ?? null;
  return { account: fallback, match: fallback ? "default" : null };
}

function summarize(rows: AnalyzedImportRow[]): ImportAnalysis["summary"] {
  const counts = { all: rows.length, dup: 0, rule: 0, ai: 0, need: 0 };
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    counts[r.status]++;
    if (r.status === "dup") continue;
    if (r.amount >= 0) income += r.amount;
    else expense -= r.amount;
  }
  return { counts, income: round(income, 2), expense: round(expense, 2) };
}

// ---------------------------------------------------------------------------
// AI pass
// ---------------------------------------------------------------------------

/**
 * Categories for the rows nothing categorized, in one batched call per
 * prompt (the Claude helpers chunk by 50). A suggestion of the fallback
 * ("Outros") is no suggestion. Resolving the prompt's labels may seed the
 * user's missing system categories, as an import does.
 */
async function aiPass(userId: string, rows: AnalyzedImportRow[], prompt: "bill" | "statement", db: DbClient, categorizers: AiCategorizers): Promise<boolean> {
  const pending = rows.filter((r) => r.status === "need" && r.kind === "entry");
  if (!pending.length) return false;
  const otherExpense = await getSystemCategory(userId, "other_system", db);
  const otherIncome = await getSystemCategory(userId, "other_income", db);
  const labels = await getSystemCategoryNames(userId, prompt === "bill" ? BILL_LABEL_KEYS : STATEMENT_LABEL_KEYS, db);
  const categories = await db.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, isArchived: true } });
  const visible = (type: "income" | "expense", fallback: string) => [...new Set([...categories.filter((c) => c.type === type && !c.isArchived).map((c) => c.name), fallback])];
  const apply = (batch: AnalyzedImportRow[], results: { index: number; category: string }[], type: "income" | "expense", fallbackId: string) => {
    for (const r of results) {
      const row = batch[r.index];
      const category = categories.find((c) => c.name === r.category && c.type === type && !c.isArchived);
      if (!row || !category || category.id === fallbackId) continue;
      Object.assign(row, { status: "ai", suggestedCategoryId: category.id, source: "ai" });
    }
  };
  const toInput = (batch: AnalyzedImportRow[]) => batch.map((r, index) => ({ index, description: r.description, amount: Math.abs(r.amount) }));

  if (prompt === "bill") {
    const categorize = categorizers.bill ?? categorizeBillTransactions;
    apply(pending, await categorize(toInput(pending), visible("expense", otherExpense.name), otherExpense.name, labels), "expense", otherExpense.id);
    return true;
  }
  const categorize = categorizers.statement ?? categorizeStatementTransactions;
  const expenses = pending.filter((r) => r.type === "expense");
  const incomes = pending.filter((r) => r.type === "income");
  if (expenses.length) apply(expenses, await categorize(toInput(expenses), visible("expense", otherExpense.name), "expense", otherExpense.name, labels), "expense", otherExpense.id);
  if (incomes.length) apply(incomes, await categorize(toInput(incomes), visible("income", otherIncome.name), "income", otherIncome.name, labels), "income", otherIncome.id);
  return true;
}

// ---------------------------------------------------------------------------
// Bank statement
// ---------------------------------------------------------------------------

async function analyzeBank(userId: string, analysis: ImportAnalysis, files: ReturnType<typeof decodeImportFiles>, accountId: string | null | undefined, db: DbClient) {
  const parsed = parseBankFiles(files);
  const { account, match } = await suggestAccount(userId, { accountId, card: false, externalAccountId: parsed.externalAccountId, bank: parsed.bank }, db);
  const entity: Entity | null = account ? await db.entity.findUnique({ where: { id: account.entityId } }) : null;
  Object.assign(analysis, {
    bank: parsed.bank,
    currency: parsed.currency,
    period: parsed.period,
    externalAccountId: parsed.externalAccountId,
    suggestedAccountId: account?.id ?? null,
    accountMatch: match,
    entityId: entity?.id ?? null,
    ledgerBalance: parsed.ledgerBalance,
  });

  const normalized = normalizeTransactions(parsed.transactions);
  const context = await fetchReconciliationContext(userId, db);
  const reconciled = detectReconciliation(normalized, context.existingTransactions, context.knownTransferFitIds);
  const classified = classifyTransactions(
    reconciled.filter((t) => t.status === "new"),
    context.entities.filter((e) => e.id !== entity?.id),
    context.investmentAccounts,
    { bankName: parsed.bank ?? "", ...(entity && { importedEntityType: entity.kind }) }
  );
  const byFitId = new Map(classified.map((c) => [c.fitId, c]));

  // Who the duplicates repeat: entries (with their category) and transfers, by id or FITID.
  const existingIds = reconciled.map((t) => t.existingTransactionId).filter((id): id is string => !!id);
  const existing = existingIds.length
    ? await db.ledgerEntry.findMany({ where: { id: { in: existingIds } }, select: { id: true, description: true, date: true, categoryId: true } })
    : [];
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const transferFitIds = reconciled.filter((t) => context.knownTransferFitIds.has(t.fitId)).map((t) => t.fitId);
  const transfers = transferFitIds.length
    ? await db.transferGroup.findMany({ where: { userId, externalId: { in: transferFitIds }, deletedAt: null }, select: { id: true, externalId: true, description: true, date: true } })
    : [];
  const transferByFitId = new Map(transfers.map((t) => [t.externalId, t]));

  const matcher = await loadRuleMatcher(userId, db);
  const cards = account
    ? await db.account.findMany({ where: { userId, type: "credit_card", archivedAt: null }, orderBy: { createdAt: "asc" } })
    : [];

  const cardFor = (): Account | null => {
    const paidFromHere = cards.filter((c) => c.payFromAccountId === account?.id);
    if (paidFromHere.length === 1) return paidFromHere[0];
    const sameEntity = cards.filter((c) => c.entityId === account?.entityId);
    if (sameEntity.length === 1) return sameEntity[0];
    return byBankName(paidFromHere.length ? paidFromHere : sameEntity, parsed.bank);
  };

  analysis.rows = reconciled.map((t): AnalyzedImportRow => {
    const row: AnalyzedImportRow = {
      id: t.fitId,
      externalId: t.fitId,
      date: formatDateOnly(t.date),
      description: t.description,
      fullDescription: t.fullDescription,
      amount: t.type === "income" ? t.amount : -t.amount,
      type: t.type,
      kind: "entry",
      status: "need",
      duplicateOf: null,
      reconciliation: t.status,
      suggestedCategoryId: null,
      source: null,
      ruleId: null,
      rulePattern: null,
    };
    if (t.status !== "new") {
      row.status = "dup";
      if (t.diffs) row.diffs = t.diffs;
      const prior = t.existingTransactionId ? existingById.get(t.existingTransactionId) : undefined;
      const transfer = transferByFitId.get(t.fitId);
      if (prior) {
        row.duplicateOf = { id: prior.id, description: prior.description, date: formatDateOnly(prior.date) };
        row.suggestedCategoryId = prior.categoryId;
        row.source = prior.categoryId ? "existing" : null;
      } else if (t.fuzzyMatchedTransaction) {
        row.duplicateOf = { id: t.fuzzyMatchedTransaction.id, description: t.fuzzyMatchedTransaction.description, date: t.fuzzyMatchedTransaction.date };
      } else if (transfer) {
        row.duplicateOf = { id: transfer.id, description: transfer.description ?? t.description, date: formatDateOnly(transfer.date) };
      }
      return row;
    }

    const c = byFitId.get(t.fitId);
    if (c?.needsResolution) {
      row.candidates = c.candidates;
      return row;
    }
    const candidate = c?.candidates.find((x) => x.type === c.resolvedClassification);
    if (c?.resolvedClassification === "credit_card_payment" && t.type === "expense") {
      const card = cardFor();
      row.kind = "card_payment";
      row.cardPayment = { cardAccountId: card?.id ?? null, statementMonth: card ? paymentStatementMonth(card, t.date) : null };
      if (card) Object.assign(row, { status: "rule", source: "classification" });
      return row;
    }
    if (c?.resolvedClassification === "investment_transfer" && candidate?.investmentDetails) {
      const accountId = candidate.investmentDetails.suggestedAccountId ?? null;
      row.kind = "investment_transfer";
      row.investment = { direction: candidate.investmentDetails.direction, accountId };
      if (accountId) Object.assign(row, { status: "rule", source: "classification" });
      return row;
    }
    if (c?.resolvedClassification === "entity_transfer" && candidate?.transferDetails) {
      Object.assign(row, { kind: "transfer", transfer: candidate.transferDetails, status: "rule", source: "classification" });
      return row;
    }
    const rule = matcher.match(t.description, entity?.id);
    if (rule) Object.assign(row, { status: "rule", suggestedCategoryId: rule.categoryId, source: "rule", ruleId: rule.id, rulePattern: rule.pattern });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Card bill
// ---------------------------------------------------------------------------

async function analyzeCard(userId: string, analysis: ImportAnalysis, files: ReturnType<typeof decodeImportFiles>, accountId: string | null | undefined, db: DbClient) {
  const parsed = parseCardFiles(files);
  const { account, match } = await suggestAccount(userId, { accountId, card: true, externalAccountId: parsed.externalAccountId, bank: parsed.bank }, db);
  Object.assign(analysis, {
    bank: parsed.bank,
    currency: parsed.currency ?? account?.currency ?? null,
    period: parsed.period,
    externalAccountId: parsed.externalAccountId,
    suggestedAccountId: account?.id ?? null,
    accountMatch: match,
    entityId: account?.entityId ?? null,
    payments: parsed.payments,
  });

  const baseRow = (r: ParsedCardRow, i: number): AnalyzedImportRow => ({
    id: `c${i}`,
    externalId: null,
    date: r.date,
    description: r.description,
    amount: round(-r.amount, 2),
    type: r.amount > 0 ? "expense" : "income",
    kind: "entry",
    status: "need",
    duplicateOf: null,
    suggestedCategoryId: null,
    source: null,
    ruleId: null,
    rulePattern: null,
    ...(r.installment && { installment: r.installment }),
  });
  if (!account) {
    analysis.rows = parsed.rows.map(baseRow);
    return;
  }

  // Statement the rows go to: the one the latest purchase (installments carry their original date) belongs to.
  const closingDay = account.closingDay ?? 1;
  const latest = parsed.rows.filter((r) => !r.installment).map((r) => r.date).sort().pop() ?? parsed.rows.map((r) => r.date).sort().pop()!;
  const month = statementMonthFor(parseLocalDate(latest), closingDay);
  const statement = await db.cardStatement.findUnique({ where: { accountId_month: { accountId: account.id, month } } });
  const closingDate = statement?.closingDate ?? closingDateFor(month, closingDay);
  const dueDate = statement?.dueDate ?? (account.dueDay ? dueDateFor(month, closingDay, account.dueDay) : null);
  const total = round(calculateBillTotal(parsed.parsed, closingDate), 2);
  const payment = await findStatementPaymentEntry(userId, account, { dueDate, paymentGroupId: statement?.paymentGroupId ?? null }, total, db);

  const onCard = await db.ledgerEntry.findMany({
    where: { userId, accountId: account.id, deletedAt: null, transferGroupId: null },
    select: { id: true, date: true, amount: true, description: true, installmentNumber: true, metadata: true, cardStatementId: true, importId: true, categoryId: true },
  });
  const live = onCard.filter((e) => !isProjected(e.metadata));
  const onStatement = statement ? live.filter((e) => e.cardStatementId === statement.id) : [];
  analysis.card = {
    accountId: account.id,
    month,
    closingDate: formatDateOnly(closingDate),
    dueDate: dueDate ? formatDateOnly(dueDate) : null,
    statementId: statement?.id ?? null,
    total,
    existingCount: onStatement.length,
    paid: !!statement?.paymentGroupId,
    payFromAccountId: account.payFromAccountId,
    payment: payment ? { entryId: payment.id, description: payment.description, date: formatDateOnly(payment.date), amount: Number(payment.amount) } : null,
  };

  // Same multiset identity as importCardStatement: each existing row absorbs one identical file row.
  const byKey = new Map<string, typeof live>();
  for (const e of onStatement) {
    const k = dedupeKey(e.date, -Number(e.amount), e.description, e.installmentNumber);
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const used = new Set<string>();
  const typedByHand = live.filter((e) => !e.importId);
  const projected = onCard.filter((e) => isProjected(e.metadata));

  const matcher = await loadRuleMatcher(userId, db);

  analysis.rows = parsed.rows.map((r, i) => {
    const row = baseRow(r, i);
    const date = parseLocalDate(r.date);
    const exact = byKey.get(dedupeKey(date, r.amount, r.description, r.installment?.number))?.find((e) => !used.has(e.id));
    const fuzzy =
      exact ??
      typedByHand.find(
        (e) => !used.has(e.id) && Math.abs(-Number(e.amount) - r.amount) < 0.005 && Math.abs(e.date.getTime() - date.getTime()) <= FUZZY_DAYS_MS
      );
    if (fuzzy) {
      used.add(fuzzy.id);
      Object.assign(row, {
        status: "dup",
        duplicateOf: { id: fuzzy.id, description: fuzzy.description, date: formatDateOnly(fuzzy.date) },
        suggestedCategoryId: fuzzy.categoryId,
        source: fuzzy.categoryId ? "existing" : null,
      });
      return row;
    }
    if (r.installment) {
      const base = normalize(r.description);
      row.replacesProjected = projected.some(
        (e) =>
          e.installmentNumber === r.installment!.number &&
          Math.abs(-Number(e.amount) - r.amount) < 0.011 &&
          normalize(e.description.replace(/\s*\(\d{1,2}\/\d{1,2}\)\s*$/, "")) === base
      );
    }
    const rule = matcher.match(r.description, account.entityId);
    if (rule) Object.assign(row, { status: "rule", suggestedCategoryId: rule.categoryId, source: "rule", ruleId: rule.id, rulePattern: rule.pattern });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function analyzeImport(userId: string, input: AnalyzeImportInput, db: DbClient, opts: AnalyzeImportOptions = {}): Promise<ImportAnalysis> {
  const decoded = decodeImportFiles(input.files);
  const files = decoded.map((f) => ({ name: f.name, size: f.size, kind: f.kind }));
  const assistantFile = decoded.find((f) => f.kind === "pdf" || f.kind === "image");
  if (assistantFile) return { ...emptyAnalysis(assistantFile.kind, files), viaAssistant: true };

  const kinds = new Set(decoded.map((f) => (f.kind === "bank_ofx" ? "bank" : "card")));
  if (kinds.size > 1) throw new LedgerError("Bank statements and card bills cannot be imported together", 422, { code: "import.mixed_files" });

  const analysis = emptyAnalysis(decoded[0].kind, files);
  if (kinds.has("bank")) await analyzeBank(userId, analysis, decoded, input.accountId, db);
  else await analyzeCard(userId, analysis, decoded, input.accountId, db);
  analysis.count = analysis.rows.length;

  const available = !!opts.categorizers || !!process.env.ANTHROPIC_API_KEY;
  analysis.ai = { requested: !!input.ai, available, used: false };
  if (input.ai && available) analysis.ai.used = await aiPass(userId, analysis.rows, analysis.kind === "bank_ofx" ? "statement" : "bill", db, opts.categorizers ?? {});
  analysis.summary = summarize(analysis.rows);
  return analysis;
}
