import type { PrismaClient, TransferDirection } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { getObjectBuffer } from "@/lib/storage";
import { createTransfer } from "@capital/server/modules/transfers/services/create-transfer";
import { updateTransferService } from "@capital/server/modules/transfers/services/update-transfer";
import { createInvestmentHolding } from "@capital/server/modules/investments/services/create-investment-holding";
import { createInvestmentTransaction } from "@capital/server/modules/investments/services/create-investment-transaction";
import { processBillCsv } from "@capital/server/modules/credit-cards/services/process-bill-csv";
import { normalizeDescription } from "../utils";
import { resolveTransferSides, checkTransferDirection } from "./transfer-flow";
import type { ImportPlanPayload } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";

const SYSTEM_EXPENSE_CATEGORIES = [
  "Credit Card",
  "Subscriptions",
  "Groceries",
  "Restaurants & Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Health & Pharmacy",
  "Travel",
  "Education",
  "Personal Care",
  "Home",
  "Fees & Charges",
  "Other",
];

const SYSTEM_INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Investment Returns",
  "Transfers",
  "Other Income",
];

async function ensureSystemCategories(userId: string, db: DbClient) {
  const existing = await db.category.findMany({
    where: { userId },
    select: { name: true, type: true },
  });
  const existingKeys = new Set(existing.map((c) => `${c.type}:${c.name}`));

  const toCreate: Array<{
    userId: string;
    name: string;
    type: "expense" | "income";
    isDefault: boolean;
    isSystem: boolean;
  }> = [];

  for (const name of SYSTEM_EXPENSE_CATEGORIES) {
    if (!existingKeys.has(`expense:${name}`)) {
      toCreate.push({ userId, name, type: "expense", isDefault: true, isSystem: true });
    }
  }
  for (const name of SYSTEM_INCOME_CATEGORIES) {
    if (!existingKeys.has(`income:${name}`)) {
      toCreate.push({ userId, name, type: "income", isDefault: true, isSystem: true });
    }
  }

  if (toCreate.length > 0) {
    await db.category.createMany({ data: toCreate, skipDuplicates: true });
  }
}

interface TransferShapeFields {
  fromBusinessId: string | null;
  fromPersonalAccountId: string | null;
  toBusinessId: string | null;
  toPersonalAccountId: string | null;
  toInvestmentAccountId: string | null;
  fromInvestmentAccountId: string | null;
}

/**
 * A transfer reconciliation may relabel `direction` only when the new
 * direction expects exactly the from/to fields the transfer already has
 * populated - e.g. profit_distribution <-> reimbursement (both
 * business->personal) is safe, but switching to capital_injection would
 * also require swapping which side is the business and which is personal,
 * which reconciliation does not attempt (it only ever calls
 * updateTransferService with the direction field, never new entity ids).
 */
function directionMatchesExistingShape(
  direction: TransferDirection,
  transfer: TransferShapeFields
): boolean {
  switch (direction) {
    case "profit_distribution":
    case "reimbursement":
      return !!transfer.fromBusinessId && !!transfer.toPersonalAccountId;
    case "capital_injection":
      return !!transfer.fromPersonalAccountId && !!transfer.toBusinessId;
    case "investment_deposit":
      return (
        !!transfer.toInvestmentAccountId &&
        (!!transfer.fromBusinessId || !!transfer.fromPersonalAccountId)
      );
    case "investment_withdrawal":
      return (
        !!transfer.fromInvestmentAccountId &&
        (!!transfer.toBusinessId || !!transfer.toPersonalAccountId)
      );
  }
}

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

/**
 * The write path shared by the manual-wizard REST route
 * (routes/v1/post-import.ts) and the assistant's commit_plan tool. Both
 * callers must have already verified entity ownership and, for the
 * assistant path, that the originating ImportPlan is "confirmed" - this
 * function does not re-check confirmation state, only entity ownership
 * (defense in depth) and per-row invariants.
 *
 * Runs as a single transaction: either the whole batch lands or none of
 * it does, so a mid-import failure never leaves a half-applied plan.
 */
export async function executeImport(
  userId: string,
  input: ImportPlanPayload,
  db: PrismaClient,
  options: ExecuteImportOptions = {}
): Promise<ExecuteImportResult> {
  return db.$transaction(
    async (tx) => {
      const createdRecords: CreatedRecordRef[] = [];

      // Verify entity ownership.
      if (input.entityType === "personal") {
        const pa = await tx.personalAccount.findFirst({
          where: { id: input.entityId, userId },
          select: { id: true },
        });
        if (!pa) throw new Error("Personal account not found or access denied");
      } else {
        const biz = await tx.business.findFirst({
          where: { id: input.entityId, userId },
          select: { id: true },
        });
        if (!biz) throw new Error("Business not found or access denied");
      }

      // Auto-set initialBalance on the entity's first-ever import.
      if (input.ledgerBalance != null) {
        const priorImports = await tx.statementImport.count({
          where:
            input.entityType === "personal"
              ? { personalAccountId: input.entityId }
              : { businessId: input.entityId },
        });
        if (priorImports === 0) {
          if (input.entityType === "personal") {
            await tx.personalAccount.update({
              where: { id: input.entityId },
              data: { initialBalance: input.ledgerBalance },
            });
          } else {
            await tx.business.update({
              where: { id: input.entityId },
              data: { initialBalance: input.ledgerBalance },
            });
          }
        }
      }

      await ensureSystemCategories(userId, tx);

      const mappings = await tx.merchantCategoryMapping.findMany({
        where: { userId },
        select: { normalizedDescription: true, category: true },
      });
      const mappingLookup = new Map(mappings.map((m) => [m.normalizedDescription, m.category]));

      // Server-side dedup safety net (propose_import_plan already checked
      // this at proposal time, but the plan can be minutes old by commit).
      const incomingIds = input.transactions.map((t) => t.externalId);
      const existingTxs =
        incomingIds.length > 0
          ? await tx.transaction.findMany({
              where: {
                externalId: { in: incomingIds },
                OR: [{ business: { userId } }, { personalAccount: { userId } }],
              },
              select: { externalId: true },
            })
          : [];
      const existingExternalIds = new Set(existingTxs.map((t) => t.externalId));

      // link_fuzzy decisions: attach the incoming externalId to an
      // existing, previously-unlinked transaction instead of creating a
      // new row.
      let fuzzyDuplicatesLinked = 0;
      const fuzzyLinkedExternalIds = new Set<string>();
      for (const decision of input.duplicateDecisions) {
        if (decision.resolution !== "link_fuzzy" || !decision.existingTransactionId) continue;
        await tx.transaction.update({
          where: { id: decision.existingTransactionId },
          data: { externalId: decision.externalId },
        });
        fuzzyLinkedExternalIds.add(decision.externalId);
        fuzzyDuplicatesLinked++;
      }

      const newTransactions = input.transactions.filter(
        (t) => !existingExternalIds.has(t.externalId) && !fuzzyLinkedExternalIds.has(t.externalId)
      );
      const duplicatesSkipped =
        input.transactions.length - newTransactions.length - fuzzyDuplicatesLinked;

      const statementImport = await tx.statementImport.create({
        data: {
          userId,
          entityType: input.entityType,
          bankName: input.bankName,
          fileName: input.fileName,
          transactionCount: newTransactions.length,
          ledgerBalance: input.ledgerBalance,
          ledgerCurrency: input.currency,
          categorizationStatus: "pending",
          source: options.source ?? "manual",
          conversationId: options.conversationId,
          importPlanId: options.importPlanId,
          businessId: input.entityType === "business" ? input.entityId : undefined,
          personalAccountId: input.entityType === "personal" ? input.entityId : undefined,
        },
      });
      createdRecords.push({ model: "StatementImport", id: statementImport.id });

      let creditCardsCreated = 0;
      for (const card of input.creditCards) {
        const created = await tx.creditCard.create({
          data: {
            entityType: input.entityType,
            bankName: card.bankName,
            lastFourDigits: card.lastFourDigits,
            creditLimit: 0,
            closingDay: card.closingDay,
            dueDay: card.dueDay,
            currency: card.currency,
            businessId: input.entityType === "business" ? input.entityId : undefined,
            personalAccountId: input.entityType === "personal" ? input.entityId : undefined,
          },
        });
        createdRecords.push({ model: "CreditCard", id: created.id });
        creditCardsCreated++;
      }

      // Bills carry intent, not parsed rows - processBillCsv (shared with
      // the manual wizard) re-parses the file at commit time so
      // replace-on-reupload, installment continuity and
      // manual-categorization preservation only exist in one place.
      let billsCreated = 0;
      let billTransactionsCreated = 0;
      for (const bill of input.bills) {
        let creditCardId = bill.creditCardId;
        if (!creditCardId && bill.newCreditCard) {
          const createdCard = await tx.creditCard.create({
            data: {
              entityType: input.entityType,
              bankName: bill.newCreditCard.bankName,
              lastFourDigits: bill.newCreditCard.lastFourDigits,
              creditLimit: 0,
              closingDay: bill.newCreditCard.closingDay,
              dueDay: bill.newCreditCard.dueDay,
              currency: bill.newCreditCard.currency,
              businessId: input.entityType === "business" ? input.entityId : undefined,
              personalAccountId: input.entityType === "personal" ? input.entityId : undefined,
            },
          });
          createdRecords.push({ model: "CreditCard", id: createdCard.id });
          creditCardsCreated++;
          creditCardId = createdCard.id;
        }
        if (!creditCardId) {
          throw new Error(`bills entry (fileId ${bill.fileId}) resolved to no creditCardId`);
        }

        const file = await tx.conversationFile.findFirst({
          where: { id: bill.fileId, userId },
          select: { blobUrl: true, originalName: true },
        });
        if (!file) {
          throw new Error(`File ${bill.fileId} not found or access denied`);
        }
        const buffer = await getObjectBuffer(file.blobUrl);
        if (!buffer) {
          throw new Error(`File ${bill.fileId} content could not be read`);
        }

        const result = await processBillCsv(
          userId,
          {
            creditCardId,
            closingDate: parseLocalDate(bill.closingDate),
            dueDate: parseLocalDate(bill.dueDate),
            csvContent: buffer.toString("utf8"),
            csvFileName: file.originalName,
          },
          tx
        );
        // Deleting this CreditCardBill cascades its BillTransaction and
        // Installment rows (see execute-revert.ts) - they don't need
        // their own createdRecords entries.
        createdRecords.push({ model: "CreditCardBill", id: result.bill.id });
        billsCreated++;
        billTransactionsCreated += result.transactionCount;
      }

      const transferExternalIds = [
        ...input.transfers.map((t) => t.externalId),
        ...input.investmentTransfers.map((t) => t.externalId),
      ];
      const existingTransferFitIds = new Set<string>();
      if (transferExternalIds.length > 0) {
        const found = await tx.transfer.findMany({
          where: { externalId: { in: transferExternalIds } },
          select: { externalId: true },
        });
        for (const f of found) if (f.externalId) existingTransferFitIds.add(f.externalId);
      }

      let transfersCreated = 0;
      for (const tr of input.transfers) {
        if (existingTransferFitIds.has(tr.externalId)) continue;
        // Payer/payee come from `flow` (which way the money moved on the
        // statement), never from `direction` (why it moved). Reading
        // them off the label assumed the imported statement was always
        // the personal one, so on a business statement every transfer
        // landed pointing the wrong way - an outgoing profit
        // distribution was written as money coming in.
        const { fromEntityType, fromEntityId, toEntityType, toEntityId } = resolveTransferSides({
          flow: tr.flow,
          entityType: input.entityType,
          entityId: input.entityId,
          counterpartyEntityType: tr.counterpartyEntityType,
          counterpartyEntityId: tr.counterpartyEntityId,
        });
        // Defense in depth: propose_import_plan already rejects a label
        // that contradicts the sides, but the manual wizard route posts
        // straight here without that validation.
        const directionCheck = checkTransferDirection(tr.direction, {
          fromEntityType,
          toEntityType,
        });
        if (directionCheck.status === "violation") {
          throw new Error(
            `Transfer ${tr.externalId} is inconsistent: ${directionCheck.message}. The statement row is an ${tr.flow === "outflow" ? "outflow" : "inflow"}, so either the direction or the counterparty is wrong.`
          );
        }

        const created = await tx.transfer.create({
          data: {
            fromEntityType,
            toEntityType,
            direction: tr.direction,
            amount: tr.amount,
            currency: input.currency,
            exchangeRate: 1,
            description: tr.description,
            date: parseLocalDate(tr.date),
            externalId: tr.externalId,
            fromBusinessId: fromEntityType === "business" ? fromEntityId : undefined,
            fromPersonalAccountId: fromEntityType === "personal" ? fromEntityId : undefined,
            toBusinessId: toEntityType === "business" ? toEntityId : undefined,
            toPersonalAccountId: toEntityType === "personal" ? toEntityId : undefined,
          },
        });
        createdRecords.push({ model: "Transfer", id: created.id });
        transfersCreated++;
      }

      let investmentTransfersCreated = 0;
      for (const it of input.investmentTransfers) {
        if (existingTransferFitIds.has(it.externalId)) continue;
        const isDeposit = it.direction === "investment_deposit";
        const created = await createTransfer(
          userId,
          {
            fromEntityType: input.entityType,
            toEntityType: input.entityType,
            direction: it.direction,
            amount: it.amount,
            currency: input.currency,
            exchangeRate: 1,
            description: it.description,
            date: parseLocalDate(it.date),
            fromBusinessId: isDeposit && input.entityType === "business" ? input.entityId : undefined,
            fromPersonalAccountId:
              isDeposit && input.entityType === "personal" ? input.entityId : undefined,
            toBusinessId: !isDeposit && input.entityType === "business" ? input.entityId : undefined,
            toPersonalAccountId:
              !isDeposit && input.entityType === "personal" ? input.entityId : undefined,
            toInvestmentAccountId: isDeposit ? it.investmentAccountId : undefined,
            fromInvestmentAccountId: !isDeposit ? it.investmentAccountId : undefined,
            externalId: it.externalId,
          },
          tx
        );
        createdRecords.push({ model: "Transfer", id: created.id });
        investmentTransfersCreated++;
      }

      let reconciledCount = 0;
      for (const rec of input.reconciliations) {
        const updateData: Record<string, unknown> = {};
        if (rec.updates.amount !== undefined) updateData.amount = rec.updates.amount;
        if (rec.updates.date !== undefined) updateData.date = parseLocalDate(rec.updates.date);
        if (rec.updates.description !== undefined) updateData.description = rec.updates.description;
        if (Object.keys(updateData).length > 0) {
          await tx.transaction.update({ where: { id: rec.existingTransactionId }, data: updateData });
          reconciledCount++;
        }
      }

      let transferReconciledCount = 0;
      for (const rec of input.transferReconciliations) {
        const updateData: Parameters<typeof updateTransferService>[2] = {};
        if (rec.updates.amount !== undefined) updateData.amount = rec.updates.amount;
        if (rec.updates.date !== undefined) updateData.date = parseLocalDate(rec.updates.date);
        if (rec.updates.description !== undefined) updateData.description = rec.updates.description;

        if (rec.updates.direction !== undefined) {
          const existing = await tx.transfer.findUnique({
            where: { id: rec.existingTransferId },
            select: {
              fromBusinessId: true,
              fromPersonalAccountId: true,
              toBusinessId: true,
              toPersonalAccountId: true,
              toInvestmentAccountId: true,
              fromInvestmentAccountId: true,
            },
          });
          if (!existing) {
            throw new Error(`Transfer reconciliation target ${rec.existingTransferId} not found`);
          }
          if (!directionMatchesExistingShape(rec.updates.direction, existing)) {
            throw new Error(
              `Cannot change transfer ${rec.existingTransferId} to direction "${rec.updates.direction}" via reconciliation - that would require moving it to a different counterparty side, which reconciliation does not support. Delete and recreate the transfer instead.`
            );
          }
          updateData.direction = rec.updates.direction;
        }

        if (Object.keys(updateData).length > 0) {
          await updateTransferService(userId, rec.existingTransferId, updateData, tx);
          transferReconciledCount++;
        }
      }

      let importedCount = 0;
      if (newTransactions.length > 0) {
        const txData = newTransactions.map((t) => {
          const mapped = mappingLookup.get(normalizeDescription(t.description));
          return {
            entityType: input.entityType,
            type: t.type,
            amount: t.amount,
            currency: input.currency,
            description: t.description,
            category: t.category ?? mapped ?? "Uncategorized",
            date: parseLocalDate(t.date),
            externalId: t.externalId,
            statementImportId: statementImport.id,
            businessId: input.entityType === "business" ? input.entityId : undefined,
            personalAccountId: input.entityType === "personal" ? input.entityId : undefined,
          };
        });

        // createMany doesn't return row ids, and we need them for
        // createdRecords/undo - insert individually inside the
        // transaction rather than switching to createMany+refetch.
        for (const data of txData) {
          const created = await tx.transaction.create({ data });
          createdRecords.push({ model: "Transaction", id: created.id });
        }
        importedCount = txData.length;

        const allCategorized = txData.every((t) => t.category !== "Uncategorized");
        if (allCategorized) {
          await tx.statementImport.update({
            where: { id: statementImport.id },
            data: { categorizationStatus: "completed" },
          });
        }
      } else {
        await tx.statementImport.update({
          where: { id: statementImport.id },
          data: { categorizationStatus: "completed" },
        });
      }

      // Investment transactions (from a PDF playbook plan).
      let investmentTransactionsCreated = 0;
      for (const it of input.investmentTransactions) {
        let holdingId = it.holdingId;
        if (!holdingId && it.newHolding) {
          const holding = await createInvestmentHolding(
            userId,
            { accountId: it.accountId, ...it.newHolding },
            tx
          );
          createdRecords.push({ model: "InvestmentHolding", id: holding.id });
          holdingId = holding.id;
        }
        if (!holdingId) {
          throw new Error(
            `investmentTransactions entry for externalId ${it.externalId} resolved to no holding`
          );
        }

        const created = await createInvestmentTransaction(
          userId,
          {
            holdingId,
            type: it.type,
            quantity: it.quantity,
            pricePerUnit: it.pricePerUnit,
            totalAmount: it.totalAmount,
            fees: it.fees,
            date: parseLocalDate(it.date),
            externalId: it.externalId,
          },
          tx
        );
        createdRecords.push({ model: "InvestmentTransaction", id: created.id });
        investmentTransactionsCreated++;
      }

      return {
        imported: importedCount,
        duplicatesSkipped,
        reconciled: reconciledCount,
        transferReconciled: transferReconciledCount,
        transfersCreated,
        creditCardsCreated,
        billsCreated,
        billTransactionsCreated,
        investmentTransfersCreated,
        investmentTransactionsCreated,
        fuzzyDuplicatesLinked,
        statementImportId: statementImport.id,
        createdRecords,
      };
    },
    { timeout: 30_000 }
  );
}
