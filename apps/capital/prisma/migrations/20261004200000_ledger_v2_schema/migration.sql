-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('checking', 'credit_card', 'brokerage', 'cash');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('income', 'expense', 'transfer', 'investment');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransferDirection" ADD VALUE 'card_payment';
ALTER TYPE "TransferDirection" ADD VALUE 'between_accounts';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "ledgerEntryId" TEXT,
ADD COLUMN     "recurringRuleId" TEXT,
ADD COLUMN     "transferGroupId" TEXT;

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "rollover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "investment_transactions" ADD COLUMN     "cashEntryId" TEXT;

-- AlterTable
ALTER TABLE "reminder_dispatches" ADD COLUMN     "recurringRuleId" TEXT;

-- AlterTable
ALTER TABLE "statement_imports" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "entityId" TEXT;

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "EntityType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "color" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "externalId" TEXT,
    "initialBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "creditLimit" DECIMAL(18,4),
    "closingDay" INTEGER,
    "dueDay" INTEGER,
    "payFromAccountId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amountBase" DECIMAL(18,4) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "merchantName" TEXT,
    "categoryId" TEXT,
    "isTaxDeductible" BOOLEAN NOT NULL DEFAULT false,
    "isAutoCategorized" BOOLEAN NOT NULL DEFAULT false,
    "transferGroupId" TEXT,
    "cardStatementId" TEXT,
    "installmentPlanId" TEXT,
    "installmentNumber" INTEGER,
    "recurringRuleId" TEXT,
    "importId" TEXT,
    "externalId" TEXT,
    "metadata" JSONB,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_groups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "recurringRuleId" TEXT,
    "importId" TEXT,
    "externalId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_statements" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closingDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(18,4),
    "paymentGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "totalInstallments" INTEGER NOT NULL,
    "installmentAmount" DECIMAL(18,4) NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "transferDirection" "TransferDirection",
    "toAccountId" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "lastGeneratedDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoGenerate" BOOLEAN NOT NULL DEFAULT true,
    "reminders" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorization_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT,
    "matchType" TEXT NOT NULL DEFAULT 'equals',
    "pattern" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorization_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dataset" TEXT NOT NULL DEFAULT 'ledger',
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "builtinKey" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mutation_batches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "summary" TEXT,
    "undoneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutation_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mutation_records" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "mutation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_targets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "targetPercent" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "portfolio_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entities_userId_idx" ON "entities"("userId");

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "accounts_entityId_idx" ON "accounts"("entityId");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE INDEX "ledger_entries_userId_date_idx" ON "ledger_entries"("userId", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_userId_effectiveDate_idx" ON "ledger_entries"("userId", "effectiveDate");

-- CreateIndex
CREATE INDEX "ledger_entries_accountId_date_idx" ON "ledger_entries"("accountId", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_entityId_idx" ON "ledger_entries"("entityId");

-- CreateIndex
CREATE INDEX "ledger_entries_categoryId_idx" ON "ledger_entries"("categoryId");

-- CreateIndex
CREATE INDEX "ledger_entries_transferGroupId_idx" ON "ledger_entries"("transferGroupId");

-- CreateIndex
CREATE INDEX "ledger_entries_cardStatementId_idx" ON "ledger_entries"("cardStatementId");

-- CreateIndex
CREATE INDEX "ledger_entries_installmentPlanId_idx" ON "ledger_entries"("installmentPlanId");

-- CreateIndex
CREATE INDEX "ledger_entries_recurringRuleId_idx" ON "ledger_entries"("recurringRuleId");

-- CreateIndex
CREATE INDEX "ledger_entries_importId_idx" ON "ledger_entries"("importId");

-- CreateIndex
CREATE INDEX "ledger_entries_deletedAt_idx" ON "ledger_entries"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_accountId_externalId_key" ON "ledger_entries"("accountId", "externalId");

-- CreateIndex
CREATE INDEX "transfer_groups_userId_date_idx" ON "transfer_groups"("userId", "date");

-- CreateIndex
CREATE INDEX "transfer_groups_recurringRuleId_idx" ON "transfer_groups"("recurringRuleId");

-- CreateIndex
CREATE INDEX "transfer_groups_importId_idx" ON "transfer_groups"("importId");

-- CreateIndex
CREATE INDEX "transfer_groups_externalId_idx" ON "transfer_groups"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "card_statements_paymentGroupId_key" ON "card_statements"("paymentGroupId");

-- CreateIndex
CREATE INDEX "card_statements_month_idx" ON "card_statements"("month");

-- CreateIndex
CREATE UNIQUE INDEX "card_statements_accountId_month_key" ON "card_statements"("accountId", "month");

-- CreateIndex
CREATE INDEX "installment_plans_userId_idx" ON "installment_plans"("userId");

-- CreateIndex
CREATE INDEX "installment_plans_accountId_idx" ON "installment_plans"("accountId");

-- CreateIndex
CREATE INDEX "recurring_rules_userId_idx" ON "recurring_rules"("userId");

-- CreateIndex
CREATE INDEX "recurring_rules_isActive_nextDueDate_idx" ON "recurring_rules"("isActive", "nextDueDate");

-- CreateIndex
CREATE INDEX "categorization_rules_userId_idx" ON "categorization_rules"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "categorization_rules_userId_matchType_pattern_key" ON "categorization_rules"("userId", "matchType", "pattern");

-- CreateIndex
CREATE INDEX "saved_views_userId_dataset_idx" ON "saved_views"("userId", "dataset");

-- CreateIndex
CREATE UNIQUE INDEX "saved_views_userId_builtinKey_key" ON "saved_views"("userId", "builtinKey");

-- CreateIndex
CREATE INDEX "mutation_batches_userId_createdAt_idx" ON "mutation_batches"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "mutation_records_batchId_idx" ON "mutation_records"("batchId");

-- CreateIndex
CREATE INDEX "mutation_records_model_recordId_idx" ON "mutation_records"("model", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_targets_userId_assetClass_key" ON "portfolio_targets"("userId", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_cashEntryId_key" ON "investment_transactions"("cashEntryId");

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "recurring_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "ledger_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transferGroupId_fkey" FOREIGN KEY ("transferGroupId") REFERENCES "transfer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "recurring_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_payFromAccountId_fkey" FOREIGN KEY ("payFromAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transferGroupId_fkey" FOREIGN KEY ("transferGroupId") REFERENCES "transfer_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cardStatementId_fkey" FOREIGN KEY ("cardStatementId") REFERENCES "card_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "installment_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "recurring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_importId_fkey" FOREIGN KEY ("importId") REFERENCES "statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_groups" ADD CONSTRAINT "transfer_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_groups" ADD CONSTRAINT "transfer_groups_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "recurring_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_groups" ADD CONSTRAINT "transfer_groups_importId_fkey" FOREIGN KEY ("importId") REFERENCES "statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_paymentGroupId_fkey" FOREIGN KEY ("paymentGroupId") REFERENCES "transfer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_plans" ADD CONSTRAINT "installment_plans_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutation_batches" ADD CONSTRAINT "mutation_batches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mutation_records" ADD CONSTRAINT "mutation_records_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "mutation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_targets" ADD CONSTRAINT "portfolio_targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

