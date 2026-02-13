-- AlterTable
ALTER TABLE "investment_transactions" ADD COLUMN     "linkedTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_linkedTransactionId_key" ON "investment_transactions"("linkedTransactionId");

-- AddForeignKey
ALTER TABLE "investment_transactions" ADD CONSTRAINT "investment_transactions_linkedTransactionId_fkey" FOREIGN KEY ("linkedTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
