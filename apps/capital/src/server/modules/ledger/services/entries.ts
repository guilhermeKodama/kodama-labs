import { addMonths } from "date-fns";
import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { Account, Entity, LedgerEntry, LedgerKind, TransferDirection } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { st, type Locale } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import { normalizeDescription } from "@capital/server/modules/bank-statements/utils";
import { restoreLegOperations } from "@capital/server/modules/investments/lib/restore-operations";
import type { CreateEntryInput, EntryPatch } from "../contracts";
import { LedgerError, notFound } from "../lib/errors";
import { loadFx, type FxContext } from "../lib/fx";
import { displayAmount, kindSign, round, splitAmount, toNumber } from "../lib/money";
import { ENTRY_CONTEXT_INCLUDE, serializeEntry } from "../lib/serialize";
import { getOwnedAccount } from "./accounts";
import { getDefaultAccount, getOwnedEntity } from "./entities";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "./mutations";
import { learnRule, loadRuleMatcher, recordRuleHits } from "./rules";
import { assignStatement, statementMonthFor } from "./statements";

export interface WriteOptions {
  importId?: string | null;
  recurringRuleId?: string | null;
  metadata?: Prisma.InputJsonValue;
  merchantName?: string | null;
  /** Statement month (YYYY-MM) for card purchases imported from a statement file. */
  statementMonth?: string;
  /** Skip categorization rules (the caller already decided the category, or wants none). */
  skipRules?: boolean;
  /** Record an undo batch (default true). Callers that batch several writes pass their own. */
  record?: boolean;
  /** Mutation records are appended here instead of a new batch when given. */
  collect?: MutationRecordInput[];
  /** Override the kind for internal writers (investment cash legs, MCP `type`). */
  kind?: LedgerKind;
  isAutoCategorized?: boolean;
  /** The categorization rule that chose input.categoryId (callers that match rules themselves, like imports). */
  categorizedByRuleId?: string | null;
}

export interface WriteResult {
  batchId: string | null;
  entryIds: string[];
  transferGroupId: string | null;
}

async function assertAssignableCategory(userId: string, categoryId: string, db: DbClient) {
  const category = await db.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new LedgerError("Category not found", 404, { code: "category.not_found" });
  if (category.isArchived) throw new LedgerError(`Category "${category.name}" is archived and cannot be assigned`, 422, { code: "category.archived", params: { name: category.name } });
  return category;
}

function assertWritableAccount(account: Account) {
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
}

async function effectiveDateFor(account: Account, date: Date, db: DbClient, statementMonth?: string) {
  if (account.type !== "credit_card") return { effectiveDate: date, cardStatementId: null as string | null };
  const { statement, effectiveDate } = await assignStatement(account, date, db, statementMonth);
  return { effectiveDate, cardStatementId: statement.id as string | null };
}

function inferDirection(from: Account & { entity: Entity }, to: Account & { entity: Entity }): TransferDirection {
  if (to.type === "credit_card") return "card_payment";
  if (to.type === "brokerage" && from.type !== "brokerage") return "investment_deposit";
  if (from.type === "brokerage" && to.type !== "brokerage") return "investment_withdrawal";
  if (from.entityId !== to.entityId) {
    if (from.entity.kind === "business" && to.entity.kind === "personal") return "profit_distribution";
    if (from.entity.kind === "personal" && to.entity.kind === "business") return "capital_injection";
  }
  return "between_accounts";
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createEntry(userId: string, input: CreateEntryInput, db: DbClient, opts: WriteOptions = {}): Promise<WriteResult> {
  return inTransaction(db, async (tx) => {
    const fx = await loadFx(userId, tx);
    const records: MutationRecordInput[] = opts.collect ?? [];
    const result = input.kind === "transfer"
      ? await createTransferIn(tx, userId, input, fx, opts, records)
      : await createSimpleIn(tx, userId, input, fx, opts, records);
    const batchId =
      opts.record === false || opts.collect
        ? null
        : await recordMutation(tx, userId, "create", input.description ?? null, records);
    return { ...result, batchId };
  });
}

async function createSimpleIn(
  tx: DbClient,
  userId: string,
  input: Extract<CreateEntryInput, { kind: "income" | "expense" }>,
  fx: FxContext,
  opts: WriteOptions,
  records: MutationRecordInput[]
): Promise<Omit<WriteResult, "batchId">> {
  const account = await getOwnedAccount(userId, input.accountId, tx);
  assertWritableAccount(account);
  const kind = opts.kind ?? input.kind;
  const currency = input.currency ?? account.currency;
  const rate = input.exchangeRate ?? fx.rateFor(currency);
  const date = parseLocalDate(input.date);

  let categoryId = input.categoryId ?? null;
  let isAutoCategorized = opts.isAutoCategorized ?? false;
  // The entry history names the rule that chose the category ("Categoria definida pela regra “ifood”").
  let categorizedByRuleId = categoryId ? opts.categorizedByRuleId ?? null : null;
  if (categoryId) {
    await assertAssignableCategory(userId, categoryId, tx);
  } else if (!opts.skipRules) {
    const matcher = await loadRuleMatcher(userId, tx);
    const rule = matcher.match(input.description, account.entityId);
    if (rule) {
      categoryId = rule.categoryId;
      isAutoCategorized = true;
      categorizedByRuleId = rule.id;
      await recordRuleHits([rule.id], tx);
    }
  }

  const count = input.installments ?? 1;
  const parts = count > 1 ? splitAmount(input.amount, count) : [input.amount];
  let planId: string | null = null;
  if (count > 1) {
    const plan = await tx.installmentPlan.create({
      data: {
        userId,
        accountId: account.id,
        description: input.description,
        totalAmount: input.amount,
        totalInstallments: count,
        installmentAmount: parts[0],
        startDate: date,
      },
    });
    planId = plan.id;
    records.push({ model: "InstallmentPlan", recordId: plan.id, before: null, after: snapshot(plan) });
  }

  const baseMonth = account.type === "credit_card" ? opts.statementMonth ?? statementMonthFor(date, account.closingDay ?? 1) : undefined;
  const entryIds: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entryDate = i === 0 ? date : addMonths(date, i);
    const month = baseMonth ? shiftMonth(baseMonth, i) : undefined;
    const { effectiveDate, cardStatementId } = await effectiveDateFor(account, entryDate, tx, month);
    const amount = round(kindSign(kind) * parts[i], 4);
    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        entityId: account.entityId,
        accountId: account.id,
        kind,
        amount,
        currency,
        exchangeRate: rate,
        amountBase: round(amount * rate, 4),
        date: entryDate,
        effectiveDate,
        description: count > 1 ? `${input.description} (${i + 1}/${count})` : input.description,
        notes: input.notes ?? null,
        merchantName: opts.merchantName ?? null,
        categoryId,
        isTaxDeductible: input.isTaxDeductible ?? false,
        isAutoCategorized,
        categorizedByRuleId,
        cardStatementId,
        installmentPlanId: planId,
        installmentNumber: count > 1 ? i + 1 : null,
        recurringRuleId: opts.recurringRuleId ?? null,
        importId: opts.importId ?? null,
        externalId: i === 0 ? input.externalId ?? null : null,
        metadata: opts.metadata,
      },
    });
    entryIds.push(entry.id);
    records.push({ model: "LedgerEntry", recordId: entry.id, before: null, after: snapshot(entry) });
  }
  return { entryIds, transferGroupId: null };
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function createTransferIn(
  tx: DbClient,
  userId: string,
  input: Extract<CreateEntryInput, { kind: "transfer" }>,
  fx: FxContext,
  opts: WriteOptions,
  records: MutationRecordInput[]
): Promise<Omit<WriteResult, "batchId">> {
  if (input.fromAccountId === input.toAccountId) throw new LedgerError("A transfer needs two different accounts", 422, { code: "transfer.same_account" });
  const [from, to] = await Promise.all([
    tx.account.findFirst({ where: { id: input.fromAccountId, userId }, include: { entity: true } }),
    tx.account.findFirst({ where: { id: input.toAccountId, userId }, include: { entity: true } }),
  ]);
  if (!from) throw notFound("Source account", "transfer.from_account_not_found");
  if (!to) throw notFound("Destination account", "transfer.to_account_not_found");
  assertWritableAccount(from);
  assertWritableAccount(to);

  const direction = input.direction ?? inferDirection(from, to);
  const legKind: LedgerKind = direction === "reimbursement" ? "expense" : "transfer";
  const currency = input.currency ?? from.currency;
  const rate = input.exchangeRate ?? fx.rateFor(currency);
  const date = parseLocalDate(input.date);
  const fromAmount = round(-input.amount, 4);
  const fromBase = round(fromAmount * rate, 4);

  // The destination leg mirrors the source in base currency so the group nets to zero.
  let toCurrency = currency;
  let toAmount = input.amount;
  let toRate = rate;
  if (to.currency !== currency && (input.toAmount || fx.rateFor(to.currency) !== rate)) {
    toCurrency = to.currency;
    toAmount = input.toAmount ?? round(-fromBase / fx.rateFor(to.currency), 2);
    toRate = toAmount ? -fromBase / toAmount : 1;
  }
  const description = input.description ?? defaultTransferDescription(await loadUserLocale(userId, tx), direction, from, to);

  const group = await tx.transferGroup.create({
    data: {
      userId,
      direction,
      description,
      date,
      recurringRuleId: opts.recurringRuleId ?? null,
      importId: opts.importId ?? null,
    },
  });
  records.push({ model: "TransferGroup", recordId: group.id, before: null, after: snapshot(group) });

  const fromLeg = await tx.ledgerEntry.create({
    data: {
      userId,
      entityId: from.entityId,
      accountId: from.id,
      kind: legKind,
      amount: fromAmount,
      currency,
      exchangeRate: rate,
      amountBase: fromBase,
      date,
      effectiveDate: date,
      description,
      notes: input.notes ?? null,
      transferGroupId: group.id,
      recurringRuleId: opts.recurringRuleId ?? null,
      importId: opts.importId ?? null,
      metadata: opts.metadata,
    },
  });
  const toLeg = await tx.ledgerEntry.create({
    data: {
      userId,
      entityId: to.entityId,
      accountId: to.id,
      kind: legKind,
      amount: round(toAmount, 4),
      currency: toCurrency,
      exchangeRate: round(toRate, 8),
      amountBase: -fromBase,
      date,
      effectiveDate: date,
      description,
      notes: input.notes ?? null,
      transferGroupId: group.id,
      recurringRuleId: opts.recurringRuleId ?? null,
      importId: opts.importId ?? null,
      metadata: opts.metadata,
    },
  });
  records.push({ model: "LedgerEntry", recordId: fromLeg.id, before: null, after: snapshot(fromLeg) });
  records.push({ model: "LedgerEntry", recordId: toLeg.id, before: null, after: snapshot(toLeg) });

  if (direction === "card_payment") await linkOpenStatement(tx, to.id, group.id, date, records);
  return { entryIds: [fromLeg.id, toLeg.id], transferGroupId: group.id };
}

/** A card_payment transfer settles the card's latest unpaid statement that closes by a month after it. */
async function linkOpenStatement(tx: DbClient, cardAccountId: string, groupId: string, date: Date, records: MutationRecordInput[]) {
  const open = await tx.cardStatement.findFirst({
    where: { accountId: cardAccountId, paymentGroupId: null, closingDate: { lte: addMonths(date, 1) } },
    orderBy: { month: "desc" },
  });
  if (!open) return;
  const paid = await tx.cardStatement.update({ where: { id: open.id }, data: { paymentGroupId: groupId } });
  records.push({ model: "CardStatement", recordId: open.id, before: snapshot(open), after: snapshot(paid) });
}

/** Statements this transfer settled stop pointing at it (its direction or card changed). */
async function unlinkStatements(tx: DbClient, groupId: string, records: MutationRecordInput[]) {
  const linked = await tx.cardStatement.findMany({ where: { paymentGroupId: groupId } });
  for (const statement of linked) {
    const unpaid = await tx.cardStatement.update({ where: { id: statement.id }, data: { paymentGroupId: null } });
    records.push({ model: "CardStatement", recordId: statement.id, before: snapshot(statement), after: snapshot(unpaid) });
  }
}

/** "Distribuição de lucros: Kodama LTDA → PF", in the user's locale. */
function defaultTransferDescription(locale: Locale, direction: TransferDirection, from: Account, to: Account) {
  return st(locale, "ledger.transferDescription", { direction: st(locale, `ledger.direction.${direction}`), from: from.name, to: to.name });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface InternalPatch extends Partial<Omit<EntryPatch, "kind">> {
  kind?: "income" | "expense" | "investment";
}

export async function updateEntry(userId: string, entryId: string, patch: InternalPatch, db: DbClient, opts: { collect?: MutationRecordInput[]; record?: boolean } = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = opts.collect ?? [];
    const fx = await loadFx(userId, tx);
    const entry = await tx.ledgerEntry.findFirst({ where: { id: entryId, userId, deletedAt: null } });
    if (!entry) throw notFound("Transaction", "entry.not_found");
    if (entry.transferGroupId) await updateTransferIn(tx, userId, entry, patch, fx, records);
    else await updateSimpleIn(tx, userId, entry, patch, fx, records);
    const batchId =
      opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "update", entry.description, records);
    const updated = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: entryId }, include: ENTRY_CONTEXT_INCLUDE });
    return { batchId, entry: serializeEntry(updated), raw: updated };
  });
}

const TRANSFER_ONLY_FIELDS = ["fromAccountId", "toAccountId", "direction", "reimbursement"] as const;

/** A category the user (or a kind change) replaced no longer counts as auto-assigned or as the work of a rule. */
const MANUAL_CATEGORY = { isAutoCategorized: false, categorizedByRuleId: null };

async function updateSimpleIn(
  tx: DbClient,
  userId: string,
  entry: LedgerEntry,
  patch: InternalPatch,
  fx: FxContext,
  records: MutationRecordInput[]
) {
  if (TRANSFER_ONLY_FIELDS.some((f) => patch[f] !== undefined)) {
    throw new LedgerError("Only a transfer has a source and a destination account", 422, { code: "entry.not_transfer" });
  }
  const kindChanges = patch.kind !== undefined && patch.kind !== entry.kind;
  // An operation's cash leg follows the operation; its sign is the operation's, not the user's.
  if (kindChanges && (await tx.investmentOperation.count({ where: { cashEntryId: entry.id } }))) {
    throw new LedgerError("The type of an investment operation's cash cannot change; edit the operation instead", 422, { code: "entry.kind_locked" });
  }
  let account = await tx.account.findUniqueOrThrow({ where: { id: entry.accountId } });
  if (patch.accountId && patch.accountId !== entry.accountId) {
    account = await getOwnedAccount(userId, patch.accountId, tx);
    assertWritableAccount(account);
  } else if (patch.entityId && patch.entityId !== entry.entityId) {
    const entity = await getOwnedEntity(userId, patch.entityId, tx);
    account = await getDefaultAccount(entity, tx);
  }
  if (patch.categoryId) await assertAssignableCategory(userId, patch.categoryId, tx);

  const kind: LedgerKind = patch.kind ?? entry.kind;
  // income <-> expense keeps the magnitude the user sees and flips the stored sign.
  const magnitude = patch.amount ?? displayAmount(entry.kind, entry.amount);
  const currency = patch.currency ?? entry.currency;
  const rate =
    patch.exchangeRate ?? (patch.currency && patch.currency !== entry.currency ? fx.rateFor(patch.currency) : toNumber(entry.exchangeRate));
  const amount = round(kindSign(kind) * magnitude, 4);
  const date = patch.date ? parseLocalDate(patch.date) : entry.date;

  let effectiveDate = entry.effectiveDate;
  let cardStatementId = entry.cardStatementId;
  if (patch.date || account.id !== entry.accountId) {
    ({ effectiveDate, cardStatementId } = await effectiveDateFor(account, date, tx));
  }

  let category: { categoryId?: string | null; isAutoCategorized?: boolean; categorizedByRuleId?: null } = {};
  if (patch.categoryId !== undefined && patch.categoryId !== entry.categoryId) {
    category = { categoryId: patch.categoryId, ...MANUAL_CATEGORY };
  } else if (patch.categoryId === undefined && kindChanges && entry.categoryId) {
    // An expense category does not follow the entry into income (and back).
    const current = await tx.category.findUnique({ where: { id: entry.categoryId }, select: { type: true } });
    if (current && current.type !== kind) category = { categoryId: null, ...MANUAL_CATEGORY };
  }

  const updated = await tx.ledgerEntry.update({
    where: { id: entry.id },
    data: {
      kind,
      amount,
      currency,
      exchangeRate: rate,
      amountBase: round(amount * rate, 4),
      date,
      effectiveDate,
      cardStatementId,
      accountId: account.id,
      entityId: account.entityId,
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.notes !== undefined && { notes: patch.notes }),
      ...category,
      ...(patch.isTaxDeductible !== undefined && { isTaxDeductible: patch.isTaxDeductible }),
    },
  });
  records.push({ model: "LedgerEntry", recordId: entry.id, before: snapshot(entry), after: snapshot(updated) });
}

type AccountWithEntity = Account & { entity: Entity };

async function writableAccountWithEntity(userId: string, accountId: string, tx: DbClient): Promise<AccountWithEntity> {
  const account = await tx.account.findFirst({ where: { id: accountId, userId }, include: { entity: true } });
  if (!account) throw notFound("Account", "account.not_found");
  assertWritableAccount(account);
  return account;
}

/**
 * Edits a transfer as a whole: description, date and amount move every leg;
 * fromAccountId/toAccountId (or accountId, for the addressed leg) move the
 * endpoints, and a leg landing on an account in another currency is
 * re-expressed in it at today's rate (the base amounts, which balance the
 * group, stay). The direction follows the endpoints when it was the one
 * they implied; `direction` or `reimbursement` set it by hand. A
 * reimbursement books expense legs, anything else transfer legs (which
 * carry no category). Statements a card payment settled follow the change.
 */
async function updateTransferIn(tx: DbClient, userId: string, entry: LedgerEntry, patch: InternalPatch, fx: FxContext, records: MutationRecordInput[]) {
  const group = await tx.transferGroup.findUniqueOrThrow({
    where: { id: entry.transferGroupId! },
    include: { legs: { include: { account: { include: { entity: true } } } } },
  });
  if (patch.kind && patch.kind !== entry.kind) throw new LedgerError("Transfers cannot change type; delete and recreate instead", 422, { code: "transfer.kind_change" });
  const { legs, ...groupRow } = group;
  const fromLeg = legs.find((l) => toNumber(l.amount) < 0) ?? legs[0];
  const toLeg = legs.find((l) => l.id !== fromLeg.id) ?? legs[legs.length - 1];

  const moved = new Map<string, AccountWithEntity>();
  const move = async (legId: string, accountId: string | undefined, current: string) => {
    if (accountId && accountId !== current && !moved.has(legId)) moved.set(legId, await writableAccountWithEntity(userId, accountId, tx));
  };
  await move(fromLeg.id, patch.fromAccountId, fromLeg.accountId);
  await move(toLeg.id, patch.toAccountId, toLeg.accountId);
  await move(entry.id, patch.accountId, entry.accountId);
  const fromAccount = moved.get(fromLeg.id) ?? fromLeg.account;
  const toAccount = moved.get(toLeg.id) ?? toLeg.account;
  if (fromAccount.id === toAccount.id) throw new LedgerError("A transfer needs two different accounts", 422, { code: "transfer.same_account" });

  let direction = group.direction;
  if (patch.direction) direction = patch.direction;
  else if (patch.reimbursement === true) direction = "reimbursement";
  else if (patch.reimbursement === false) {
    if (group.direction === "reimbursement") direction = inferDirection(fromAccount, toAccount);
  } else if (moved.size && group.direction !== "reimbursement" && group.direction === inferDirection(fromLeg.account, toLeg.account)) {
    direction = inferDirection(fromAccount, toAccount);
  }
  const legKind: LedgerKind = direction === "reimbursement" ? "expense" : "transfer";

  const date = patch.date ? parseLocalDate(patch.date) : group.date;
  const groupData = {
    ...(patch.date && { date }),
    ...(patch.description !== undefined && { description: patch.description }),
    ...(direction !== group.direction && { direction }),
  };
  if (Object.keys(groupData).length) {
    const updatedGroup = await tx.transferGroup.update({ where: { id: group.id }, data: groupData });
    records.push({ model: "TransferGroup", recordId: group.id, before: snapshot(groupRow), after: snapshot(updatedGroup) });
  }

  const current = Math.abs(toNumber(entry.amount));
  for (const { account: legAccount, ...leg } of legs) {
    const target = moved.get(leg.id) ?? legAccount;
    const sign = leg.id === fromLeg.id ? -1 : 1;
    let amount = toNumber(leg.amount);
    let amountBase = toNumber(leg.amountBase);
    let currency = leg.currency;
    let exchangeRate = toNumber(leg.exchangeRate);
    if (patch.amount !== undefined) {
      if (current > 0) {
        const scale = Math.abs(patch.amount) / current;
        amount = round(sign * Math.abs(amount) * scale, 4);
        amountBase = round(sign * Math.abs(amountBase) * scale, 4);
      } else {
        amount = round(sign * Math.abs(patch.amount), 4);
        amountBase = round(amount * exchangeRate, 4);
      }
    }
    if (moved.has(leg.id) && target.currency !== leg.currency) {
      currency = target.currency;
      exchangeRate = fx.rateFor(currency);
      amount = round(amountBase / exchangeRate, 4);
    }
    const addressed = leg.id === entry.id;
    const toTransfer = legKind === "transfer" && leg.kind !== "transfer";
    const updated = await tx.ledgerEntry.update({
      where: { id: leg.id },
      data: {
        kind: legKind,
        amount,
        amountBase,
        currency,
        exchangeRate,
        accountId: target.id,
        entityId: target.entityId,
        date,
        effectiveDate: date,
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.notes !== undefined && { notes: patch.notes }),
        ...(addressed && patch.categoryId !== undefined && patch.categoryId !== leg.categoryId && { categoryId: patch.categoryId, ...MANUAL_CATEGORY }),
        ...(toTransfer && { categoryId: null, ...MANUAL_CATEGORY }),
        ...(addressed && patch.isTaxDeductible !== undefined && { isTaxDeductible: patch.isTaxDeductible }),
      },
    });
    records.push({ model: "LedgerEntry", recordId: leg.id, before: snapshot(leg), after: snapshot(updated) });
  }

  const cardMoved = moved.has(toLeg.id);
  if (group.direction === "card_payment" && (direction !== "card_payment" || cardMoved)) await unlinkStatements(tx, group.id, records);
  if (direction === "card_payment" && (group.direction !== "card_payment" || cardMoved) && toAccount.type === "credit_card") {
    await linkOpenStatement(tx, toAccount.id, group.id, date, records);
  }
}

// ---------------------------------------------------------------------------
// Delete / restore / duplicate / bulk
// ---------------------------------------------------------------------------

/** Entries plus every sibling leg of the transfers they belong to. */
async function expandSelection(userId: string, ids: string[], tx: DbClient, includeDeleted = false) {
  const entries = await tx.ledgerEntry.findMany({
    where: { id: { in: ids }, userId, ...(includeDeleted ? {} : { deletedAt: null }) },
    select: { id: true, transferGroupId: true },
  });
  const groupIds = [...new Set(entries.map((e) => e.transferGroupId).filter((g): g is string => !!g))];
  const legs = groupIds.length
    ? await tx.ledgerEntry.findMany({ where: { transferGroupId: { in: groupIds }, userId }, select: { id: true } })
    : [];
  return { entryIds: [...new Set([...entries.map((e) => e.id), ...legs.map((l) => l.id)])], groupIds };
}

export async function softDeleteEntries(
  userId: string,
  ids: string[],
  db: DbClient,
  opts: { summary?: string; record?: boolean; collect?: MutationRecordInput[] } = {}
) {
  return inTransaction(db, async (tx) => {
    const { entryIds, groupIds } = await expandSelection(userId, ids, tx);
    if (!entryIds.length) throw notFound("Transaction", "entry.not_found");
    const now = new Date();
    const records: MutationRecordInput[] = opts.collect ?? [];
    const before = await tx.ledgerEntry.findMany({ where: { id: { in: entryIds } } });
    const groupsBefore = await tx.transferGroup.findMany({ where: { id: { in: groupIds } } });
    await tx.ledgerEntry.updateMany({ where: { id: { in: entryIds } }, data: { deletedAt: now } });
    await tx.transferGroup.updateMany({ where: { id: { in: groupIds } }, data: { deletedAt: now } });
    for (const g of groupsBefore) records.push({ model: "TransferGroup", recordId: g.id, before: snapshot(g), after: snapshot({ ...g, deletedAt: now }) });
    for (const e of before) records.push({ model: "LedgerEntry", recordId: e.id, before: snapshot(e), after: snapshot({ ...e, deletedAt: now }) });
    const batchId =
      opts.record === false || opts.collect ? null : await recordMutation(tx, userId, "delete", opts.summary ?? `${entryIds.length} entries`, records);
    return { batchId, deleted: entryIds.length, entryIds };
  });
}

/** Takes entries (whole transfers) out of the trash; an investment cash leg brings back the operation deleted with it. */
export async function restoreEntries(userId: string, ids: string[], db: DbClient) {
  return inTransaction(db, async (tx) => {
    const { entryIds, groupIds } = await expandSelection(userId, ids, tx, true);
    const before = await tx.ledgerEntry.findMany({ where: { id: { in: entryIds }, deletedAt: { not: null } } });
    const groupsBefore = await tx.transferGroup.findMany({ where: { id: { in: groupIds }, deletedAt: { not: null } } });
    await tx.ledgerEntry.updateMany({ where: { id: { in: entryIds } }, data: { deletedAt: null } });
    await tx.transferGroup.updateMany({ where: { id: { in: groupIds } }, data: { deletedAt: null } });
    const records: MutationRecordInput[] = [
      ...groupsBefore.map((g) => ({ model: "TransferGroup" as const, recordId: g.id, before: snapshot(g), after: snapshot({ ...g, deletedAt: null }) })),
      ...before.map((e) => ({ model: "LedgerEntry" as const, recordId: e.id, before: snapshot(e), after: snapshot({ ...e, deletedAt: null }) })),
    ];
    const operationsRestored = await restoreLegOperations(tx, userId, before, records);
    const batchId = await recordMutation(tx, userId, "restore", `${before.length} entries`, records);
    return { batchId, restored: before.length, operationsRestored };
  });
}

/** Permanently removes entries that sat in the trash longer than `days`. */
export async function purgeTrash(db: DbClient, days = 30, userId?: string) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = { deletedAt: { lt: cutoff }, ...(userId && { userId }) };
  const groups = await db.transferGroup.deleteMany({ where });
  const entries = await db.ledgerEntry.deleteMany({ where });
  return { groups: groups.count, entries: entries.count };
}

/** Copies entries (whole transfers when a leg is selected); each copy's description gets the localized "(cópia)" suffix. */
export async function duplicateEntries(userId: string, ids: string[], db: DbClient) {
  return inTransaction(db, async (tx) => {
    const { entryIds, groupIds } = await expandSelection(userId, ids, tx);
    const entries = await tx.ledgerEntry.findMany({ where: { id: { in: entryIds } } });
    const suffix = st(await loadUserLocale(userId, tx), "common.copySuffix");
    const copyOf = (description: string) => `${description} ${suffix}`;
    const records: MutationRecordInput[] = [];
    const groupMap = new Map<string, string>();
    for (const gid of groupIds) {
      const g = await tx.transferGroup.findUniqueOrThrow({ where: { id: gid } });
      const copy = await tx.transferGroup.create({
        data: { userId, direction: g.direction, description: g.description && copyOf(g.description), date: g.date },
      });
      groupMap.set(gid, copy.id);
      records.push({ model: "TransferGroup", recordId: copy.id, before: null, after: snapshot(copy) });
    }
    const created: string[] = [];
    for (const e of entries) {
      const copy = await tx.ledgerEntry.create({
        data: {
          userId,
          entityId: e.entityId,
          accountId: e.accountId,
          kind: e.kind,
          amount: e.amount,
          currency: e.currency,
          exchangeRate: e.exchangeRate,
          amountBase: e.amountBase,
          date: e.date,
          effectiveDate: e.effectiveDate,
          description: copyOf(e.description),
          notes: e.notes,
          merchantName: e.merchantName,
          categoryId: e.categoryId,
          isTaxDeductible: e.isTaxDeductible,
          cardStatementId: e.cardStatementId,
          transferGroupId: e.transferGroupId ? groupMap.get(e.transferGroupId) ?? null : null,
          metadata: { duplicatedFrom: e.id },
        },
      });
      created.push(copy.id);
      records.push({ model: "LedgerEntry", recordId: copy.id, before: null, after: snapshot(copy) });
    }
    const batchId = await recordMutation(tx, userId, "duplicate", `${created.length} entries`, records);
    return { batchId, entryIds: created };
  });
}

export interface BulkPatch {
  categoryId?: string | null;
  entityId?: string;
  accountId?: string;
  isTaxDeductible?: boolean;
  toggleTaxDeductible?: true;
}

/** The fields a bulk patch can touch, as the dry run reports them (toggleTaxDeductible counts as isTaxDeductible). */
export type BulkField = "categoryId" | "entityId" | "accountId" | "isTaxDeductible";

function bulkFields(patch: BulkPatch): BulkField[] {
  const fields: BulkField[] = [];
  if (patch.categoryId !== undefined) fields.push("categoryId");
  if (patch.accountId) fields.push("accountId");
  else if (patch.entityId) fields.push("entityId");
  if (patch.toggleTaxDeductible || patch.isTaxDeductible !== undefined) fields.push("isTaxDeductible");
  return fields;
}

/** Transfer legs carry no category (a reimbursement's expense legs do). */
const categorizable = (e: Pick<LedgerEntry, "kind">) => e.kind !== "transfer";

/**
 * What a bulk patch changes on one entry. Transfer legs and investment cash
 * legs keep their account and entity: a transfer's endpoints are edited on
 * the transfer, and a cash leg belongs to its broker.
 */
function bulkPatchFor(e: LedgerEntry, patch: BulkPatch): InternalPatch {
  const p: InternalPatch = {};
  if (patch.categoryId !== undefined && patch.categoryId !== e.categoryId && categorizable(e)) p.categoryId = patch.categoryId;
  const movable = !e.transferGroupId && e.kind !== "investment";
  if (movable && patch.accountId) {
    if (patch.accountId !== e.accountId) p.accountId = patch.accountId;
  } else if (movable && patch.entityId && patch.entityId !== e.entityId) {
    p.entityId = patch.entityId;
  }
  if (patch.toggleTaxDeductible) p.isTaxDeductible = !e.isTaxDeductible;
  else if (patch.isTaxDeductible !== undefined && patch.isTaxDeductible !== e.isTaxDeductible) p.isTaxDeductible = patch.isTaxDeductible;
  return p;
}

/** A transfer counts once (as the table shows it), whichever of its legs are selected. */
const displayKey = (e: Pick<LedgerEntry, "id" | "transferGroupId">) => e.transferGroupId ?? e.id;

/** Rules learning `categoryId` from these descriptions would create or move (createRule). */
async function rulesToLearn(userId: string, descriptions: string[], categoryId: string, db: DbClient) {
  const patterns = [...new Set(descriptions.map(normalizeDescription).filter(Boolean))];
  if (!patterns.length) return 0;
  const existing = await db.categorizationRule.findMany({ where: { userId, matchType: "equals", pattern: { in: patterns } }, select: { pattern: true, categoryId: true, source: true } });
  const byPattern = new Map(existing.map((r) => [r.pattern, r]));
  return patterns.filter((p) => {
    const rule = byPattern.get(p);
    return !rule || rule.categoryId !== categoryId || rule.source !== "bulk";
  }).length;
}

export interface BulkPreview {
  /** Rows selected (a transfer is one row). */
  matched: number;
  /** Rows the patch would change. */
  changed: number;
  byField: Partial<Record<BulkField, { changed: number; unchanged: number }>>;
  /** Categorization rules createRule would create or move. */
  rulesLearned: number;
}

/** Counts what bulkUpdateEntries would change, without writing (the "Aplicar a N" of the bulk edit dialog). */
export async function previewBulkUpdate(userId: string, ids: string[], patch: BulkPatch, db: DbClient, opts: { createRule?: boolean } = {}): Promise<BulkPreview> {
  const entries = await db.ledgerEntry.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
  const fields = bulkFields(patch);
  const changedRows = new Set<string>();
  const changedByField = new Map<BulkField, Set<string>>(fields.map((f) => [f, new Set<string>()]));
  for (const e of entries) {
    const p = bulkPatchFor(e, patch);
    for (const f of fields) {
      if (p[f] !== undefined) {
        changedByField.get(f)!.add(displayKey(e));
        changedRows.add(displayKey(e));
      }
    }
  }
  const matched = new Set(entries.map(displayKey)).size;
  const byField: BulkPreview["byField"] = {};
  for (const f of fields) {
    const changed = changedByField.get(f)!.size;
    byField[f] = { changed, unchanged: matched - changed };
  }
  const rulesLearned =
    opts.createRule && patch.categoryId ? await rulesToLearn(userId, entries.filter(categorizable).map((e) => e.description), patch.categoryId, db) : 0;
  return { matched, changed: changedRows.size, byField, rulesLearned };
}

export async function bulkUpdateEntries(userId: string, ids: string[], patch: BulkPatch, db: DbClient, opts: { createRule?: boolean } = {}) {
  return inTransaction(db, async (tx) => {
    const records: MutationRecordInput[] = [];
    const entries = await tx.ledgerEntry.findMany({ where: { id: { in: ids }, userId, deletedAt: null } });
    const changedRows = new Set<string>();
    for (const e of entries) {
      const p = bulkPatchFor(e, patch);
      if (!Object.keys(p).length) continue;
      await updateEntry(userId, e.id, p, tx, { collect: records });
      changedRows.add(displayKey(e));
    }
    // Rules it learns or moves are part of the batch: undo puts them back too.
    let rulesLearned = 0;
    if (opts.createRule && patch.categoryId) {
      for (const desc of new Set(entries.filter(categorizable).map((e) => e.description))) {
        const before = records.length;
        await learnRule(userId, desc, patch.categoryId, "bulk", tx, { collect: records });
        if (records.length > before) rulesLearned++;
      }
    }
    const changed = changedRows.size;
    const batchId = records.length ? await recordMutation(tx, userId, "update", `${changed} entries`, records) : null;
    return { batchId, changed, matched: new Set(entries.map(displayKey)).size, rulesLearned };
  });
}

export async function getEntry(userId: string, id: string, db: DbClient) {
  const entry = await db.ledgerEntry.findFirst({ where: { id, userId }, include: ENTRY_CONTEXT_INCLUDE });
  if (!entry) throw notFound("Transaction", "entry.not_found");
  return serializeEntry(entry);
}
