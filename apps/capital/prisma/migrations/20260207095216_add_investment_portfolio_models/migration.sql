-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('stocks', 'fii', 'etf', 'bdr', 'fixed_income', 'crypto', 'savings', 'international_stocks', 'international_etf');

-- CreateEnum
CREATE TYPE "FixedIncomeSubType" AS ENUM ('cdb', 'lci', 'lca', 'cdi', 'tesouro_selic', 'tesouro_ipca', 'tesouro_prefixado', 'debenture');

-- CreateEnum
CREATE TYPE "InvestmentTransactionType" AS ENUM ('buy', 'sell', 'dividend', 'yield_payment', 'split', 'deposit', 'withdrawal');

-- CreateTable
CREATE TABLE "investment_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "broker" TEXT,
    "entityType" "EntityType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_holdings" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "subType" "FixedIncomeSubType",
    "ticker" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "currentQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalInvested" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_transactions" (
    "id" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "type" "InvestmentTransactionType" NOT NULL,
    "quantity" DOUBLE PRECISION,
    "pricePerUnit" DOUBLE PRECISION,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_accounts_userId_idx" ON "investment_accounts"("userId");

-- CreateIndex
CREATE INDEX "investment_accounts_entityType_idx" ON "investment_accounts"("entityType");

-- CreateIndex
CREATE INDEX "investment_holdings_accountId_idx" ON "investment_holdings"("accountId");

-- CreateIndex
CREATE INDEX "investment_holdings_assetClass_idx" ON "investment_holdings"("assetClass");

-- CreateIndex
CREATE INDEX "investment_holdings_ticker_idx" ON "investment_holdings"("ticker");

-- CreateIndex
CREATE INDEX "investment_holdings_isActive_idx" ON "investment_holdings"("isActive");

-- CreateIndex
CREATE INDEX "investment_transactions_holdingId_idx" ON "investment_transactions"("holdingId");

-- CreateIndex
CREATE INDEX "investment_transactions_type_idx" ON "investment_transactions"("type");

-- CreateIndex
CREATE INDEX "investment_transactions_date_idx" ON "investment_transactions"("date");

-- AddForeignKey
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_holdings" ADD CONSTRAINT "investment_holdings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "investment_holdings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
