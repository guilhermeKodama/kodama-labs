-- New UI: user preferences (locale, light theme, pt-BR formats), view seeding,
-- rule/undo provenance, recurring FX at booking, effective-dated budget
-- tombstones, the six allocation classes, investment income details, FX
-- sources, portfolio history and benchmarks, notification preferences and
-- API tokens. Data steps are written by hand next to the DDL they depend on.

-- CreateEnum
CREATE TYPE "AllocationClass" AS ENUM ('fixed_income', 'br_stocks', 'fii', 'international', 'crypto', 'cash');

-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('dividend', 'jcp', 'fii_income', 'interest');

-- ============================================
-- users
-- ============================================

ALTER TABLE "users" ADD COLUMN     "fxAutoUpdate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'pt-BR',
ADD COLUMN     "viewsSeedVersion" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "baseCurrency" SET DEFAULT 'BRL',
ALTER COLUMN "theme" SET DEFAULT 'light',
ALTER COLUMN "dateFormat" SET DEFAULT 'dd/MM/yyyy',
ALTER COLUMN "numberFormat" SET DEFAULT 'pt-BR';

-- Every user starts on the light theme (it matches the mockup pixel for pixel).
UPDATE "users" SET "theme" = 'light' WHERE "theme" <> 'light';

-- Formats still on the old defaults move to the new ones; a format the user
-- picked stays. baseCurrency is never rewritten: amountBase depends on it.
UPDATE "users" SET "dateFormat" = 'dd/MM/yyyy' WHERE "dateFormat" = 'yyyy-MM-dd';
UPDATE "users" SET "numberFormat" = 'pt-BR' WHERE "numberFormat" = 'en-US';

-- ============================================
-- ledger_entries, mutation_batches, saved_views
-- ============================================

ALTER TABLE "ledger_entries" ADD COLUMN     "categorizedByRuleId" TEXT;

CREATE INDEX "ledger_entries_categorizedByRuleId_idx" ON "ledger_entries"("categorizedByRuleId");

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_categorizedByRuleId_fkey" FOREIGN KEY ("categorizedByRuleId") REFERENCES "categorization_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mutation_batches" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'user';

ALTER TABLE "saved_views" ADD COLUMN     "seedKey" TEXT;

CREATE UNIQUE INDEX "saved_views_userId_seedKey_key" ON "saved_views"("userId", "seedKey");

-- ============================================
-- recurring_rules
-- ============================================

ALTER TABLE "recurring_rules" ADD COLUMN     "isTaxDeductible" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "exchangeRate" DROP NOT NULL,
ALTER COLUMN "exchangeRate" DROP DEFAULT;

-- A null rate means "use the rate in force when the occurrence is booked".
-- Only the old column default (1) on a rule in a currency other than its
-- account's or the base currency is cleared; any other rate was set on
-- purpose and stays. (For a rule in the base currency, null books at 1 too.)
UPDATE "recurring_rules" r
SET "exchangeRate" = NULL
FROM "accounts" a, "users" u
WHERE a."id" = r."accountId"
  AND u."id" = r."userId"
  AND r."exchangeRate" = 1
  AND (r."currency" <> a."currency" OR r."currency" <> u."baseCurrency");

-- ============================================
-- budgets
-- ============================================

-- The unique key gains userId and period (a monthly and a yearly budget may
-- start on the same day). Every existing row already satisfies it, since the
-- old key is a subset of the new one.
DROP INDEX "budgets_entityId_categoryId_effectiveFrom_key";

ALTER TABLE "budgets" ADD COLUMN     "isTombstone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT;

CREATE UNIQUE INDEX "budgets_userId_entityId_categoryId_period_effectiveFrom_key" ON "budgets"("userId", "entityId", "categoryId", "period", "effectiveFrom");

-- ============================================
-- investments
-- ============================================

ALTER TABLE "investment_holdings" ADD COLUMN     "allocationClass" "AllocationClass";

ALTER TABLE "investment_operations" ADD COLUMN     "fundingGroupId" TEXT,
ADD COLUMN     "incomeType" "IncomeType",
ADD COLUMN     "taxWithheld" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "investment_operations_fundingGroupId_key" ON "investment_operations"("fundingGroupId");

ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_fundingGroupId_fkey" FOREIGN KEY ("fundingGroupId") REFERENCES "transfer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Targets move from the 9 AssetClass values to the 6 AllocationClass values
-- (same mapping as investments/lib/allocation-class.ts). Targets whose classes
-- collapse into one are summed into a new row, then the old rows go.
-- A target has no currency, so `etf` follows the currency holding most of the
-- user's ETF money (then most ETF holdings): BRL -> br_stocks, otherwise
-- international. With no ETF holdings it stays br_stocks, since the old enum
-- had international_etf for foreign ETFs.
DROP INDEX "portfolio_targets_userId_assetClass_key";

ALTER TABLE "portfolio_targets" ALTER COLUMN "assetClass" DROP NOT NULL,
ADD COLUMN     "allocationClass" "AllocationClass";

INSERT INTO "portfolio_targets" ("id", "userId", "allocationClass", "targetPercent")
SELECT gen_random_uuid()::text, t."userId", m."allocationClass", sum(t."targetPercent")
FROM "portfolio_targets" t
CROSS JOIN LATERAL (
  SELECT (CASE t."assetClass"
    WHEN 'fixed_income' THEN 'fixed_income'
    WHEN 'savings' THEN 'fixed_income'
    WHEN 'stocks' THEN 'br_stocks'
    WHEN 'fii' THEN 'fii'
    WHEN 'bdr' THEN 'international'
    WHEN 'international_stocks' THEN 'international'
    WHEN 'international_etf' THEN 'international'
    WHEN 'crypto' THEN 'crypto'
    WHEN 'etf' THEN (
      SELECT CASE
        WHEN (coalesce(sum(h."totalInvested") FILTER (WHERE h."currency" <> 'BRL'), 0), count(*) FILTER (WHERE h."currency" <> 'BRL'))
           > (coalesce(sum(h."totalInvested") FILTER (WHERE h."currency" = 'BRL'), 0), count(*) FILTER (WHERE h."currency" = 'BRL'))
        THEN 'international'
        ELSE 'br_stocks'
      END
      FROM "investment_holdings" h
      JOIN "accounts" a ON a."id" = h."accountId"
      WHERE a."userId" = t."userId" AND h."assetClass" = 'etf'
    )
  END)::"AllocationClass" AS "allocationClass"
) m
WHERE t."allocationClass" IS NULL
GROUP BY t."userId", m."allocationClass";

DELETE FROM "portfolio_targets" WHERE "allocationClass" IS NULL;

ALTER TABLE "portfolio_targets" DROP COLUMN "assetClass",
ALTER COLUMN "allocationClass" SET NOT NULL;

CREATE UNIQUE INDEX "portfolio_targets_userId_allocationClass_key" ON "portfolio_targets"("userId", "allocationClass");

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "marketValueBase" DECIMAL(18,4) NOT NULL,
    "cashBase" DECIMAL(18,4) NOT NULL,
    "costBasisBase" DECIMAL(18,4) NOT NULL,
    "contributedBase" DECIMAL(18,4) NOT NULL,
    "netFlowBase" DECIMAL(18,4) NOT NULL,
    "byClass" JSONB NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "portfolio_snapshots_entityId_idx" ON "portfolio_snapshots"("entityId");

CREATE UNIQUE INDEX "portfolio_snapshots_userId_entityId_period_key" ON "portfolio_snapshots"("userId", "entityId", "period");

ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "market_index_values" (
    "id" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(18,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_index_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_index_values_series_date_key" ON "market_index_values"("series", "date");

-- ============================================
-- currencies
-- ============================================

-- Existing rates were all typed by the user, so `manual` is right for them.
ALTER TABLE "currencies" ADD COLUMN     "rateUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- ============================================
-- notifications
-- ============================================

-- CreateTable
CREATE TABLE "notification_settings" (
    "userId" TEXT NOT NULL,
    "dueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dueDaysBefore" INTEGER NOT NULL DEFAULT 1,
    "dueHour" INTEGER NOT NULL DEFAULT 9,
    "overdueEnabled" BOOLEAN NOT NULL DEFAULT true,
    "billClosedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "budgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "budgetThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDow" INTEGER NOT NULL DEFAULT 1,
    "weeklyHour" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "notification_dispatches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_dispatches_userId_kind_dedupeKey_key" ON "notification_dispatches"("userId", "kind", "dedupeKey");

ALTER TABLE "notification_dispatches" ADD CONSTRAINT "notification_dispatches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- API tokens
-- ============================================

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

CREATE INDEX "api_tokens_userId_idx" ON "api_tokens"("userId");

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientVersion" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_clients_tokenId_clientName_key" ON "api_clients"("tokenId", "clientName");

ALTER TABLE "api_clients" ADD CONSTRAINT "api_clients_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
