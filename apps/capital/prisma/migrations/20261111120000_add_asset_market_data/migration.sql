-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "currency" TEXT NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assets_symbol_assetClass_currency_key" ON "assets"("symbol", "assetClass", "currency");

-- CreateTable
CREATE TABLE "asset_source_refs" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_source_refs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_source_refs_assetId_source_key" ON "asset_source_refs"("assetId", "source");
CREATE INDEX "asset_source_refs_source_externalId_idx" ON "asset_source_refs"("source", "externalId");

ALTER TABLE "asset_source_refs" ADD CONSTRAINT "asset_source_refs_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "asset_prices" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "close" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_prices_assetId_date_key" ON "asset_prices"("assetId", "date");
CREATE INDEX "asset_prices_date_idx" ON "asset_prices"("date");

ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "investment_holdings" ADD COLUMN "assetId" TEXT,
ADD COLUMN "priceSource" TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX "investment_holdings_assetId_idx" ON "investment_holdings"("assetId");

ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
