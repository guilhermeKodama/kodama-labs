-- Ledger v2: retire the pre-ledger tables.
--
-- investment_transactions -> investment_operations and statement_imports ->
-- imports are copied row by row (same ids). Every other pre-ledger table is
-- moved, untouched, to the `legacy` schema (invisible to Prisma) so the data
-- stays queryable for audits until it is dropped deliberately with
-- `pnpm db:drop-legacy` (scripts/drop-legacy.sql).

BEGIN;

-- CreateTable
CREATE TABLE "investment_operations" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "type" "InvestmentTransactionType" NOT NULL,
    "quantity" DOUBLE PRECISION,
    "pricePerUnit" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "externalId" TEXT,
    "cashEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT,
    "accountId" TEXT,
    "bankName" TEXT,
    "fileName" TEXT,
    "transactionCount" INTEGER NOT NULL,
    "ledgerBalance" DOUBLE PRECISION,
    "ledgerCurrency" TEXT,
    "categorizationStatus" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT,
    "importPlanId" TEXT,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investment_operations_cashEntryId_key" ON "investment_operations"("cashEntryId");

-- CreateIndex
CREATE INDEX "investment_operations_holdingId_idx" ON "investment_operations"("holdingId");

-- CreateIndex
CREATE INDEX "investment_operations_type_idx" ON "investment_operations"("type");

-- CreateIndex
CREATE INDEX "investment_operations_date_idx" ON "investment_operations"("date");

-- CreateIndex
CREATE INDEX "investment_operations_externalId_idx" ON "investment_operations"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_operations_holdingId_externalId_key" ON "investment_operations"("holdingId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "imports_importPlanId_key" ON "imports"("importPlanId");

-- CreateIndex
CREATE INDEX "imports_userId_idx" ON "imports"("userId");

-- CreateIndex
CREATE INDEX "imports_categorizationStatus_idx" ON "imports"("categorizationStatus");

-- CreateIndex
CREATE INDEX "imports_entityId_idx" ON "imports"("entityId");

-- CreateIndex
CREATE INDEX "imports_conversationId_idx" ON "imports"("conversationId");

-- CopyData
INSERT INTO "imports" (id, "userId", "entityId", "accountId", "bankName", "fileName", "transactionCount", "ledgerBalance", "ledgerCurrency",
                       "categorizationStatus", source, "revertedAt", "createdAt", "updatedAt", "conversationId", "importPlanId")
SELECT id, "userId", "entityId", "accountId", "bankName", "fileName", "transactionCount", "ledgerBalance", "ledgerCurrency",
       "categorizationStatus", source, "revertedAt", "createdAt", "updatedAt", "conversationId", "importPlanId"
FROM "statement_imports";

INSERT INTO "investment_operations" (id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, notes, "externalId",
                                     "cashEntryId", "createdAt", "updatedAt")
SELECT id, "holdingId", type, quantity, "pricePerUnit", "totalAmount", fees, date, notes, "externalId", "cashEntryId", "createdAt", "updatedAt"
FROM "investment_transactions";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_recurringTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_recurringTransferId_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_transferId_fkey";

-- DropForeignKey
ALTER TABLE "bill_transactions" DROP CONSTRAINT "bill_transactions_billId_fkey";

-- DropForeignKey
ALTER TABLE "bill_transactions" DROP CONSTRAINT "bill_transactions_statementId_fkey";

-- DropForeignKey
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_businessId_fkey";

-- DropForeignKey
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "businesses" DROP CONSTRAINT "businesses_userId_fkey";

-- DropForeignKey
ALTER TABLE "credit_card_bills" DROP CONSTRAINT "credit_card_bills_creditCardId_fkey";

-- DropForeignKey
ALTER TABLE "credit_card_bills" DROP CONSTRAINT "credit_card_bills_transactionId_fkey";

-- DropForeignKey
ALTER TABLE "credit_card_statements" DROP CONSTRAINT "credit_card_statements_billPaymentTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "credit_card_statements" DROP CONSTRAINT "credit_card_statements_creditCardId_fkey";

-- DropForeignKey
ALTER TABLE "credit_cards" DROP CONSTRAINT "credit_cards_businessId_fkey";

-- DropForeignKey
ALTER TABLE "credit_cards" DROP CONSTRAINT "credit_cards_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "installments" DROP CONSTRAINT "installments_billTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "installments" DROP CONSTRAINT "installments_creditCardId_fkey";

-- DropForeignKey
ALTER TABLE "investment_accounts" DROP CONSTRAINT "investment_accounts_businessId_fkey";

-- DropForeignKey
ALTER TABLE "investment_accounts" DROP CONSTRAINT "investment_accounts_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "investment_accounts" DROP CONSTRAINT "investment_accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "investment_holdings" DROP CONSTRAINT "investment_holdings_accountId_fkey";

-- DropForeignKey
ALTER TABLE "investment_transactions" DROP CONSTRAINT "investment_transactions_cashEntryId_fkey";

-- DropForeignKey
ALTER TABLE "investment_transactions" DROP CONSTRAINT "investment_transactions_holdingId_fkey";

-- DropForeignKey
ALTER TABLE "investment_transactions" DROP CONSTRAINT "investment_transactions_linkedTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_importId_fkey";

-- DropForeignKey
ALTER TABLE "merchant_category_mappings" DROP CONSTRAINT "merchant_category_mappings_userId_fkey";

-- DropForeignKey
ALTER TABLE "personal_accounts" DROP CONSTRAINT "personal_accounts_userId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transactions" DROP CONSTRAINT "recurring_transactions_businessId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transactions" DROP CONSTRAINT "recurring_transactions_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transfers" DROP CONSTRAINT "recurring_transfers_fromBusinessId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transfers" DROP CONSTRAINT "recurring_transfers_fromPersonalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transfers" DROP CONSTRAINT "recurring_transfers_toBusinessId_fkey";

-- DropForeignKey
ALTER TABLE "recurring_transfers" DROP CONSTRAINT "recurring_transfers_toPersonalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "reminder_dispatches" DROP CONSTRAINT "reminder_dispatches_recurringTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_accountId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_businessId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_entityId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_importPlanId_fkey";

-- DropForeignKey
ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_businessId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_personalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_recurringTransactionId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_statementImportId_fkey";

-- DropForeignKey
ALTER TABLE "transfer_groups" DROP CONSTRAINT "transfer_groups_importId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_fromBusinessId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_fromInvestmentAccountId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_fromPersonalAccountId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_recurringTransferId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_toBusinessId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_toInvestmentAccountId_fkey";

-- DropForeignKey
ALTER TABLE "transfers" DROP CONSTRAINT "transfers_toPersonalAccountId_fkey";

-- DropIndex
DROP INDEX "attachments_recurringTransactionId_idx";

-- DropIndex
DROP INDEX "attachments_recurringTransferId_idx";

-- DropIndex
DROP INDEX "attachments_transactionId_idx";

-- DropIndex
DROP INDEX "attachments_transferId_idx";

-- DropIndex
DROP INDEX "budgets_businessId_category_effectiveFrom_key";

-- DropIndex
DROP INDEX "budgets_businessId_idx";

-- DropIndex
DROP INDEX "budgets_entityType_idx";

-- DropIndex
DROP INDEX "budgets_personalAccountId_category_effectiveFrom_key";

-- DropIndex
DROP INDEX "budgets_personalAccountId_idx";

-- DropIndex
DROP INDEX "reminder_dispatches_recurringTransactionId_occurrenceDate_d_key";

-- AlterTable
ALTER TABLE "attachments" DROP COLUMN "recurringTransactionId",
DROP COLUMN "recurringTransferId",
DROP COLUMN "transactionId",
DROP COLUMN "transferId";

-- AlterTable
ALTER TABLE "budgets" DROP COLUMN "businessId",
DROP COLUMN "category",
DROP COLUMN "entityType",
DROP COLUMN "personalAccountId",
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,4),
ALTER COLUMN "categoryId" SET NOT NULL,
ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "reminder_dispatches" DROP COLUMN "recurringTransactionId",
ALTER COLUMN "recurringRuleId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "attachments_ledgerEntryId_idx" ON "attachments"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "attachments_transferGroupId_idx" ON "attachments"("transferGroupId");

-- CreateIndex
CREATE INDEX "attachments_recurringRuleId_idx" ON "attachments"("recurringRuleId");

-- CreateIndex
CREATE INDEX "budgets_userId_idx" ON "budgets"("userId");

-- CreateIndex
CREATE INDEX "budgets_entityId_idx" ON "budgets"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_entityId_categoryId_effectiveFrom_key" ON "budgets"("entityId", "categoryId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_dispatches_recurringRuleId_occurrenceDate_daysBefo_key" ON "reminder_dispatches"("recurringRuleId", "occurrenceDate", "daysBefore");

-- The legacy bill status column used an enum that no longer exists in the app.
ALTER TABLE "credit_card_bills" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE text;

-- MoveLegacyTables
ALTER TABLE "bill_transactions" SET SCHEMA legacy;
ALTER TABLE "businesses" SET SCHEMA legacy;
ALTER TABLE "credit_card_bills" SET SCHEMA legacy;
ALTER TABLE "credit_card_statements" SET SCHEMA legacy;
ALTER TABLE "credit_cards" SET SCHEMA legacy;
ALTER TABLE "installments" SET SCHEMA legacy;
ALTER TABLE "investment_accounts" SET SCHEMA legacy;
ALTER TABLE "investment_transactions" SET SCHEMA legacy;
ALTER TABLE "merchant_category_mappings" SET SCHEMA legacy;
ALTER TABLE "personal_accounts" SET SCHEMA legacy;
ALTER TABLE "recurring_transactions" SET SCHEMA legacy;
ALTER TABLE "recurring_transfers" SET SCHEMA legacy;
ALTER TABLE "statement_imports" SET SCHEMA legacy;
ALTER TABLE "transactions" SET SCHEMA legacy;
ALTER TABLE "transfers" SET SCHEMA legacy;

-- DropEnum
DROP TYPE "BillStatus";

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_groups" ADD CONSTRAINT "transfer_groups_importId_fkey" FOREIGN KEY ("importId") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "investment_holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_importPlanId_fkey" FOREIGN KEY ("importPlanId") REFERENCES "import_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
