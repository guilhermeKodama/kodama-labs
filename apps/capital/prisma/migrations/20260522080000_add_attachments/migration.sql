-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('BILL', 'RECEIPT', 'TRANSFER_RECEIPT');

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transactionId" TEXT,
    "transferId" TEXT,
    "recurringTransactionId" TEXT,
    "recurringTransferId" TEXT,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_transactionId_idx" ON "attachments"("transactionId");

-- CreateIndex
CREATE INDEX "attachments_transferId_idx" ON "attachments"("transferId");

-- CreateIndex
CREATE INDEX "attachments_recurringTransactionId_idx" ON "attachments"("recurringTransactionId");

-- CreateIndex
CREATE INDEX "attachments_recurringTransferId_idx" ON "attachments"("recurringTransferId");

-- CreateIndex
CREATE INDEX "attachments_kind_idx" ON "attachments"("kind");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "recurring_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_recurringTransferId_fkey" FOREIGN KEY ("recurringTransferId") REFERENCES "recurring_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
