-- CreateTable
CREATE TABLE "credit_card_statements" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closingDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "totalAmount" DOUBLE PRECISION,
    "billPaymentTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_card_statements_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "bill_transactions" ADD COLUMN     "statementId" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'BRL',
ALTER COLUMN "billId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "credit_card_statements_billPaymentTransactionId_key" ON "credit_card_statements"("billPaymentTransactionId");

-- CreateIndex
CREATE INDEX "credit_card_statements_creditCardId_idx" ON "credit_card_statements"("creditCardId");

-- CreateIndex
CREATE INDEX "credit_card_statements_month_idx" ON "credit_card_statements"("month");

-- CreateIndex
CREATE INDEX "credit_card_statements_billPaymentTransactionId_idx" ON "credit_card_statements"("billPaymentTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_card_statements_creditCardId_month_key" ON "credit_card_statements"("creditCardId", "month");

-- CreateIndex
CREATE INDEX "bill_transactions_statementId_idx" ON "bill_transactions"("statementId");

-- AddForeignKey
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_card_statements" ADD CONSTRAINT "credit_card_statements_billPaymentTransactionId_fkey" FOREIGN KEY ("billPaymentTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_transactions" ADD CONSTRAINT "bill_transactions_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "credit_card_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
