import { endOfDay, isAfter } from "date-fns";
import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { LedgerKind, RecurrenceFrequency, RecurringRule, TransferDirection } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate, toNoonUTC } from "@capital/server/lib/date-utils";
import { getNextOccurrence } from "@capital/server/lib/recurrence";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";

export interface RecurringRuleInput {
  kind: LedgerKind;
  accountId: string;
  /** Required for transfers. */
  toAccountId?: string | null;
  transferDirection?: TransferDirection | null;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  description: string;
  categoryId?: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  /** false = reminder mode: nothing is generated until marked as paid. */
  autoGenerate?: boolean;
  reminders?: RemindersConfig | null;
}

export function serializeRule(r: RecurringRule) {
  return {
    id: r.id,
    kind: r.kind,
    entityId: r.entityId,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    transferDirection: r.transferDirection,
    amount: toNumber(r.amount),
    currency: r.currency,
    exchangeRate: toNumber(r.exchangeRate),
    description: r.description,
    categoryId: r.categoryId,
    frequency: r.frequency,
    startDate: formatDateOnly(r.startDate),
    endDate: r.endDate ? formatDateOnly(r.endDate) : null,
    nextDueDate: formatDateOnly(r.nextDueDate),
    lastGeneratedDate: r.lastGeneratedDate ? formatDateOnly(r.lastGeneratedDate) : null,
    isActive: r.isActive,
    autoGenerate: r.autoGenerate,
    reminders: r.reminders,
  };
}

async function validate(userId: string, input: Partial<RecurringRuleInput>, db: DbClient, currentCategoryId: string | null = null) {
  if (input.amount !== undefined && !(input.amount > 0)) throw new LedgerError("Amount must be positive", 422);
  if (input.kind === "transfer" && !input.toAccountId) throw new LedgerError("Recurring transfers need toAccountId", 422);
  if (input.toAccountId) await getOwnedAccount(userId, input.toAccountId, db);
  if (input.categoryId) {
    const c = await db.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!c) throw notFound("Category");
    if (c.isArchived && c.id !== currentCategoryId) throw new LedgerError(`Category "${c.name}" is archived and cannot be assigned`, 422);
  }
  if (input.reminders) remindersConfigSchema.parse(input.reminders);
}

export async function createRecurringRule(userId: string, input: RecurringRuleInput, db: DbClient) {
  await validate(userId, input, db);
  const account = await getOwnedAccount(userId, input.accountId, db);
  const startDate = parseLocalDate(input.startDate);
  return db.recurringRule.create({
    data: {
      userId,
      entityId: account.entityId,
      accountId: account.id,
      kind: input.kind,
      amount: input.amount,
      currency: input.currency ?? account.currency,
      exchangeRate: input.exchangeRate ?? 1,
      description: input.description,
      categoryId: input.categoryId ?? null,
      transferDirection: input.toAccountId ? input.transferDirection ?? null : null,
      toAccountId: input.toAccountId ?? null,
      frequency: input.frequency,
      startDate,
      endDate: input.endDate ? parseLocalDate(input.endDate) : null,
      nextDueDate: startDate,
      autoGenerate: input.autoGenerate ?? true,
      reminders: input.reminders ? (input.reminders as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

export async function updateRecurringRule(userId: string, ruleId: string, patch: Partial<RecurringRuleInput> & { isActive?: boolean; nextDueDate?: string }, db: DbClient) {
  const rule = await db.recurringRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw notFound("Recurring rule");
  await validate(userId, { ...patch, kind: patch.kind ?? rule.kind, toAccountId: patch.toAccountId ?? rule.toAccountId }, db, rule.categoryId);
  const account = patch.accountId ? await getOwnedAccount(userId, patch.accountId, db) : null;
  return db.recurringRule.update({
    where: { id: ruleId },
    data: {
      ...(account && { accountId: account.id, entityId: account.entityId }),
      ...(patch.kind !== undefined && { kind: patch.kind }),
      ...(patch.toAccountId !== undefined && { toAccountId: patch.toAccountId }),
      ...(patch.transferDirection !== undefined && { transferDirection: patch.transferDirection }),
      ...(patch.amount !== undefined && { amount: patch.amount }),
      ...(patch.currency !== undefined && { currency: patch.currency }),
      ...(patch.exchangeRate !== undefined && { exchangeRate: patch.exchangeRate }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.categoryId !== undefined && { categoryId: patch.categoryId }),
      ...(patch.frequency !== undefined && { frequency: patch.frequency }),
      ...(patch.startDate !== undefined && { startDate: parseLocalDate(patch.startDate) }),
      ...(patch.endDate !== undefined && { endDate: patch.endDate ? parseLocalDate(patch.endDate) : null }),
      ...(patch.nextDueDate !== undefined && { nextDueDate: parseLocalDate(patch.nextDueDate) }),
      ...(patch.autoGenerate !== undefined && { autoGenerate: patch.autoGenerate }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      ...(patch.reminders !== undefined && { reminders: patch.reminders ? (patch.reminders as Prisma.InputJsonValue) : Prisma.DbNull }),
    },
  });
}

export async function deleteRecurringRule(userId: string, ruleId: string, db: DbClient) {
  const { count } = await db.recurringRule.deleteMany({ where: { id: ruleId, userId } });
  if (!count) throw notFound("Recurring rule");
}

export async function listRecurringRules(userId: string, db: DbClient, opts: { includeInactive?: boolean; entityId?: string } = {}) {
  return db.recurringRule.findMany({
    where: { userId, ...(opts.includeInactive ? {} : { isActive: true }), ...(opts.entityId && { entityId: opts.entityId }) },
    orderBy: { nextDueDate: "asc" },
  });
}

/**
 * Books one occurrence of a rule (an entry, or a transfer) on `date`. BILL
 * attachments on the template move to the first materialized occurrence.
 */
export async function materializeRule(rule: RecurringRule, date: Date, db: DbClient, override: { amount?: number } = {}) {
  const amount = override.amount ?? toNumber(rule.amount);
  const day = formatDateOnly(date);
  const result =
    rule.kind === "transfer" || (rule.toAccountId && rule.transferDirection)
      ? await createEntry(
          rule.userId,
          {
            kind: "transfer",
            fromAccountId: rule.accountId,
            toAccountId: rule.toAccountId!,
            amount,
            currency: rule.currency,
            exchangeRate: toNumber(rule.exchangeRate),
            direction: rule.transferDirection ?? undefined,
            description: rule.description,
            date: day,
          },
          db,
          { recurringRuleId: rule.id, record: false }
        )
      : await createEntry(
          rule.userId,
          {
            kind: rule.kind === "income" ? "income" : "expense",
            accountId: rule.accountId,
            amount,
            currency: rule.currency,
            exchangeRate: toNumber(rule.exchangeRate),
            description: rule.description,
            categoryId: rule.categoryId,
            date: day,
          },
          db,
          { recurringRuleId: rule.id, record: false, kind: rule.kind, skipRules: !!rule.categoryId }
        );
  const pending = await db.attachment.count({ where: { recurringRuleId: rule.id, kind: "BILL" } });
  if (pending) {
    await db.attachment.updateMany({
      where: { recurringRuleId: rule.id, kind: "BILL" },
      data: result.transferGroupId
        ? { recurringRuleId: null, transferGroupId: result.transferGroupId }
        : { recurringRuleId: null, ledgerEntryId: result.entryIds[0] },
    });
  }
  return result;
}

/** Mark the next occurrence as paid: book it (optionally on another date/amount) and advance. */
export async function markRulePaid(userId: string, ruleId: string, db: DbClient, opts: { date?: string; amount?: number } = {}) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw notFound("Recurring rule");
    const date = opts.date ? parseLocalDate(opts.date) : rule.nextDueDate;
    const result = await materializeRule(rule, date, tx, { amount: opts.amount });
    const updated = await tx.recurringRule.update({
      where: { id: rule.id },
      data: { nextDueDate: getNextOccurrence(rule.nextDueDate, rule.frequency), lastGeneratedDate: toNoonUTC(new Date()) },
    });
    return { rule: updated, ...result };
  });
}

export async function skipRuleOccurrence(userId: string, ruleId: string, db: DbClient) {
  const rule = await db.recurringRule.findFirst({ where: { id: ruleId, userId } });
  if (!rule) throw notFound("Recurring rule");
  return db.recurringRule.update({ where: { id: rule.id }, data: { nextDueDate: getNextOccurrence(rule.nextDueDate, rule.frequency) } });
}

/**
 * Cron: books every due occurrence of auto-generating rules up to today.
 * Reminder-mode rules (autoGenerate = false) are skipped so they stay
 * overdue until marked as paid.
 */
export async function processDueRules(db: DbClient, now = new Date()) {
  const today = toNoonUTC(now);
  const todayEnd = endOfDay(now);
  const due = await db.recurringRule.findMany({
    where: { isActive: true, autoGenerate: true, nextDueDate: { lte: todayEnd }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
  });
  const results: { ruleId: string; generated: number; nextDueDate: string }[] = [];
  for (const rule of due) {
    let next = toNoonUTC(rule.nextDueDate);
    let generated = 0;
    while (!isAfter(next, todayEnd)) {
      if (rule.endDate && isAfter(next, toNoonUTC(rule.endDate))) break;
      await inTransaction(db, (tx) => materializeRule(rule, next, tx));
      generated++;
      next = getNextOccurrence(next, rule.frequency);
    }
    if (generated) {
      await db.recurringRule.update({ where: { id: rule.id }, data: { nextDueDate: next, lastGeneratedDate: today } });
      results.push({ ruleId: rule.id, generated, nextDueDate: formatDateOnly(next) });
    }
  }
  return { processed: due.length, generated: results.reduce((s, r) => s + r.generated, 0), results };
}
