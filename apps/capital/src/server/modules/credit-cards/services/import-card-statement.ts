import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { matchCategoryName } from "@capital/server/modules/mcp/lib/category-validation";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { kindSign } from "@capital/server/modules/ledger/lib/money";
import { softDeleteEntries, updateEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { loadRuleMatcher, recordRuleHits } from "@capital/server/modules/ledger/services/rules";
import { closingDateFor, ensureStatement, statementEffectiveDate } from "@capital/server/modules/ledger/services/statements";
import type { Account } from "@/generated/prisma";
import { baseExternalId, reconcileStatement, statementRowKey, type StatementLedgerRow } from "@/lib/import/statement-match";
import { bookableExternalId } from "@capital/server/modules/bank-statements/services/external-ids";
import { parseCsvContent, parseDate, computeCycleStart, type ParsedTransaction } from "./parsers";
import { parseOfxCreditCardContent } from "@capital/server/modules/bank-statements/services/parsers";

export interface StatementRowInput {
  date: string;
  description: string;
  /** Charge > 0, refund/credit < 0 (statement convention). */
  amount: number;
  currency?: string;
  categoryId?: string;
  category?: string;
  merchantName?: string | null;
  installment?: { number: number; total: number };
  /** Book the row even when an identical one is already on the statement (the user chose "import anyway"). */
  allowDuplicate?: boolean;
  /** FITID of a card OFX line: stored on the entry, so the next import of the bill finds it. */
  externalId?: string | null;
}

/**
 * A row of the statement the bill changed ("Mudou"): the entry keeps its
 * id and category and takes the file's values. `amount` is unsigned: the
 * entry stays a charge or a refund.
 */
export interface StatementRowUpdate {
  entryId: string;
  date?: string;
  description?: string;
  amount?: number;
  /** The line's FITID, stored on the entry when it has none (or another). */
  externalId?: string | null;
}

export interface ImportCardStatementInput {
  accountId: string;
  month: string;
  closingDate?: string | null;
  dueDate?: string | null;
  total?: number | null;
  rows: StatementRowInput[];
  importId?: string | null;
  /** Category for rows nothing else categorizes: "other" (system Other) or "none" (left for the AI cron). */
  fallback?: "other" | "none";
  /** Entries of the statement (or the ones next to it) the bill changed: updated in place and moved onto this statement. */
  updates?: StatementRowUpdate[];
  /** Entries of this statement the bill no longer has ("Saiu da fatura"): moved to the trash. */
  removeEntryIds?: string[];
  /**
   * Entries the import analysis already paired with rows of the file
   * (kept as they are, updated, or imported anyway). The safety net leaves
   * them out, so a row the review left unchecked does not swallow a new
   * one like it. Without it, every live row of the statement counts.
   */
  matchedEntryIds?: string[];
}

export interface CardImportOptions {
  /** Mutation records are appended here instead of a new undo batch when given. */
  collect?: MutationRecordInput[];
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
const baseDescription = (s: string) => normalize(s.replace(/\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, ""));
/**
 * Identity of a statement row (charge > 0): two rows with the same key are
 * the same purchase (statementRowKey, the second pass of the statement
 * reconciliation).
 */
export const dedupeKey = (date: Date, amount: number, description: string, n?: number | null) =>
  statementRowKey(date.toISOString().slice(0, 10), amount, description, n);

export const isProjected = (metadata: unknown) =>
  typeof metadata === "object" && metadata !== null && (metadata as { projected?: unknown }).projected === true;

/**
 * Filter that leaves projected installments out. A JSON-path NOT would also
 * drop every row whose metadata lacks the key (SQL NULL), so the projected
 * rows are excluded by id instead.
 */
export async function excludeProjected(userId: string, db: DbClient) {
  const projected = await db.ledgerEntry.findMany({ where: { userId, metadata: { path: ["projected"], equals: true } }, select: { id: true } });
  return projected.length ? { id: { notIn: projected.map((p) => p.id) } } : {};
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** A ledger row as the statement reconciliation sees it, with what the review shows of it. */
export interface StatementLedgerEntry extends StatementLedgerRow {
  categoryId: string | null;
  cardStatementId: string | null;
}

/**
 * The rows a bill of `month` is reconciled against: the live, booked (not
 * projected) purchases and refunds of that statement and of the ones a
 * month before and after, plus any row of the card holding one of the
 * file's external ids. Amounts in the statement convention (charge > 0).
 */
export async function statementLedgerRows(account: Pick<Account, "id" | "currency">, month: string, externalIds: readonly string[], db: DbClient): Promise<StatementLedgerEntry[]> {
  const statements = await db.cardStatement.findMany({
    where: { accountId: account.id, month: { in: [shiftMonth(month, -1), month, shiftMonth(month, 1)] } },
    select: { id: true, month: true },
  });
  const scopeOf = new Map(statements.map((s) => [s.id, s.month === month ? ("target" as const) : ("neighbor" as const)]));
  const ids = [...new Set(externalIds.map(baseExternalId))];
  const where = [
    ...(scopeOf.size ? [{ cardStatementId: { in: [...scopeOf.keys()] } }] : []),
    ...(ids.length ? [{ externalId: { in: ids } }] : []),
  ];
  if (!where.length) return [];
  const entries = await db.ledgerEntry.findMany({
    where: { accountId: account.id, deletedAt: null, transferGroupId: null, OR: where },
    select: { id: true, date: true, amount: true, description: true, installmentNumber: true, externalId: true, metadata: true, importId: true, currency: true, categoryId: true, cardStatementId: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return entries
    .filter((e) => !isProjected(e.metadata))
    .map((e) => ({
      id: e.id,
      date: formatDateOnly(e.date),
      description: e.description,
      amount: round(-Number(e.amount), 2),
      installmentNumber: e.installmentNumber,
      externalId: e.externalId,
      scope: (e.cardStatementId && scopeOf.get(e.cardStatementId)) || "elsewhere",
      manual: !e.importId,
      foreign: e.currency !== account.currency,
      categoryId: e.categoryId,
      cardStatementId: e.cardStatementId,
    }));
}

/** ensureStatement, recording whether it created the month's statement or changed it. */
export async function ensureRecordedStatement(
  account: Account,
  month: string,
  tx: DbClient,
  overrides: Parameters<typeof ensureStatement>[3],
  records: MutationRecordInput[]
) {
  const before = await tx.cardStatement.findUnique({ where: { accountId_month: { accountId: account.id, month } } });
  const statement = await ensureStatement(account, month, tx, overrides);
  const after = snapshot(statement);
  if (!before) records.push({ model: "CardStatement", recordId: statement.id, before: null, after });
  else if (JSON.stringify(snapshot(before)) !== JSON.stringify(after)) records.push({ model: "CardStatement", recordId: statement.id, before: snapshot(before), after });
  return statement;
}

/**
 * Imports one card statement. Rows are a multiset: identical rows already
 * on the statement are not inserted again, so re-importing a file is a
 * no-op. Installment rows join (or start) an InstallmentPlan; the remaining
 * installments are booked on later statements as committed entries
 * (metadata.projected) and get replaced by the real row when that
 * statement is imported. Everything it writes is one undo batch (source
 * "import"), unless the caller collects the records into its own.
 */
export async function importCardStatement(userId: string, input: ImportCardStatementInput, db: DbClient, opts: CardImportOptions = {}) {
  return inTransaction(db, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.accountId}), hashtext(${input.month}))::text`;
    const account = await tx.account.findFirst({ where: { id: input.accountId, userId } });
    if (!account) throw new LedgerError("Credit card not found or access denied", 404, { code: "account.not_found" });
    if (account.type !== "credit_card") throw new LedgerError("Account is not a credit card", 422, { code: "account.not_credit_card" });
    const records: MutationRecordInput[] = opts.collect ?? [];

    const statement = await ensureRecordedStatement(account, input.month, tx, {
      ...(input.closingDate && { closingDate: parseLocalDate(input.closingDate) }),
      ...(input.dueDate && { dueDate: parseLocalDate(input.dueDate) }),
      ...(input.total != null && { totalAmount: input.total }),
    }, records);
    const effectiveDate = statementEffectiveDate(statement);
    const fx = await loadFx(userId, tx);
    const matcher = await loadRuleMatcher(userId, tx);
    const categories = await tx.category.findMany({ where: { userId }, select: { id: true, name: true, type: true, isArchived: true } });
    const expense = categories.filter((c) => c.type === "expense");
    const fallbackId = input.fallback === "none" ? null : (await getSystemCategory(userId, "other_system", tx)).id;
    const ruleHits: string[] = [];

    /**
     * Category of a row: the one the caller chose (by id or name), else the
     * first matching rule, else the fallback. A chosen category equal to the
     * rule's (the review prefilled it) still counts as the rule's doing.
     */
    const resolve = (row: StatementRowInput): { categoryId: string | null; auto: boolean; ruleId: string | null } => {
      const rule = matcher.match(row.description, account.entityId);
      const chosen = (categoryId: string) => {
        if (rule && rule.categoryId === categoryId) {
          ruleHits.push(rule.id);
          return { categoryId, auto: true, ruleId: rule.id };
        }
        return { categoryId, auto: false, ruleId: null };
      };
      if (row.categoryId) {
        const c = categories.find((x) => x.id === row.categoryId);
        if (!c) throw new LedgerError(`Category ${row.categoryId} not found or access denied`, 404, { code: "category.not_found" });
        if (c.isArchived) {
          throw new LedgerError(`Category '${c.name}' is archived and cannot be assigned. Unarchive it or choose a visible category.`, 422, { code: "category.archived", params: { name: c.name } });
        }
        return chosen(c.id);
      }
      if (row.category) {
        const matched = matchCategoryName(row.category, expense, "expense");
        if (matched.archived) {
          const name = matched.canonicalName ?? row.category;
          throw new LedgerError(`Category '${name}' is archived and cannot be assigned. Unarchive it or choose a visible category.`, 422, { code: "category.archived", params: { name } });
        }
        if (matched.canonicalName) return chosen(expense.find((c) => c.name === matched.canonicalName)!.id);
      }
      if (rule) {
        ruleHits.push(rule.id);
        return { categoryId: rule.categoryId, auto: true, ruleId: rule.id };
      }
      return { categoryId: fallbackId, auto: false, ruleId: null };
    };

    // The bill's changes to rows already booked: same id and category, the file's values, on this statement.
    let updated = 0;
    const claimed = new Set<string>(input.matchedEntryIds ?? []);
    for (const update of input.updates ?? []) {
      const entry = await tx.ledgerEntry.findFirst({ where: { id: update.entryId, userId, accountId: account.id, deletedAt: null, transferGroupId: null } });
      if (!entry) throw new LedgerError(`Transaction ${update.entryId} not found`, 404, { code: "entry.not_found" });
      claimed.add(entry.id);
      // Statement convention of the entry (charge > 0) keeps its direction; updateEntry takes the magnitude its kind shows.
      const charge = -Number(entry.amount) >= 0;
      const statementAmount = update.amount === undefined ? undefined : (charge ? 1 : -1) * Math.abs(update.amount);
      const patch = {
        ...(statementAmount !== undefined && { amount: -statementAmount * kindSign(entry.kind) }),
        ...(update.date && { date: update.date }),
        ...(update.description && { description: update.description }),
      };
      if (Object.keys(patch).length) await updateEntry(userId, entry.id, patch, tx, { collect: records, checkCategoryType: false });
      const current = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
      const linkId =
        update.externalId && baseExternalId(current.externalId ?? "") !== baseExternalId(update.externalId) ? await bookableExternalId(account.id, update.externalId, tx) : null;
      const data = {
        ...(current.cardStatementId !== statement.id && { cardStatementId: statement.id, effectiveDate }),
        ...(linkId && { externalId: linkId }),
      };
      if (Object.keys(data).length) {
        const moved = await tx.ledgerEntry.update({ where: { id: entry.id }, data });
        records.push({ model: "LedgerEntry", recordId: entry.id, before: snapshot(current), after: snapshot(moved) });
      }
      updated++;
    }

    // Rows that left the bill: to the trash (only rows of this statement, still there).
    let removed = 0;
    if (input.removeEntryIds?.length) {
      const gone = await tx.ledgerEntry.findMany({
        where: { id: { in: input.removeEntryIds }, userId, accountId: account.id, cardStatementId: statement.id, deletedAt: null, transferGroupId: null },
        select: { id: true, metadata: true },
      });
      const ids = gone.filter((e) => !isProjected(e.metadata)).map((e) => e.id);
      if (ids.length) removed = (await softDeleteEntries(userId, ids, tx, { collect: records })).deleted;
    }

    // Safety net (the plan may be minutes old): rows the statement already has, by the same reconciliation as the analysis.
    const ledger = (await statementLedgerRows(account, input.month, input.rows.flatMap((r) => (r.externalId ? [r.externalId] : [])), tx)).filter((e) => !claimed.has(e.id));
    const { matches } = reconcileStatement(
      input.rows.map((row, i) => ({ key: String(i), date: formatDateOnly(parseLocalDate(row.date)), description: row.description, amount: row.amount, installmentNumber: row.installment?.number ?? null, externalId: row.externalId ?? null })),
      ledger,
      { coversCycle: false }
    );

    const createdIds: string[] = [];
    let skipped = 0;
    for (const [i, row] of input.rows.entries()) {
      const date = parseLocalDate(row.date);
      // A row imported anyway still pairs with the booked row it repeats, so an identical new row after it is not taken for that one.
      if (matches.get(String(i))?.status !== "new" && !row.allowDuplicate) {
        skipped++;
        continue;
      }
      const currency = row.currency ?? account.currency;
      const rate = fx.rateFor(currency);
      const amount = round(-row.amount, 4);
      const { categoryId, auto, ruleId } = resolve(row);

      let planId: string | null = null;
      if (row.installment && row.installment.total > 1) {
        const desc = baseDescription(row.description);
        const plans = await tx.installmentPlan.findMany({ where: { accountId: account.id, totalInstallments: row.installment.total, isActive: true } });
        let plan = plans.find((p) => baseDescription(p.description) === desc && Math.abs(Number(p.installmentAmount) - Math.abs(row.amount)) < 0.011);
        if (!plan) {
          plan = await tx.installmentPlan.create({
            data: {
              userId,
              accountId: account.id,
              description: row.description.replace(/\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, "").trim() || row.description,
              totalAmount: round(Math.abs(row.amount) * row.installment.total, 2),
              totalInstallments: row.installment.total,
              installmentAmount: Math.abs(row.amount),
              startDate: date,
            },
          });
          records.push({ model: "InstallmentPlan", recordId: plan.id, before: null, after: snapshot(plan) });
        }
        planId = plan.id;
        // A committed (projected) entry for this installment is replaced by the real row (undo brings it back).
        const replaced = await tx.ledgerEntry.findMany({
          where: { installmentPlanId: plan.id, installmentNumber: row.installment.number, metadata: { path: ["projected"], equals: true } },
        });
        if (replaced.length) await tx.ledgerEntry.deleteMany({ where: { id: { in: replaced.map((e) => e.id) } } });
        for (const e of replaced) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: null });
        for (let n = row.installment.number + 1; n <= row.installment.total; n++) {
          const exists = await tx.ledgerEntry.count({ where: { installmentPlanId: plan.id, installmentNumber: n, deletedAt: null } });
          if (exists) continue;
          const futureMonth = shiftMonth(input.month, n - row.installment.number);
          const future = await ensureRecordedStatement(account, futureMonth, tx, { closingDate: closingDateFor(futureMonth, account.closingDay ?? 1) }, records);
          const projected = await tx.ledgerEntry.create({
            data: {
              userId,
              entityId: account.entityId,
              accountId: account.id,
              kind: "expense",
              amount,
              currency,
              exchangeRate: rate,
              amountBase: round(amount * rate, 4),
              date,
              effectiveDate: statementEffectiveDate(future),
              description: `${plan.description} (${n}/${row.installment.total})`,
              categoryId,
              isAutoCategorized: auto,
              categorizedByRuleId: ruleId,
              cardStatementId: future.id,
              installmentPlanId: plan.id,
              installmentNumber: n,
              importId: input.importId ?? null,
              metadata: { projected: true, totalInstallments: row.installment.total },
            },
          });
          records.push({ model: "LedgerEntry", recordId: projected.id, before: null, after: snapshot(projected) });
        }
      }

      const entry = await tx.ledgerEntry.create({
        data: {
          userId,
          entityId: account.entityId,
          accountId: account.id,
          kind: "expense",
          amount,
          currency,
          exchangeRate: rate,
          amountBase: round(amount * rate, 4),
          date,
          effectiveDate,
          description: row.description,
          merchantName: row.merchantName ?? null,
          categoryId,
          isAutoCategorized: auto,
          categorizedByRuleId: ruleId,
          cardStatementId: statement.id,
          installmentPlanId: planId,
          installmentNumber: row.installment?.number ?? null,
          importId: input.importId ?? null,
          externalId: row.externalId ? await bookableExternalId(account.id, row.externalId, tx) : null,
          ...(row.installment && { metadata: { totalInstallments: row.installment.total } }),
        },
      });
      createdIds.push(entry.id);
      records.push({ model: "LedgerEntry", recordId: entry.id, before: null, after: snapshot(entry) });
    }
    if (ruleHits.length) await recordRuleHits(ruleHits, tx);
    const batchId =
      opts.collect || !records.length ? null : await recordMutation(tx, userId, "import", `${account.name} ${input.month}`, records, { source: "import" });
    return { statementId: statement.id, created: createdIds.length, skipped, updated, removed, createdIds, batchId };
  });
}

/** Bill total from a parsed file, excluding previous-cycle refunds (kept from the legacy bill flow). */
export function calculateBillTotal(parsed: ParsedTransaction[], closingDate: Date): number {
  const charges = parsed.filter((t) => !t.isPayment);
  const payments = parsed.filter((t) => t.isPayment);
  let cutoff: Date;
  try {
    cutoff = payments.length ? new Date(Math.max(...payments.map((t) => parseDate(t.date).getTime()))) : computeCycleStart(closingDate);
  } catch {
    cutoff = computeCycleStart(closingDate);
  }
  const iof = (d: string) => /ajuste a crédito|iof de volta/i.test(d);
  return charges.reduce((sum, t) => {
    if (t.amount >= 0 || iof(t.description)) return sum + t.amount;
    try {
      return parseDate(t.date) >= cutoff ? sum + t.amount : sum;
    } catch {
      return sum + t.amount;
    }
  }, 0);
}

/** The parsers' own message (English, for MCP and the assistant) under the import.invalid_file code. */
function invalidBillFile(err: unknown) {
  return new LedgerError(err instanceof Error ? err.message : "Invalid bill file", 400, { code: "import.invalid_file" });
}

/** Parse a card bill file (CSV or card OFX) into statement rows. */
export function parseCardFile(content: string): ParsedTransaction[] {
  let parsed: ParsedTransaction[];
  try {
    parsed = /<CCSTMTRS>/i.test(content.slice(0, 4096)) ? parseOfxCreditCardContent(content).transactions : parseCsvContent(content);
  } catch (err) {
    throw invalidBillFile(err);
  }
  if (!parsed.length) throw new LedgerError("No valid transactions found in the bill file", 422, { code: "import.no_transactions" });
  return parsed;
}

function billRowDate(date: string): string {
  try {
    return parseDate(date).toISOString().slice(0, 10);
  } catch (err) {
    throw invalidBillFile(err);
  }
}

/** Import a bill file for a statement closing on `closingDate` (manual upload and import plans). */
export async function importCardFile(
  userId: string,
  input: { accountId: string; closingDate: string; dueDate: string; content: string; importId?: string | null },
  db: DbClient,
  opts: CardImportOptions = {}
) {
  const parsed = parseCardFile(input.content);
  const closing = parseLocalDate(input.closingDate);
  const month = `${closing.getUTCFullYear()}-${String(closing.getUTCMonth() + 1).padStart(2, "0")}`;
  const rows: StatementRowInput[] = parsed
    .filter((t) => !t.isPayment)
    .map((t) => ({
      date: billRowDate(t.date),
      description: t.description,
      amount: t.amount,
      installment: t.installmentNumber && t.totalInstallments ? { number: t.installmentNumber, total: t.totalInstallments } : undefined,
      externalId: t.externalId ?? null,
    }));
  const result = await importCardStatement(
    userId,
    { accountId: input.accountId, month, closingDate: input.closingDate, dueDate: input.dueDate, total: round(calculateBillTotal(parsed, closing), 2), rows, importId: input.importId, fallback: "none" },
    db,
    opts
  );
  return { ...result, month, transactionCount: rows.length };
}
