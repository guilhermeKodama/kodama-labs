import type { PrismaClient, TransferDirection } from "@/generated/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { getObjectBuffer } from "@/lib/storage";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { ensureSystemCategories } from "@capital/server/modules/categories/lib/system-categories";
import { importCardFile } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createEntry, updateEntry } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount } from "@capital/server/modules/ledger/services/entities";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";
import { loadRuleMatcher, recordRuleHits } from "@capital/server/modules/ledger/services/rules";
import { resolveTransferSides, checkTransferDirection } from "./transfer-flow";

export interface CreatedRecordRef {
  model: string;
  id: string;
}

export interface ExecuteImportResult {
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
}

export interface ExecuteImportOptions {
  /** Set when the import comes from the assistant, not the manual wizard. */
  source?: "manual" | "agent";
  conversationId?: string;
  importPlanId?: string;
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
 * Import id, which is what reverting relies on.
 */
export async function executeImport(
  userId: string,
  input: ImportPlanPayload,
  db: PrismaClient,
  options: ExecuteImportOptions = {}
): Promise<ExecuteImportResult> {
  return inTransaction(db, async (tx) => {
    const createdRecords: CreatedRecordRef[] = [];
    const entity = await tx.entity.findFirst({ where: { id: input.entityId, userId } });
    if (!entity || entity.kind !== input.entityType) {
      throw new LedgerError(input.entityType === "personal" ? "Personal account not found or access denied" : "Business not found or access denied", 404, { code: "entity.not_found" });
    }
    const checking = await getDefaultAccount(entity, tx);

    if (input.ledgerBalance != null) {
      const prior = await tx.import.count({ where: { entityId: entity.id } });
      if (prior === 0) await tx.account.update({ where: { id: checking.id }, data: { initialBalance: input.ledgerBalance } });
    }

    await ensureSystemCategories(userId, tx);
    const matcher = await loadRuleMatcher(userId, tx);
    const categories = await tx.category.findMany({ where: { userId } });
    const ruleHits: string[] = [];

    // Server-side dedup safety net (the plan may be minutes old by commit).
    const incomingIds = input.transactions.map((t) => t.externalId);
    const existing = incomingIds.length
      ? await tx.ledgerEntry.findMany({ where: { userId, externalId: { in: incomingIds }, deletedAt: null }, select: { externalId: true } })
      : [];
    const existingExternalIds = new Set(existing.map((e) => e.externalId));

    let fuzzyDuplicatesLinked = 0;
    const fuzzyLinked = new Set<string>();
    for (const decision of input.duplicateDecisions) {
      if (decision.resolution !== "link_fuzzy" || !decision.existingTransactionId) continue;
      const target = await tx.ledgerEntry.findFirst({ where: { id: decision.existingTransactionId, userId } });
      if (!target) throw new LedgerError(`Transaction ${decision.existingTransactionId} not found`, 404, { code: "entry.not_found" });
      await tx.ledgerEntry.update({ where: { id: target.id }, data: { externalId: decision.externalId } });
      fuzzyLinked.add(decision.externalId);
      fuzzyDuplicatesLinked++;
    }

    const newTransactions = input.transactions.filter((t) => !existingExternalIds.has(t.externalId) && !fuzzyLinked.has(t.externalId));
    const duplicatesSkipped = input.transactions.length - newTransactions.length - fuzzyDuplicatesLinked;

    const imp = await tx.import.create({
      data: {
        userId,
        entityId: entity.id,
        accountId: checking.id,
        bankName: input.bankName,
        fileName: input.fileName,
        transactionCount: newTransactions.length,
        ledgerBalance: input.ledgerBalance,
        ledgerCurrency: input.currency,
        categorizationStatus: "pending",
        source: options.source ?? "manual",
        conversationId: options.conversationId,
        importPlanId: options.importPlanId,
      },
    });
    createdRecords.push({ model: "Import", id: imp.id });

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
      const result = await importCardFile(userId, { accountId, closingDate: bill.closingDate, dueDate: bill.dueDate, content: buffer.toString("utf8"), importId: imp.id }, tx);
      createdRecords.push({ model: "CardStatement", id: result.statementId });
      billsCreated++;
      billTransactionsCreated += result.created;
    }

    const transferIds = [...input.transfers.map((t) => t.externalId), ...input.investmentTransfers.map((t) => t.externalId)];
    const existingTransfers = new Set(
      transferIds.length
        ? (await tx.transferGroup.findMany({ where: { userId, externalId: { in: transferIds }, deletedAt: null }, select: { externalId: true } })).map((g) => g.externalId)
        : []
    );

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
      const [from, to] = await Promise.all([getDefaultAccount(fromEntity, tx), getDefaultAccount(toEntity, tx)]);
      const created = await createEntry(
        userId,
        { kind: "transfer", fromAccountId: from.id, toAccountId: to.id, amount: tr.amount, currency: input.currency, exchangeRate: 1, description: tr.description, date: tr.date, direction: tr.direction },
        tx,
        { importId: imp.id, record: false }
      );
      await tx.transferGroup.update({ where: { id: created.transferGroupId! }, data: { externalId: tr.externalId } });
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
        { importId: imp.id, record: false }
      );
      await tx.transferGroup.update({ where: { id: created.transferGroupId! }, data: { externalId: it.externalId } });
      createdRecords.push({ model: "TransferGroup", id: created.transferGroupId! });
      investmentTransfersCreated++;
    }

    let reconciled = 0;
    for (const rec of input.reconciliations) {
      const patch = { ...(rec.updates.amount !== undefined && { amount: rec.updates.amount }), ...(rec.updates.date && { date: parseLocalDate(rec.updates.date).toISOString().slice(0, 10) }), ...(rec.updates.description && { description: rec.updates.description }) };
      if (!Object.keys(patch).length) continue;
      await updateEntry(userId, rec.existingTransactionId, patch, tx, { record: false });
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
        await tx.transferGroup.update({ where: { id: group.id }, data: { direction: rec.updates.direction } });
        await tx.ledgerEntry.updateMany({ where: { transferGroupId: group.id }, data: { kind: legKind } });
      }
      const patch = { ...(rec.updates.amount !== undefined && { amount: rec.updates.amount }), ...(rec.updates.date && { date: parseLocalDate(rec.updates.date).toISOString().slice(0, 10) }), ...(rec.updates.description && { description: rec.updates.description }) };
      if (Object.keys(patch).length) await updateEntry(userId, fromLeg.id, patch, tx, { record: false });
      if (Object.keys(patch).length || rec.updates.direction !== undefined) transferReconciled++;
    }

    let imported = 0;
    let uncategorized = 0;
    for (const t of newTransactions) {
      let categoryId: string | null = null;
      let auto = false;
      if (t.category) {
        const type = t.type === "income" ? "income" : "expense";
        const c = categories.find((x) => x.name.toLowerCase() === t.category!.toLowerCase() && x.type === type) ?? categories.find((x) => x.name.toLowerCase() === t.category!.toLowerCase());
        if (c?.isArchived) {
          throw new LedgerError(`Category '${t.category}' is archived and cannot be assigned. Unarchive it or choose a visible category. Row: ${t.description}`, 422, { code: "category.archived", params: { name: c.name } });
        }
        categoryId = c?.id ?? null;
      }
      if (!categoryId) {
        const rule = matcher.match(t.description, entity.id);
        if (rule) {
          categoryId = rule.categoryId;
          auto = true;
          ruleHits.push(rule.id);
        }
      }
      if (!categoryId) uncategorized++;
      const created = await createEntry(
        userId,
        { kind: t.type, accountId: checking.id, amount: t.amount, currency: input.currency, description: t.description, date: t.date, categoryId, externalId: t.externalId },
        tx,
        { importId: imp.id, record: false, skipRules: true, isAutoCategorized: auto }
      );
      createdRecords.push({ model: "LedgerEntry", id: created.entryIds[0] });
      imported++;
    }
    if (ruleHits.length) await recordRuleHits(ruleHits, tx);
    if (uncategorized === 0) await tx.import.update({ where: { id: imp.id }, data: { categorizationStatus: "completed" } });

    let investmentTransactionsCreated = 0;
    for (const it of input.investmentTransactions) {
      let holdingId = it.holdingId;
      if (!holdingId && it.newHolding) {
        const holding = await createHolding(userId, { accountId: it.accountId, ...it.newHolding }, tx);
        createdRecords.push({ model: "InvestmentHolding", id: holding.id });
        holdingId = holding.id;
      }
      if (!holdingId) throw new LedgerError(`investmentTransactions entry for externalId ${it.externalId} resolved to no holding`, 422, { code: "import.holding_unresolved", params: { externalId: it.externalId } });
      const { operation } = await recordOperation(
        userId,
        { holdingId, type: it.type, quantity: it.quantity, pricePerUnit: it.pricePerUnit, totalAmount: it.totalAmount, fees: it.fees, date: it.date, externalId: it.externalId, importId: imp.id },
        tx,
        { record: false }
      );
      createdRecords.push({ model: "InvestmentOperation", id: operation.id });
      investmentTransactionsCreated++;
    }

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
    };
  });
}
