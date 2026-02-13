ALTER TYPE "TransferDirection" ADD VALUE 'investment_deposit';
ALTER TYPE "TransferDirection" ADD VALUE 'investment_withdrawal';

ALTER TABLE "transfers" ADD COLUMN "fromInvestmentAccountId" TEXT,
ADD COLUMN "toInvestmentAccountId" TEXT;

CREATE INDEX "transfers_toInvestmentAccountId_idx" ON "transfers"("toInvestmentAccountId");
CREATE INDEX "transfers_fromInvestmentAccountId_idx" ON "transfers"("fromInvestmentAccountId");

ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toInvestmentAccountId_fkey" FOREIGN KEY ("toInvestmentAccountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromInvestmentAccountId_fkey" FOREIGN KEY ("fromInvestmentAccountId") REFERENCES "investment_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
