import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { matchCategoryName } from "@capital/server/modules/mcp/lib/category-validation";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { loadRuleMatcher, recordRuleHits } from "@capital/server/modules/ledger/services/rules";
import { closingDateFor, ensureStatement, statementEffectiveDate } from "@capital/server/modules/ledger/services/statements";
import type { Account } from "@/generated/prisma";
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
}

export interface CardImportOptions {
  /** Mutation records are appended here instead of a new undo batch when given. */
  collect?: MutationRecordInput[];
}

const normalize = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
const baseDescription = (s: string) => normalize(s.replace(/\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, ""));
const dedupeKey = (date: Date, amount: number, description: string, n?: number | null) =>
  `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}|${normalize(description)}${n ? `|${n}` : ""}`;

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

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** ensureStatement, recording whether it created the month's statement or changed it. */
async function ensureRecordedStatement(
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

    const resolve = (row: StatementRowInput): { categoryId: string | null; auto: boolean } => {
      if (row.categoryId) {
        const c = categories.find((x) => x.id === row.categoryId);
        if (!c) throw new LedgerError(`Category ${row.categoryId} not found or access denied`, 404, { code: "category.not_found" });
        if (c.isArchived) {
          throw new LedgerError(`Category '${c.name}' is archived and cannot be assigned. Unarchive it or choose a visible category.`, 422, { code: "category.archived", params: { name: c.name } });
        }
        return { categoryId: c.id, auto: false };
      }
      if (row.category) {
        const matched = matchCategoryName(row.category, expense, "expense");
        if (matched.archived) {
          const name = matched.canonicalName ?? row.category;
          throw new LedgerError(`Category '${name}' is archived and cannot be assigned. Unarchive it or choose a visible category.`, 422, { code: "category.archived", params: { name } });
        }
        if (matched.canonicalName) return { categoryId: expense.find((c) => c.name === matched.canonicalName)!.id, auto: false };
      }
      const rule = matcher.match(row.description, account.entityId);
      if (rule) {
        ruleHits.push(rule.id);
        return { categoryId: rule.categoryId, auto: true };
      }
      return { categoryId: fallbackId, auto: false };
    };

    const existing = await tx.ledgerEntry.findMany({
      where: { cardStatementId: statement.id, deletedAt: null },
      select: { date: true, amount: true, description: true, installmentNumber: true, metadata: true },
    });
    const counts = new Map<string, number>();
    for (const e of existing) {
      if (isProjected(e.metadata)) continue;
      const k = dedupeKey(e.date, -Number(e.amount), e.description, e.installmentNumber);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }

    const createdIds: string[] = [];
    let skipped = 0;
    for (const row of input.rows) {
      const date = parseLocalDate(row.date);
      const key = dedupeKey(date, row.amount, row.description, row.installment?.number);
      const seen = counts.get(key) ?? 0;
      if (seen > 0) {
        counts.set(key, seen - 1);
        skipped++;
        continue;
      }
      const currency = row.currency ?? account.currency;
      const rate = fx.rateFor(currency);
      const amount = round(-row.amount, 4);
      const { categoryId, auto } = resolve(row);

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
          cardStatementId: statement.id,
          installmentPlanId: planId,
          installmentNumber: row.installment?.number ?? null,
          importId: input.importId ?? null,
          ...(row.installment && { metadata: { totalInstallments: row.installment.total } }),
        },
      });
      createdIds.push(entry.id);
      records.push({ model: "LedgerEntry", recordId: entry.id, before: null, after: snapshot(entry) });
    }
    if (ruleHits.length) await recordRuleHits(ruleHits, tx);
    const batchId =
      opts.collect || !records.length ? null : await recordMutation(tx, userId, "import", `${account.name} ${input.month}`, records, { source: "import" });
    return { statementId: statement.id, created: createdIds.length, skipped, createdIds, batchId };
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
    }));
  const result = await importCardStatement(
    userId,
    { accountId: input.accountId, month, closingDate: input.closingDate, dueDate: input.dueDate, total: round(calculateBillTotal(parsed, closing), 2), rows, importId: input.importId, fallback: "none" },
    db,
    opts
  );
  return { ...result, month, transactionCount: rows.length };
}
