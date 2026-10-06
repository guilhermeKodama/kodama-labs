import type { Account, Entity, PrismaClient, TransferDirection } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import type { DbClient } from "@capital/server/lib/prisma";
import { getObjectBuffer } from "@/lib/storage";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { ensureSystemCategories } from "@capital/server/modules/categories/lib/system-categories";
import { importCardFile, importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { savedViewInputSchema } from "@capital/server/modules/ledger/contracts";
import { LedgerError, notFound } from "@capital/server/modules/ledger/lib/errors";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { createEntry, updateEntry } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount } from "@capital/server/modules/ledger/services/entities";
import { inTransaction, recordMutation, snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import { learnRule, loadRuleMatcher, recordRuleHits } from "@capital/server/modules/ledger/services/rules";
import { createView } from "@capital/server/modules/ledger/services/views";
import { bookCardPayment, findStatementPaymentEntry, linkStatementPayment, patchCreatedRecord } from "./card-payments";
import { externalIdHolder, freeExternalId } from "./external-ids";
import { resolveTransferSides, checkTransferDirection } from "./transfer-flow";

export interface CreatedRecordRef {
  model: string;
  id: string;
}

export interface ExecuteImportResult {
  /** Statement rows booked as entries: bank rows (transactions), card bill rows and bill payments. */
  imported: number;
  duplicatesSkipped: number;
  reconciled: number;
  transferReconciled: number;
  transfersCreated: number;
  creditCardsCreated: number;
  billsCreated: number;
  billTransactionsCreated: number;
  investmentTransfersCreated: number;
  investmentTransactionsCreated: number;
  fuzzyDuplicatesLinked: number;
  statementImportId: string;
  createdRecords: CreatedRecordRef[];
  /** The import's undo batch (source "import"): undoing it removes everything the import wrote. */
  batchId: string;
  /** Same as statementImportId. */
  importId: string;
  /** Account the statement was imported into, and its name for the done message. */
  accountId: string;
  accountName: string;
  /** Rules learned from categories picked in the review (createRule), new or moved. */
  rulesCreated: number;
  /** Bank rows booked as card bill payments (card_payment transfers). */
  cardPaymentsCreated: number;
  /** Card bill rows booked, and those skipped as already on the statement. */
  cardRowsCreated: number;
  cardRowsSkipped: number;
  /** Card statement the rows went to, and whether its payment got linked (linkPayment). */
  cardStatementId: string | null;
  paymentLinked: boolean;
  /** Every statement row written to the ledger: `imported` plus the transfers. */
  rowsImported: number;
  /** Rows left out as already imported (duplicates, card rows already on the statement). */
  skipped: number;
  /** The "Importação · <arquivo>" view filtered on this import (createView), else null. */
  viewId: string | null;
  /** That view's name, for the done message. */
  viewName: string | null;
}

export interface ExecuteImportOptions {
  /** Set when the import comes from the assistant, not the manual wizard. */
  source?: "manual" | "agent";
  conversationId?: string;
  importPlanId?: string;
  /** Create the "Importação · <arquivo>" saved view for this import (the import dialog). */
  createView?: boolean;
}

const VIEW_NAME: Record<"pt-BR" | "en", string> = { "pt-BR": "Importação · {file}", en: "Import · {file}" };

/** "nubank-fatura-2026-09.ofx" → "nubank-fatura-2026-09". */
function fileLabel(fileName: string | null | undefined, fallback: string): string {
  const base = (fileName ?? "").replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return base || fallback;
}

/**
 * Saved view showing exactly this import's rows, whatever their dates. Its
 * record joins the import's batch, so undoing the import removes it (and a
 * revert deletes it, see execute-revert.ts).
 */
async function createImportView(userId: string, importId: string, label: string, tx: DbClient, records: MutationRecordInput[]): Promise<{ id: string; name: string }> {
  const locale = await loadUserLocale(userId, tx);
  const name = VIEW_NAME[locale].replace("{file}", label).slice(0, 120);
  const view = await createView(
    userId,
    savedViewInputSchema.parse({
      name,
      dataset: "ledger",
      isFavorite: false,
      config: { period: { preset: "all", offset: 0 }, filters: [{ field: "importId", op: "in", values: [importId] }] },
    }),
    tx,
    { collect: records }
  );
  return { id: view.id, name: view.name };
}

/**
 * The account the plan books into: `accountId` when given (a bank account
 * or card of the plan's entity), else the entity's default checking.
 */
async function targetAccount(userId: string, entity: Entity, accountId: string | undefined, tx: DbClient): Promise<Account> {
  if (!accountId) return getDefaultAccount(entity, tx);
  const account = await tx.account.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound("Account", "account.not_found");
  if (account.archivedAt) throw new LedgerError(`Account "${account.name}" is archived`, 422, { code: "account.archived", params: { name: account.name } });
  if (account.entityId !== entity.id) {
    throw new LedgerError(`Account "${account.name}" belongs to another entity than the import`, 422, { code: "import.account_entity_mismatch", params: { name: account.name } });
  }
  if (account.type === "brokerage") {
    throw new LedgerError(`Account "${account.name}" cannot receive a statement import`, 422, { code: "import.account_kind_mismatch", params: { name: account.name } });
  }
  return account;
}

/** Direction relabels a reconciliation may apply: same from/to entity kinds only. */
function directionMatchesSides(direction: TransferDirection, fromKind: string, toKind: string, fromType: string, toType: string) {
  switch (direction) {
    case "profit_distribution":
    case "reimbursement":
      return fromKind === "business" && toKind === "personal";
    case "capital_injection":
      return fromKind === "personal" && toKind === "business";
    case "investment_deposit":
      return toType === "brokerage" && fromType !== "brokerage";
    case "investment_withdrawal":
      return fromType === "brokerage" && toType !== "brokerage";
    default:
      return true;
  }
}

/**
 * The write path shared by the v2 import route and the assistant's
 * commit_plan tool. Callers must have verified the plan (confirmed, for the
 * assistant). Runs as one transaction; every row it creates carries the
 * Import id, which is what reverting relies on. Everything it writes is
 * also one undo batch with source "import" (system categories it seeds and
 * rule hit counts aside).
 *
 * Bank rows book into `accountId` (default: the entity's main checking).
 * A plan for a credit card books `cardStatement` rows on one statement;
 * `cardPayments` become card_payment transfers that settle a statement.
 * An exact duplicate the plan imports anyway (duplicateDecisions
 * "import_anyway") is booked under `<externalId>~dup<n>`, since an account
 * holds each external id once. A row whose external id only a trashed row
 * of the account holds is restored from the trash with the file's values.
 */
export async function executeImport(
  userId: string,
  input: ImportPlanPayload,
  db: PrismaClient,
  options: ExecuteImportOptions = {}
): Promise<ExecuteImportResult> {
  return inTransaction(db, async (tx) => {
    const createdRecords: CreatedRecordRef[] = [];
    const records: MutationRecordInput[] = [];
    const entity = await tx.entity.findFirst({ where: { id: input.entityId, userId } });
    if (!entity || entity.kind !== input.entityType) {
      throw new LedgerError(input.entityType === "personal" ? "Personal account not found or access denied" : "Business not found or access denied", 404, { code: "entity.not_found" });
    }
    const target = await targetAccount(userId, entity, input.accountId, tx);
    const isCard = target.type === "credit_card";
    const bankOnly = input.transfers.length || input.investmentTransfers.length || input.reconciliations.length || input.transferReconciliations.length || input.cardPayments?.length;
    if ((isCard && bankOnly) || (!isCard && input.cardStatement)) {
      throw new LedgerError(`Account "${target.name}" cannot receive this import`, 422, { code: "import.account_kind_mismatch", params: { name: target.name } });
    }
    // Bank side of the import: the target, or for a card the account that pays it.
    const checking = isCard
      ? ((target.payFromAccountId && (await tx.account.findFirst({ where: { id: target.payFromAccountId, userId } }))) || (await getDefaultAccount(entity, tx)))
      : target;
    const locale = await loadUserLocale(userId, tx);

    // The account's first import sets its opening balance (once its rows are booked, below). A reverted
    // import put the balance back, so the import that replaces it counts as the first again.
    const setsOpeningBalance =
      input.ledgerBalance != null && !isCard && (await tx.import.count({ where: { accountId: target.id, revertedAt: null } })) === 0;

    await ensureSystemCategories(userId, tx);
    const matcher = await loadRuleMatcher(userId, tx);
    const categories = await tx.category.findMany({ where: { userId } });
    const ruleHits: string[] = [];

    // Server-side dedup safety net (the plan may be minutes old by commit).
    const cardPayments = input.cardPayments ?? [];
    const incomingIds = [...input.transactions.map((t) => t.externalId), ...cardPayments.map((p) => p.externalId)];
    const existing = incomingIds.length
      ? await tx.ledgerEntry.findMany({ where: { userId, externalId: { in: incomingIds }, deletedAt: null }, select: { externalId: true } })
      : [];
    const existingExternalIds = new Set(existing.map((e) => e.externalId));
    const importAnyway = new Set(input.duplicateDecisions.filter((d) => d.resolution === "import_anyway").map((d) => d.externalId));

    let fuzzyDuplicatesLinked = 0;
    const fuzzyLinked = new Set<string>();
    for (const decision of input.duplicateDecisions) {
      if (decision.resolution !== "link_fuzzy" || !decision.existingTransactionId) continue;
      const entry = await tx.ledgerEntry.findFirst({ where: { id: decision.existingTransactionId, userId } });
      if (!entry) throw new LedgerError(`Transaction ${decision.existingTransactionId} not found`, 404, { code: "entry.not_found" });
      const linked = await tx.ledgerEntry.update({ where: { id: entry.id }, data: { externalId: decision.externalId } });
      records.push({ model: "LedgerEntry", recordId: entry.id, before: snapshot(entry), after: snapshot(linked) });
      fuzzyLinked.add(decision.externalId);
      fuzzyDuplicatesLinked++;
    }

    const newTransactions = input.transactions.filter((t) => !fuzzyLinked.has(t.externalId) && (!existingExternalIds.has(t.externalId) || importAnyway.has(t.externalId)));
    const newCardPayments = cardPayments.filter((p) => !existingExternalIds.has(p.externalId));
    // Rows left out as duplicates: found by the safety net, or skipped in the review (skip_duplicate).
    const skippedIds = new Set([
      ...input.transactions.filter((t) => !fuzzyLinked.has(t.externalId) && existingExternalIds.has(t.externalId) && !importAnyway.has(t.externalId)).map((t) => t.externalId),
      ...input.duplicateDecisions.filter((d) => d.resolution === "skip_duplicate").map((d) => d.externalId),
    ]);
    const duplicatesSkipped = skippedIds.size;

    const imp = await tx.import.create({
      data: {
        userId,
        entityId: entity.id,
        accountId: target.id,
        bankName: input.bankName,
        fileName: input.fileName,
        transactionCount: newTransactions.length + newCardPayments.length + (input.cardStatement?.rows.length ?? 0),
        ledgerBalance: isCard ? null : input.ledgerBalance,
        ledgerCurrency: input.currency,
        categorizationStatus: "pending",
        source: options.source ?? "manual",
        conversationId: options.conversationId,
        importPlanId: options.importPlanId,
      },
    });
    createdRecords.push({ model: "Import", id: imp.id });
    records.push({ model: "Import", recordId: imp.id, before: null, after: snapshot(imp) });

    const createCard = async (card: { bankName: string; lastFourDigits: string; closingDay: number; dueDay: number; currency: string }) => {
      const created = await tx.account.create({
        data: {
          userId,
          entityId: entity.id,
          type: "credit_card",
          name: `${card.bankName} ****${card.lastFourDigits}`,
          institution: card.bankName,
          externalId: card.lastFourDigits,
          currency: card.currency,
          closingDay: card.closingDay,
          dueDay: card.dueDay,
          payFromAccountId: checking.id,
        },
      });
      createdRecords.push({ model: "Account", id: created.id });
      records.push({ model: "Account", recordId: created.id, before: null, after: snapshot(created) });
      return created;
    };

    let creditCardsCreated = 0;
    for (const card of input.creditCards) {
      await createCard(card);
      creditCardsCreated++;
    }

    let billsCreated = 0;
    let billTransactionsCreated = 0;
    for (const bill of input.bills) {
      let accountId = bill.creditCardId;
      if (!accountId && bill.newCreditCard) {
        accountId = (await createCard(bill.newCreditCard)).id;
        creditCardsCreated++;
      }
      if (!accountId) throw new LedgerError(`bills entry (fileId ${bill.fileId}) resolved to no creditCardId`, 422, { code: "import.bill_without_card", params: { fileId: bill.fileId } });
      const file = await tx.conversationFile.findFirst({ where: { id: bill.fileId, userId }, select: { blobUrl: true } });
      if (!file) throw new LedgerError(`File ${bill.fileId} not found or access denied`, 404, { code: "import.file_not_found", params: { fileId: bill.fileId } });
      const buffer = await getObjectBuffer(file.blobUrl);
      if (!buffer) throw new LedgerError(`File ${bill.fileId} content could not be read`, 422, { code: "import.file_unreadable", params: { fileId: bill.fileId } });
      const result = await importCardFile(userId, { accountId, closingDate: bill.closingDate, dueDate: bill.dueDate, content: buffer.toString("utf8"), importId: imp.id }, tx, { collect: records });
      createdRecords.push({ model: "CardStatement", id: result.statementId });
      billsCreated++;
      billTransactionsCreated += result.created;
    }

    const transferIds = [...input.transfers.map((t) => t.externalId), ...input.investmentTransfers.map((t) => t.externalId), ...newCardPayments.map((p) => p.externalId)];
    const existingTransfers = new Set(
      transferIds.length
        ? (await tx.transferGroup.findMany({ where: { userId, externalId: { in: transferIds }, deletedAt: null }, select: { externalId: true } })).map((g) => g.externalId)
        : []
    );

    // The imported entity's side of a transfer is the account being imported; the counterpart's is its main account.
    const sideAccount = (side: Entity) => (side.id === entity.id ? Promise.resolve(checking) : getDefaultAccount(side, tx));

    let transfersCreated = 0;
    for (const tr of input.transfers) {
      if (existingTransfers.has(tr.externalId)) continue;
      const sides = resolveTransferSides({
        flow: tr.flow,
        entityType: input.entityType,
        entityId: input.entityId,
        counterpartyEntityType: tr.counterpartyEntityType,
        counterpartyEntityId: tr.counterpartyEntityId,
      });
      const check = checkTransferDirection(tr.direction, { fromEntityType: sides.fromEntityType, toEntityType: sides.toEntityType });
      if (check.status === "violation") {
        throw new LedgerError(
          `Transfer ${tr.externalId} is inconsistent: ${check.message}. The statement row is an ${tr.flow === "outflow" ? "outflow" : "inflow"}, so either the direction or the counterparty is wrong.`,
          422,
          { code: "import.transfer_inconsistent", params: { externalId: tr.externalId } }
        );
      }
      const [fromEntity, toEntity] = await Promise.all([
        tx.entity.findFirst({ where: { id: sides.fromEntityId, userId } }),
        tx.entity.findFirst({ where: { id: sides.toEntityId, userId } }),
      ]);
      if (!fromEntity || !toEntity) throw new LedgerError(`Transfer ${tr.externalId} references an entity the user does not own`, 404, { code: "import.transfer_entity_not_owned", params: { externalId: tr.externalId } });
      const [from, to] = await Promise.all([sideAccount(fromEntity), sideAccount(toEntity)]);
      const created = await createEntry(
        userId,
        { kind: "transfer", fromAccountId: from.id, toAccountId: to.id, amount: tr.amount, currency: input.currency, exchangeRate: 1, description: tr.description, date: tr.date, direction: tr.direction },
        tx,
        { importId: imp.id, collect: records }
      );
      const group = await tx.transferGroup.update({ where: { id: created.transferGroupId! }, data: { externalId: tr.externalId } });
      patchCreatedRecord(records, "TransferGroup", group.id, group);
      createdRecords.push({ model: "TransferGroup", id: created.transferGroupId! });
      transfersCreated++;
    }

    let investmentTransfersCreated = 0;
    for (const it of input.investmentTransfers) {
      if (existingTransfers.has(it.externalId)) continue;
      const broker = await tx.account.findFirst({ where: { id: it.investmentAccountId, userId, type: "brokerage" } });
      if (!broker) throw new LedgerError(`Investment account ${it.investmentAccountId} not found or access denied`, 404, { code: "import.investment_account_not_found", params: { accountId: it.investmentAccountId } });
      const deposit = it.direction === "investment_deposit";
      const created = await createEntry(
        userId,
        {
          kind: "transfer",
          fromAccountId: deposit ? checking.id : broker.id,
          toAccountId: deposit ? broker.id : checking.id,
          amount: it.amount,
          currency: input.currency,
          exchangeRate: 1,
          description: it.description,
          date: it.date,
          direction: it.direction,
        },
        tx,
        { importId: imp.id, collect: records }
      );
      const group = await tx.transferGroup.update({ where: { id: created.transferGroupId! }, data: { externalId: it.externalId } });
      patchCreatedRecord(records, "TransferGroup", group.id, group);
      createdRecords.push({ model: "TransferGroup", id: created.transferGroupId! });
      investmentTransfersCreated++;
    }

    let cardPaymentsCreated = 0;
    for (const payment of newCardPayments) {
      if (existingTransfers.has(payment.externalId)) continue;
      const card = await tx.account.findFirst({ where: { id: payment.cardAccountId, userId } });
      if (!card || card.type !== "credit_card") {
        throw new LedgerError(`Card payment ${payment.externalId} needs a credit card account`, 422, { code: "import.card_payment_target", params: { externalId: payment.externalId } });
      }
      const booked = await bookCardPayment(userId, checking, card, { ...payment, currency: input.currency }, tx, {
        importId: imp.id,
        collect: records,
        defaultDescription: st(locale, "ledger.direction.card_payment"),
      });
      createdRecords.push({ model: "TransferGroup", id: booked.groupId });
      cardPaymentsCreated++;
    }

    let reconciled = 0;
    for (const rec of input.reconciliations) {
      const patch = { ...(rec.updates.amount !== undefined && { amount: rec.updates.amount }), ...(rec.updates.date && { date: parseLocalDate(rec.updates.date).toISOString().slice(0, 10) }), ...(rec.updates.description && { description: rec.updates.description }) };
      if (!Object.keys(patch).length) continue;
      await updateEntry(userId, rec.existingTransactionId, patch, tx, { collect: records });
      reconciled++;
    }

    let transferReconciled = 0;
    for (const rec of input.transferReconciliations) {
      const group = await tx.transferGroup.findFirst({ where: { id: rec.existingTransferId, userId }, include: { legs: { include: { account: true, entity: true } } } });
      if (!group) throw new LedgerError(`Transfer reconciliation target ${rec.existingTransferId} not found`, 404, { code: "import.reconcile_target_not_found", params: { transferId: rec.existingTransferId } });
      const fromLeg = group.legs.find((l) => Number(l.amount) < 0) ?? group.legs[0];
      const toLeg = group.legs.find((l) => l.id !== fromLeg.id) ?? group.legs[0];
      if (rec.updates.direction !== undefined) {
        if (!directionMatchesSides(rec.updates.direction, fromLeg.entity.kind, toLeg.entity.kind, fromLeg.account.type, toLeg.account.type)) {
          throw new LedgerError(
            `Cannot change transfer ${rec.existingTransferId} to direction "${rec.updates.direction}" via reconciliation - that would require moving it to a different counterparty side, which reconciliation does not support. Delete and recreate the transfer instead.`,
            422,
            { code: "import.reconcile_direction_change", params: { transferId: rec.existingTransferId, direction: rec.updates.direction } }
          );
        }
        const legKind = rec.updates.direction === "reimbursement" ? "expense" : "transfer";
        const { legs, ...groupRow } = group;
        const relabeled = await tx.transferGroup.update({ where: { id: group.id }, data: { direction: rec.updates.direction } });
        await tx.ledgerEntry.updateMany({ where: { transferGroupId: group.id }, data: { kind: legKind } });
        records.push({ model: "TransferGroup", recordId: group.id, before: snapshot(groupRow), after: snapshot(relabeled) });
        for (const { account: _account, entity: _entity, ...leg } of legs) {
          void _account;
          void _entity;
          records.push({ model: "LedgerEntry", recordId: leg.id, before: snapshot(leg), after: snapshot({ ...leg, kind: legKind }) });
        }
      }
      const patch = { ...(rec.updates.amount !== undefined && { amount: rec.updates.amount }), ...(rec.updates.date && { date: parseLocalDate(rec.updates.date).toISOString().slice(0, 10) }), ...(rec.updates.description && { description: rec.updates.description }) };
      if (Object.keys(patch).length) await updateEntry(userId, fromLeg.id, patch, tx, { collect: records });
      if (Object.keys(patch).length || rec.updates.direction !== undefined) transferReconciled++;
    }

    let rulesCreated = 0;
    const learn = async (description: string, categoryId: string) => {
      const before = records.length;
      await learnRule(userId, description, categoryId, "manual", tx, { collect: records });
      if (records.length > before) rulesCreated++;
    };

    let imported = 0;
    let uncategorized = 0;
    for (const t of newTransactions) {
      let categoryId: string | null = null;
      let ruleId: string | null = null;
      let auto = false;
      const rule = matcher.match(t.description, entity.id);
      if (t.categoryId) {
        const c = categories.find((x) => x.id === t.categoryId);
        if (!c) throw new LedgerError(`Category ${t.categoryId} not found or access denied`, 404, { code: "category.not_found" });
        if (c.isArchived) throw new LedgerError(`Category '${c.name}' is archived and cannot be assigned. Row: ${t.description}`, 422, { code: "category.archived", params: { name: c.name } });
        categoryId = c.id;
      } else if (t.category) {
        const type = t.type === "income" ? "income" : "expense";
        const c = categories.find((x) => x.name.toLowerCase() === t.category!.toLowerCase() && x.type === type) ?? categories.find((x) => x.name.toLowerCase() === t.category!.toLowerCase());
        if (c?.isArchived) {
          throw new LedgerError(`Category '${t.category}' is archived and cannot be assigned. Unarchive it or choose a visible category. Row: ${t.description}`, 422, { code: "category.archived", params: { name: c.name } });
        }
        categoryId = c?.id ?? null;
      }
      // No category chosen, or the one the matching rule gives (the review prefilled it): the rule's doing.
      if (rule && (!categoryId || categoryId === rule.categoryId)) {
        categoryId = rule.categoryId;
        ruleId = rule.id;
        auto = true;
        ruleHits.push(rule.id);
      }
      if (!categoryId) uncategorized++;

      // An external id held only by a trashed entry of the account (an import reverted before): that entry comes back.
      const exactDuplicate = existingExternalIds.has(t.externalId);
      const holder = await externalIdHolder(target.id, t.externalId, tx);
      const trashed = !exactDuplicate && holder?.deletedAt && !holder.transferGroupId ? holder : null;
      let entryId: string;
      if (trashed) {
        const untrashed = await tx.ledgerEntry.update({ where: { id: trashed.id }, data: { deletedAt: null, importId: imp.id } });
        records.push({ model: "LedgerEntry", recordId: trashed.id, before: snapshot(trashed), after: snapshot(untrashed) });
        await updateEntry(userId, trashed.id, { kind: t.type, amount: t.amount, currency: input.currency, date: t.date, description: t.description, categoryId }, tx, { collect: records, checkCategoryType: false });
        const before = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: trashed.id } });
        const stamped = await tx.ledgerEntry.update({ where: { id: trashed.id }, data: { isAutoCategorized: auto, categorizedByRuleId: ruleId } });
        records.push({ model: "LedgerEntry", recordId: trashed.id, before: snapshot(before), after: snapshot(stamped) });
        entryId = trashed.id;
      } else {
        const externalId = holder ? await freeExternalId(target.id, t.externalId, tx) : t.externalId;
        const created = await createEntry(
          userId,
          { kind: t.type, accountId: target.id, amount: t.amount, currency: input.currency, description: t.description, date: t.date, categoryId, externalId },
          tx,
          { importId: imp.id, collect: records, skipRules: true, isAutoCategorized: auto }
        );
        entryId = created.entryIds[0];
        if (ruleId) patchCreatedRecord(records, "LedgerEntry", entryId, await tx.ledgerEntry.update({ where: { id: entryId }, data: { categorizedByRuleId: ruleId } }));
      }
      if (t.createRule && t.categoryId && !ruleId) await learn(t.description, t.categoryId);
      createdRecords.push({ model: "LedgerEntry", id: entryId });
      imported++;
    }

    let cardRowsCreated = 0;
    let cardRowsSkipped = 0;
    let cardStatementId: string | null = null;
    let paymentLinked = false;
    if (input.cardStatement) {
      const bill = input.cardStatement;
      const result = await importCardStatement(
        userId,
        {
          accountId: target.id,
          month: bill.month,
          closingDate: bill.closingDate,
          dueDate: bill.dueDate,
          total: bill.total,
          rows: bill.rows.map((r) => ({ date: r.date, description: r.description, amount: r.amount, categoryId: r.categoryId, installment: r.installment, allowDuplicate: r.allowDuplicate })),
          importId: imp.id,
          fallback: "none",
        },
        tx,
        { collect: records }
      );
      cardStatementId = result.statementId;
      cardRowsCreated = result.created;
      cardRowsSkipped = result.skipped;
      createdRecords.push({ model: "CardStatement", id: result.statementId });
      for (const id of result.createdIds) createdRecords.push({ model: "LedgerEntry", id });
      for (const r of bill.rows) {
        if (!r.createRule || !r.categoryId) continue;
        const rule = matcher.match(r.description, entity.id);
        if (rule?.categoryId !== r.categoryId) await learn(r.description, r.categoryId);
      }
      if (await tx.ledgerEntry.count({ where: { importId: imp.id, categoryId: null, deletedAt: null, transferGroupId: null } })) uncategorized++;

      if (bill.linkPayment) {
        const statement = await tx.cardStatement.findUniqueOrThrow({ where: { id: result.statementId } });
        const total = statement.totalAmount != null ? Number(statement.totalAmount) : bill.rows.reduce((sum, r) => sum + r.amount, 0);
        const payment = await findStatementPaymentEntry(userId, target, statement, Math.round(total * 100) / 100, tx);
        if (payment) {
          await linkStatementPayment(userId, payment.id, statement, tx, records);
          paymentLinked = true;
        }
      }
    }
    if (ruleHits.length) await recordRuleHits(ruleHits, tx);

    let investmentTransactionsCreated = 0;
    for (const it of input.investmentTransactions) {
      let holdingId = it.holdingId;
      if (!holdingId && it.newHolding) {
        const holding = await createHolding(userId, { accountId: it.accountId, ...it.newHolding }, tx, { collect: records });
        createdRecords.push({ model: "InvestmentHolding", id: holding.id });
        holdingId = holding.id;
      }
      if (!holdingId) throw new LedgerError(`investmentTransactions entry for externalId ${it.externalId} resolved to no holding`, 422, { code: "import.holding_unresolved", params: { externalId: it.externalId } });
      const { operation } = await recordOperation(
        userId,
        { holdingId, type: it.type, quantity: it.quantity, pricePerUnit: it.pricePerUnit, totalAmount: it.totalAmount, fees: it.fees, date: it.date, externalId: it.externalId, importId: imp.id },
        tx,
        { collect: records }
      );
      createdRecords.push({ model: "InvestmentOperation", id: operation.id });
      investmentTransactionsCreated++;
    }

    // Opening balance such that the account ends the statement at its ledger balance: the
    // statement's closing balance minus everything the account holds up to its last row.
    if (setsOpeningBalance) {
      const dates = [...input.transactions, ...input.transfers, ...input.investmentTransfers, ...cardPayments].map((r) => r.date).sort();
      const last = dates[dates.length - 1];
      const held = await tx.ledgerEntry.aggregate({
        where: { accountId: target.id, deletedAt: null, ...(last && { date: { lte: parseLocalDate(last) } }) },
        _sum: { amount: true },
      });
      const updated = await tx.account.update({ where: { id: target.id }, data: { initialBalance: round(input.ledgerBalance! - toNumber(held._sum.amount), 4) } });
      records.push({ model: "Account", recordId: target.id, before: snapshot(target), after: snapshot(updated) });
    }

    // Statement rows booked as entries (the assistant's plans only ever have the first kind).
    imported += cardRowsCreated + cardPaymentsCreated;
    const rowsImported = imported + transfersCreated + investmentTransfersCreated;
    const finished = await tx.import.update({
      where: { id: imp.id },
      data: { transactionCount: rowsImported + billTransactionsCreated, ...(uncategorized === 0 && { categorizationStatus: "completed" }) },
    });
    patchCreatedRecord(records, "Import", imp.id, finished);

    const view = options.createView ? await createImportView(userId, imp.id, fileLabel(input.fileName, input.bankName ?? target.name), tx, records) : null;
    const batchId = await recordMutation(tx, userId, "import", `Import ${imp.fileName ?? imp.bankName ?? imp.id}`, records, { source: "import" });
    return {
      imported,
      duplicatesSkipped,
      reconciled,
      transferReconciled,
      transfersCreated,
      creditCardsCreated,
      billsCreated,
      billTransactionsCreated,
      investmentTransfersCreated,
      investmentTransactionsCreated,
      fuzzyDuplicatesLinked,
      statementImportId: imp.id,
      createdRecords,
      batchId,
      importId: imp.id,
      accountId: target.id,
      accountName: target.name,
      rulesCreated,
      cardPaymentsCreated,
      cardRowsCreated,
      cardRowsSkipped,
      cardStatementId,
      paymentLinked,
      rowsImported,
      skipped: duplicatesSkipped + cardRowsSkipped,
      viewId: view?.id ?? null,
      viewName: view?.name ?? null,
    };
  });
}
