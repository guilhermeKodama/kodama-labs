-- AlterTable
ALTER TABLE "credit_card_bills" ADD COLUMN     "categorizationStatus" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "credit_card_bills_categorizationStatus_idx" ON "credit_card_bills"("categorizationStatus");
