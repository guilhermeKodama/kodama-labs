import { endOfDay, isAfter } from "date-fns";
import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Account, Category, Entity, LedgerKind, RecurrenceFrequency, RecurringRule, TransferDirection } from "@/generated/prisma";
import { formatDateOnly, parseLocalDate, toNoonUTC } from "@capital/server/lib/date-utils";
import { getNextOccurrence } from "@capital/server/lib/recurrence";
import { remindersConfigSchema, type RemindersConfig } from "@/lib/validations/reminders";
import { entityScopeWhere } from "@capital/server/lib/entity-scope";
import { todayIn } from "@capital/server/modules/budgets/lib/today";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";

export interface RecurringRuleInput {
  kind: LedgerKind;
  accountId: string;
  /** Required for transfers. */
  toAccountId?: string | null;
  transferDirection?: TransferDirection | null;
  amount: number;
  currency?: string;
  /** Explicit rate for every occurrence; null/omitted = the rate in force at booking. */
  exchangeRate?: number | null;
  description: string;
  categoryId?: string | null;
  /** Occurrences are booked as tax-deductible expenses. */
  isTaxDeductible?: boolean;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate?: string | null;
  /** false = reminder mode: nothing is generated until marked as paid. */
  autoGenerate?: boolean;
  reminders?: RemindersConfig | null;
}

export interface RuleWriteOptions {
  /** Mutation records are appended here instead of a new undo batch when given. */
  collect?: MutationRecordInput[];
  /**
   * Book the occurrences already due (start date up to today, in the user's
   * timezone) of an active auto-generating rule in the same batch, instead
   * of waiting for the morning cron. The v2 routes pass it.
   */
  bookDue?: boolean;
}

type RuleRelations = Partial<{
  entity: Pick<Entity, "id" | "name" | "kind">;
  account: Pick<Account, "id" | "name" | "type" | "currency">;
  toAccount: Pick<Account, "id" | "name" | "type" | "currency"> | null;
  category: Pick<Category, "id" | "name"> | null;
}>;

/** Relations listRecurringRules loads for the API (entity badge, account names). */
export const RULE_INCLUDE = {
  entity: { select: { id: true, name: true, kind: true } },
  account: { select: { id: true, name: true, type: true, currency: true } },
  toAccount: { select: { id: true, name: true, type: true, currency: true } },
  category: { select: { id: true, name: true } },
} as const;

export function serializeRule(r: RecurringRule & RuleRelations) {
  return {
    id: r.id,
    kind: r.kind,
    entityId: r.entityId,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    transferDirection: r.transferDirection,
    amount: toNumber(r.amount),
    currency: r.currency,
    exchangeRate: r.exchangeRate === null ? null : toNumber(r.exchangeRate),
    description: r.description,
    categoryId: r.categoryId,
    isTaxDeductible: r.isTaxDeductible,
    frequency: r.frequency,
    startDate: formatDateOnly(r.startDate),
    endDate: r.endDate ? formatDateOnly(r.endDate) : null,
    nextDueDate: formatDateOnly(r.nextDueDate),
    lastGeneratedDate: r.lastGeneratedDate ? formatDateOnly(r.lastGeneratedDate) : null,
    isActive: r.isActive,
    autoGenerate: r.autoGenerate,
    reminders: r.reminders,
    ...(r.entity && { entity: { id: r.entity.id, name: r.entity.name, kind: r.entity.kind } }),
    ...(r.account && { account: { id: r.account.id, name: r.account.name, type: r.account.type, currency: r.account.currency } }),
    ...(r.toAccount !== undefined && { toAccount: r.toAccount && { id: r.toAccount.id, name: r.toAccount.name, type: r.toAccount.type, currency: r.toAccount.currency } }),
    ...(r.category !== undefined && { category: r.category && { id: r.category.id, name: r.category.name } }),
  };
}

async function validate(userId: string, input: Partial<RecurringRuleInput>, db: DbClient, currentCategoryId: string | null = null) {
  if (input.amount !== undefined && !(input.amount > 0)) throw new LedgerError("Amount must be positive", 422, { code: "recurring.invalid_amount" });
  if (input.kind === "transfer" && !input.toAccountId) throw new LedgerError("Recurring transfers need toAccountId", 422, { code: "recurring.transfer_needs_destination" });
  if (input.toAccountId) await getOwnedAccount(userId, input.toAccountId, db);
  if (input.categoryId) {
    const c = await db.category.findFirst({ where: { id: input.categoryId, userId } });
    if (!c) throw notFound("Category", "category.not_found");
    if (c.isArchived && c.id !== currentCategoryId) throw new LedgerError(`Category "${c.name}" is archived and cannot be assigned`, 422, { code: "category.archived", params: { name: c.name } });
  }
  if (input.reminders) remindersConfigSchema.parse(input.reminders);
}

export async function createRecurringRule(userId: string, input: RecurringRuleInput, db: DbClient, opts: RuleWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    await validate(userId, input, tx);
    const account = await getOwnedAccount(userId, input.accountId, tx);
    const startDate = parseLocalDate(input.startDate);
    const rule = await tx.recurringRule.create({
      data: {
        userId,
        entityId: account.entityId,
        accountId: account.id,
        kind: input.kind,
        amount: input.amount,
        currency: input.currency ?? account.currency,
        exchangeRate: input.exchangeRate ?? null,
        description: input.description,
        categoryId: input.categoryId ?? null,
        isTaxDeductible: input.isTaxDeductible ?? false,
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
    const records: MutationRecordInput[] = opts.collect ?? [];
    const booked = opts.bookDue ? await bookDueNow(rule, tx, records) : noneBooked(rule);
    // One record with the final row: undo removes the occurrences, then the rule.
    records.push({ model: "RecurringRule", recordId: rule.id, before: null, after: snapshot(booked.rule) });
    const batchId = opts.collect ? null : await recordMutation(tx, userId, "create", rule.description, records);
    return { ...booked.rule, batchId, booked: bookedSummary(booked) };
  });
}

export async function updateRecurringRule(
  userId: string,
  ruleId: string,
  patch: Partial<RecurringRuleInput> & { isActive?: boolean; nextDueDate?: string },
  db: DbClient,
  opts: RuleWriteOptions = {}
) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw notFound("Recurring rule", "recurring.not_found");
    await validate(userId, { ...patch, kind: patch.kind ?? rule.kind, toAccountId: patch.toAccountId ?? rule.toAccountId }, tx, rule.categoryId);
    const account = patch.accountId ? await getOwnedAccount(userId, patch.accountId, tx) : null;
    const updated = await tx.recurringRule.update({
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
        ...(patch.isTaxDeductible !== undefined && { isTaxDeductible: patch.isTaxDeductible }),
        ...(patch.frequency !== undefined && { frequency: patch.frequency }),
        ...(patch.startDate !== undefined && { startDate: parseLocalDate(patch.startDate) }),
        ...(patch.endDate !== undefined && { endDate: patch.endDate ? parseLocalDate(patch.endDate) : null }),
        ...(patch.nextDueDate !== undefined && { nextDueDate: parseLocalDate(patch.nextDueDate) }),
        ...(patch.autoGenerate !== undefined && { autoGenerate: patch.autoGenerate }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
        ...(patch.reminders !== undefined && { reminders: patch.reminders ? (patch.reminders as Prisma.InputJsonValue) : Prisma.DbNull }),
      },
    });
    const records: MutationRecordInput[] = opts.collect ?? [];
    // Switched to auto (or resumed) with occurrences already due: they are booked in the same batch.
    const booked = opts.bookDue ? await bookDueNow(updated, tx, records) : noneBooked(updated);
    records.push({ model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: snapshot(booked.rule) });
    const batchId = opts.collect ? null : await recordMutation(tx, userId, "update", updated.description, records);
    return { ...booked.rule, batchId, booked: bookedSummary(booked) };
  });
}

/**
 * Deletes a rule outright. Its booked occurrences (entries and transfer
 * groups) stay, unlinked, and the bills still attached to it go with it;
 * undo re-creates the rule and its bills under their ids and links the
 * occurrences back.
 */
export async function deleteRecurringRule(userId: string, ruleId: string, db: DbClient, opts: RuleWriteOptions = {}) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw notFound("Recurring rule", "recurring.not_found");
    const [entries, groups, attachments] = await Promise.all([
      tx.ledgerEntry.findMany({ where: { recurringRuleId: rule.id } }),
      tx.transferGroup.findMany({ where: { recurringRuleId: rule.id } }),
      tx.attachment.findMany({ where: { recurringRuleId: rule.id } }),
    ]);
    await tx.recurringRule.delete({ where: { id: rule.id } });
    const records: MutationRecordInput[] = opts.collect ?? [];
    records.push({ model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: null });
    for (const a of attachments) records.push({ model: "Attachment", recordId: a.id, before: snapshot(a), after: null });
    for (const g of groups) records.push({ model: "TransferGroup", recordId: g.id, before: snapshot(g), after: snapshot({ ...g, recurringRuleId: null }) });
    for (const e of entries) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, recurringRuleId: null }) });
    const batchId = opts.collect ? null : await recordMutation(tx, userId, "delete", rule.description, records);
    return { batchId };
  });
}

/** Rules by next due date, with their entity, accounts and category. `entityIds` is a resolved scope (null = all). */
export async function listRecurringRules(userId: string, db: DbClient, opts: { includeInactive?: boolean; entityId?: string; entityIds?: string[] | null } = {}) {
  return db.recurringRule.findMany({
    where: {
      userId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.entityId && { entityId: opts.entityId }),
      ...entityScopeWhere(opts.entityIds ?? null),
    },
    include: RULE_INCLUDE,
    orderBy: [{ nextDueDate: "asc" }, { description: "asc" }],
  });
}

/**
 * Books one occurrence of a rule (an entry, or a transfer) on `date`. BILL
 * attachments on the template move to the first materialized occurrence.
 * With `records`, the occurrence and the bills it takes join the caller's
 * undo batch (undo moves the bills back to the rule).
 */
export async function materializeRule(rule: RecurringRule, date: Date, db: DbClient, override: { amount?: number } = {}, records?: MutationRecordInput[]) {
  const amount = override.amount ?? toNumber(rule.amount);
  // No explicit rate: createEntry converts at the rate in force today.
  const exchangeRate = rule.exchangeRate === null ? undefined : toNumber(rule.exchangeRate);
  const day = formatDateOnly(date);
  const write = records ? { collect: records } : { record: false };
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
            exchangeRate,
            direction: rule.transferDirection ?? undefined,
            description: rule.description,
            date: day,
          },
          db,
          { recurringRuleId: rule.id, ...write }
        )
      : await createEntry(
          rule.userId,
          {
            kind: rule.kind === "income" ? "income" : "expense",
            accountId: rule.accountId,
            amount,
            currency: rule.currency,
            exchangeRate,
            description: rule.description,
            categoryId: rule.categoryId,
            isTaxDeductible: rule.isTaxDeductible,
            date: day,
          },
          db,
          { recurringRuleId: rule.id, ...write, kind: rule.kind, skipRules: !!rule.categoryId }
        );
  const pending = await db.attachment.findMany({ where: { recurringRuleId: rule.id, kind: "BILL" } });
  if (pending.length) {
    const owner = result.transferGroupId
      ? { recurringRuleId: null, transferGroupId: result.transferGroupId }
      : { recurringRuleId: null, ledgerEntryId: result.entryIds[0] };
    await db.attachment.updateMany({ where: { id: { in: pending.map((a) => a.id) } }, data: owner });
    for (const a of pending) records?.push({ model: "Attachment", recordId: a.id, before: snapshot(a), after: snapshot({ ...a, ...owner }) });
  }
  return result;
}

interface BookedRun {
  rule: RecurringRule;
  generated: number;
  entryIds: string[];
  transferGroupIds: string[];
}

const noneBooked = (rule: RecurringRule): BookedRun => ({ rule, generated: 0, entryIds: [], transferGroupIds: [] });
const bookedSummary = (run: BookedRun) => ({ count: run.generated, entryIds: run.entryIds, transferGroupIds: run.transferGroupIds });

/**
 * Books every occurrence of a rule from its next due date through `until`
 * (and its end date), recording them in `records`, then advances the rule.
 * The caller records the rule's own before/after.
 */
async function bookDueOccurrences(rule: RecurringRule, tx: DbClient, until: Date, generatedOn: Date, records: MutationRecordInput[]): Promise<BookedRun> {
  const run = noneBooked(rule);
  let next = toNoonUTC(rule.nextDueDate);
  while (!isAfter(next, until)) {
    if (rule.endDate && isAfter(next, toNoonUTC(rule.endDate))) break;
    const result = await materializeRule(rule, next, tx, {}, records);
    run.generated++;
    run.entryIds.push(...result.entryIds);
    if (result.transferGroupId) run.transferGroupIds.push(result.transferGroupId);
    next = getNextOccurrence(next, rule.frequency);
  }
  if (!run.generated) return run;
  run.rule = await tx.recurringRule.update({ where: { id: rule.id }, data: { nextDueDate: next, lastGeneratedDate: generatedOn } });
  return run;
}

/** bookDueOccurrences up to today in the user's timezone, for an active auto-generating rule. */
async function bookDueNow(rule: RecurringRule, tx: DbClient, records: MutationRecordInput[]): Promise<BookedRun> {
  if (!rule.isActive || !rule.autoGenerate) return noneBooked(rule);
  const user = await tx.user.findUniqueOrThrow({ where: { id: rule.userId }, select: { timezone: true } });
  const today = todayIn(user.timezone);
  return bookDueOccurrences(rule, tx, today.end, toNoonUTC(today.start), records);
}

/** Mark the next occurrence as paid: book it (optionally on another date/amount) and advance, in one undo batch. */
export async function markRulePaid(userId: string, ruleId: string, db: DbClient, opts: { date?: string; amount?: number } = {}) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw notFound("Recurring rule", "recurring.not_found");
    const records: MutationRecordInput[] = [];
    const date = opts.date ? parseLocalDate(opts.date) : rule.nextDueDate;
    const result = await materializeRule(rule, date, tx, { amount: opts.amount }, records);
    const updated = await tx.recurringRule.update({
      where: { id: rule.id },
      data: { nextDueDate: getNextOccurrence(rule.nextDueDate, rule.frequency), lastGeneratedDate: toNoonUTC(new Date()) },
    });
    records.push({ model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: snapshot(updated) });
    const batchId = await recordMutation(tx, userId, "create", rule.description, records);
    return { rule: updated, ...result, batchId };
  });
}

export async function skipRuleOccurrence(userId: string, ruleId: string, db: DbClient) {
  return inTransaction(db, async (tx) => {
    const rule = await tx.recurringRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) throw notFound("Recurring rule", "recurring.not_found");
    const updated = await tx.recurringRule.update({ where: { id: rule.id }, data: { nextDueDate: getNextOccurrence(rule.nextDueDate, rule.frequency) } });
    const batchId = await recordMutation(tx, userId, "update", rule.description, [
      { model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: snapshot(updated) },
    ]);
    return { ...updated, batchId };
  });
}

/**
 * Cron: books every due occurrence of auto-generating rules up to today.
 * Reminder-mode rules (autoGenerate = false) are skipped so they stay
 * overdue until marked as paid. Each rule's occurrences and its advanced
 * due date are one system batch: the user can still undo them, and undoing
 * an older edit of the rule is refused rather than rewinding the due date
 * over occurrences already booked. `userId` limits the run to one user.
 */
export async function processDueRules(db: DbClient, now = new Date(), opts: { userId?: string } = {}) {
  const today = toNoonUTC(now);
  const todayEnd = endOfDay(now);
  const due = await db.recurringRule.findMany({
    where: {
      isActive: true,
      autoGenerate: true,
      nextDueDate: { lte: todayEnd },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
      ...(opts.userId && { userId: opts.userId }),
    },
  });
  const results: { ruleId: string; generated: number; nextDueDate: string; batchId: string }[] = [];
  for (const rule of due) {
    const booked = await inTransaction(db, async (tx) => {
      const records: MutationRecordInput[] = [];
      const run = await bookDueOccurrences(rule, tx, todayEnd, today, records);
      if (!run.generated) return null;
      records.push({ model: "RecurringRule", recordId: rule.id, before: snapshot(rule), after: snapshot(run.rule) });
      const batchId = await recordMutation(tx, rule.userId, "create", rule.description, records, { source: "system" });
      return { ruleId: rule.id, generated: run.generated, nextDueDate: formatDateOnly(run.rule.nextDueDate), batchId };
    });
    if (booked) results.push(booked);
  }
  return { processed: due.length, generated: results.reduce((s, r) => s + r.generated, 0), results };
}
