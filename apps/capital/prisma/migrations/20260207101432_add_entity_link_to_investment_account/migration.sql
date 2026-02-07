-- AlterTable
ALTER TABLE "investment_accounts" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "personalAccountId" TEXT;

-- CreateIndex
CREATE INDEX "investment_accounts_businessId_idx" ON "investment_accounts"("businessId");

-- CreateIndex
CREATE INDEX "investment_accounts_personalAccountId_idx" ON "investment_accounts"("personalAccountId");

-- AddForeignKey
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_accounts" ADD CONSTRAINT "investment_accounts_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
