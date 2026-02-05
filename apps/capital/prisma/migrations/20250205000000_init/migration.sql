-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('business', 'personal');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense', 'investment');

-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('profit_distribution', 'capital_injection', 'reimbursement');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('monthly', 'yearly');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "theme" TEXT NOT NULL DEFAULT 'system',
    "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
    "numberFormat" TEXT NOT NULL DEFAULT 'en-US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "color" TEXT,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isTaxDeductible" BOOLEAN NOT NULL DEFAULT false,
    "recurringTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "personalAccountId" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "fromEntityType" "EntityType" NOT NULL,
    "toEntityType" "EntityType" NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "recurringTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fromBusinessId" TEXT,
    "fromPersonalAccountId" TEXT,
    "toBusinessId" TEXT,
    "toPersonalAccountId" TEXT,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_transfers" (
    "id" TEXT NOT NULL,
    "fromEntityType" "EntityType" NOT NULL,
    "toEntityType" "EntityType" NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "description" TEXT,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "lastGeneratedDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fromBusinessId" TEXT,
    "fromPersonalAccountId" TEXT,
    "toBusinessId" TEXT,
    "toPersonalAccountId" TEXT,

    CONSTRAINT "recurring_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_transactions" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3) NOT NULL,
    "lastGeneratedDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "personalAccountId" TEXT,

    CONSTRAINT "recurring_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "period" "BudgetPeriod" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "personalAccountId" TEXT,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "color" TEXT,
    "icon" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "manualRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "businesses_userId_idx" ON "businesses"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "personal_accounts_userId_key" ON "personal_accounts"("userId");

-- CreateIndex
CREATE INDEX "transactions_businessId_idx" ON "transactions"("businessId");

-- CreateIndex
CREATE INDEX "transactions_personalAccountId_idx" ON "transactions"("personalAccountId");

-- CreateIndex
CREATE INDEX "transactions_entityType_idx" ON "transactions"("entityType");

-- CreateIndex
CREATE INDEX "transactions_type_idx" ON "transactions"("type");

-- CreateIndex
CREATE INDEX "transactions_date_idx" ON "transactions"("date");

-- CreateIndex
CREATE INDEX "transactions_category_idx" ON "transactions"("category");

-- CreateIndex
CREATE INDEX "transfers_fromBusinessId_idx" ON "transfers"("fromBusinessId");

-- CreateIndex
CREATE INDEX "transfers_fromPersonalAccountId_idx" ON "transfers"("fromPersonalAccountId");

-- CreateIndex
CREATE INDEX "transfers_toBusinessId_idx" ON "transfers"("toBusinessId");

-- CreateIndex
CREATE INDEX "transfers_toPersonalAccountId_idx" ON "transfers"("toPersonalAccountId");

-- CreateIndex
CREATE INDEX "transfers_date_idx" ON "transfers"("date");

-- CreateIndex
CREATE INDEX "transfers_recurringTransferId_idx" ON "transfers"("recurringTransferId");

-- CreateIndex
CREATE INDEX "recurring_transfers_fromBusinessId_idx" ON "recurring_transfers"("fromBusinessId");

-- CreateIndex
CREATE INDEX "recurring_transfers_fromPersonalAccountId_idx" ON "recurring_transfers"("fromPersonalAccountId");

-- CreateIndex
CREATE INDEX "recurring_transfers_toBusinessId_idx" ON "recurring_transfers"("toBusinessId");

-- CreateIndex
CREATE INDEX "recurring_transfers_toPersonalAccountId_idx" ON "recurring_transfers"("toPersonalAccountId");

-- CreateIndex
CREATE INDEX "recurring_transfers_isActive_idx" ON "recurring_transfers"("isActive");

-- CreateIndex
CREATE INDEX "recurring_transfers_nextDueDate_idx" ON "recurring_transfers"("nextDueDate");

-- CreateIndex
CREATE INDEX "recurring_transactions_businessId_idx" ON "recurring_transactions"("businessId");

-- CreateIndex
CREATE INDEX "recurring_transactions_personalAccountId_idx" ON "recurring_transactions"("personalAccountId");

-- CreateIndex
CREATE INDEX "recurring_transactions_entityType_idx" ON "recurring_transactions"("entityType");

-- CreateIndex
CREATE INDEX "recurring_transactions_isActive_idx" ON "recurring_transactions"("isActive");

-- CreateIndex
CREATE INDEX "recurring_transactions_nextDueDate_idx" ON "recurring_transactions"("nextDueDate");

-- CreateIndex
CREATE INDEX "budgets_businessId_idx" ON "budgets"("businessId");

-- CreateIndex
CREATE INDEX "budgets_personalAccountId_idx" ON "budgets"("personalAccountId");

-- CreateIndex
CREATE INDEX "budgets_entityType_idx" ON "budgets"("entityType");

-- CreateIndex
CREATE INDEX "budgets_year_month_idx" ON "budgets"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_businessId_category_period_year_month_key" ON "budgets"("businessId", "category", "period", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_personalAccountId_category_period_year_month_key" ON "budgets"("personalAccountId", "category", "period", "year", "month");

-- CreateIndex
CREATE INDEX "categories_userId_idx" ON "categories"("userId");

-- CreateIndex
CREATE INDEX "categories_type_idx" ON "categories"("type");

-- CreateIndex
CREATE UNIQUE INDEX "categories_userId_name_type_key" ON "categories"("userId", "name", "type");

-- CreateIndex
CREATE INDEX "currencies_userId_idx" ON "currencies"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "currencies_userId_code_key" ON "currencies"("userId", "code");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_accounts" ADD CONSTRAINT "personal_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "recurring_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromBusinessId_fkey" FOREIGN KEY ("fromBusinessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromPersonalAccountId_fkey" FOREIGN KEY ("fromPersonalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toBusinessId_fkey" FOREIGN KEY ("toBusinessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toPersonalAccountId_fkey" FOREIGN KEY ("toPersonalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_recurringTransferId_fkey" FOREIGN KEY ("recurringTransferId") REFERENCES "recurring_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_fromBusinessId_fkey" FOREIGN KEY ("fromBusinessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_fromPersonalAccountId_fkey" FOREIGN KEY ("fromPersonalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_toBusinessId_fkey" FOREIGN KEY ("toBusinessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_toPersonalAccountId_fkey" FOREIGN KEY ("toPersonalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currencies" ADD CONSTRAINT "currencies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
