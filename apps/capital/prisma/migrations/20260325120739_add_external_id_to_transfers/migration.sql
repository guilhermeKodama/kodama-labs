-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE INDEX "transfers_externalId_idx" ON "transfers"("externalId");
