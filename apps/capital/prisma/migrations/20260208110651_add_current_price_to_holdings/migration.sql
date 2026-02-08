-- AlterTable
ALTER TABLE "investment_holdings" ADD COLUMN     "currentPrice" DOUBLE PRECISION,
ADD COLUMN     "lastPriceUpdate" TIMESTAMP(3);
