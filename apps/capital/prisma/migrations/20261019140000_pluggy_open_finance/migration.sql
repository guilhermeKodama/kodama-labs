-- Meu Pluggy connections. Item ids live here (they change when consent is
-- renewed). Client id and secret stay in the environment.

CREATE TYPE "ClassificationSource" AS ENUM ('rule', 'llm', 'manual');
CREATE TYPE "PluggyItemStatus" AS ENUM ('idle', 'ok', 'expiring', 'expired', 'error');
CREATE TYPE "PluggyReviewStatus" AS ENUM ('open', 'resolved', 'ignored');

ALTER TABLE "investment_operations"
  ADD COLUMN "classificationSource" "ClassificationSource",
  ADD COLUMN "classificationConfidence" DOUBLE PRECISION,
  ADD COLUMN "syncLocked" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "pluggy_items" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "entityKind" "EntityType" NOT NULL,
  "status" "PluggyItemStatus" NOT NULL DEFAULT 'idle',
  "consentExpiresAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "incomeCategoryId" TEXT,
  "brokerageAccountId" TEXT,
  "syncingAt" TIMESTAMP(3),
  "syncCutoff" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pluggy_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pluggy_account_links" (
  "id" TEXT NOT NULL,
  "itemRowId" TEXT NOT NULL,
  "pluggyAccountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "subtype" TEXT,
  "currency" TEXT,
  "numberLast4" TEXT,
  "capitalAccountId" TEXT,
  CONSTRAINT "pluggy_account_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pluggy_investment_links" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pluggyInvestmentId" TEXT NOT NULL,
  "holdingId" TEXT NOT NULL,
  CONSTRAINT "pluggy_investment_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pluggy_external_refs" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "pluggyId" TEXT NOT NULL,
  "ledgerEntryId" TEXT,
  "operationId" TEXT,
  "matchKind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pluggy_external_refs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pluggy_sync_runs" (
  "id" TEXT NOT NULL,
  "itemRowId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "stats" JSONB,
  "error" TEXT,
  CONSTRAINT "pluggy_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pluggy_reviews" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemRowId" TEXT,
  "kind" TEXT NOT NULL,
  "status" "PluggyReviewStatus" NOT NULL DEFAULT 'open',
  "draft" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "pluggy_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pluggy_items_userId_itemId_key" ON "pluggy_items"("userId", "itemId");
CREATE INDEX "pluggy_items_userId_idx" ON "pluggy_items"("userId");
CREATE UNIQUE INDEX "pluggy_account_links_itemRowId_pluggyAccountId_key" ON "pluggy_account_links"("itemRowId", "pluggyAccountId");
CREATE INDEX "pluggy_account_links_capitalAccountId_idx" ON "pluggy_account_links"("capitalAccountId");
CREATE UNIQUE INDEX "pluggy_investment_links_userId_pluggyInvestmentId_key" ON "pluggy_investment_links"("userId", "pluggyInvestmentId");
CREATE INDEX "pluggy_investment_links_holdingId_idx" ON "pluggy_investment_links"("holdingId");
CREATE UNIQUE INDEX "pluggy_external_refs_userId_pluggyId_key" ON "pluggy_external_refs"("userId", "pluggyId");
CREATE INDEX "pluggy_external_refs_ledgerEntryId_idx" ON "pluggy_external_refs"("ledgerEntryId");
CREATE INDEX "pluggy_external_refs_operationId_idx" ON "pluggy_external_refs"("operationId");
CREATE INDEX "pluggy_sync_runs_itemRowId_startedAt_idx" ON "pluggy_sync_runs"("itemRowId", "startedAt");
CREATE INDEX "pluggy_reviews_userId_status_idx" ON "pluggy_reviews"("userId", "status");

ALTER TABLE "pluggy_items" ADD CONSTRAINT "pluggy_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_items" ADD CONSTRAINT "pluggy_items_brokerageAccountId_fkey" FOREIGN KEY ("brokerageAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pluggy_account_links" ADD CONSTRAINT "pluggy_account_links_itemRowId_fkey" FOREIGN KEY ("itemRowId") REFERENCES "pluggy_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_account_links" ADD CONSTRAINT "pluggy_account_links_capitalAccountId_fkey" FOREIGN KEY ("capitalAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pluggy_sync_runs" ADD CONSTRAINT "pluggy_sync_runs_itemRowId_fkey" FOREIGN KEY ("itemRowId") REFERENCES "pluggy_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_reviews" ADD CONSTRAINT "pluggy_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_reviews" ADD CONSTRAINT "pluggy_reviews_itemRowId_fkey" FOREIGN KEY ("itemRowId") REFERENCES "pluggy_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_investment_links" ADD CONSTRAINT "pluggy_investment_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_investment_links" ADD CONSTRAINT "pluggy_investment_links_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "investment_holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pluggy_external_refs" ADD CONSTRAINT "pluggy_external_refs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
