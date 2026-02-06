-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('pending', 'paid', 'overdue');

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "credit_cards" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "bankName" TEXT NOT NULL,
    "lastFourDigits" TEXT NOT NULL,
    "nickname" TEXT,
    "creditLimit" DOUBLE PRECISION NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "personalAccountId" TEXT,

    CONSTRAINT "credit_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_card_bills" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "transactionId" TEXT,
    "closingDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'pending',
    "csvFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_card_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_transactions" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "merchantName" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "installmentNumber" INTEGER,
    "totalInstallments" INTEGER,
    "isAutoCategorized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "creditCardId" TEXT NOT NULL,
    "billTransactionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "totalInstallments" INTEGER NOT NULL,
    "paidInstallments" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "installmentAmount" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_cards_businessId_idx" ON "credit_cards"("businessId");

-- CreateIndex
CREATE INDEX "credit_cards_personalAccountId_idx" ON "credit_cards"("personalAccountId");

-- CreateIndex
CREATE INDEX "credit_cards_entityType_idx" ON "credit_cards"("entityType");

-- CreateIndex
CREATE INDEX "credit_cards_isActive_idx" ON "credit_cards"("isActive");

-- CreateIndex
CREATE INDEX "credit_card_bills_creditCardId_idx" ON "credit_card_bills"("creditCardId");

-- CreateIndex
CREATE INDEX "credit_card_bills_transactionId_idx" ON "credit_card_bills"("transactionId");

-- CreateIndex
CREATE INDEX "credit_card_bills_status_idx" ON "credit_card_bills"("status");

-- CreateIndex
CREATE INDEX "credit_card_bills_dueDate_idx" ON "credit_card_bills"("dueDate");

-- CreateIndex
CREATE INDEX "bill_transactions_billId_idx" ON "bill_transactions"("billId");

-- CreateIndex
CREATE INDEX "bill_transactions_category_idx" ON "bill_transactions"("category");

-- CreateIndex
CREATE INDEX "bill_transactions_transactionDate_idx" ON "bill_transactions"("transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "installments_billTransactionId_key" ON "installments"("billTransactionId");

-- CreateIndex
CREATE INDEX "installments_creditCardId_idx" ON "installments"("creditCardId");

-- CreateIndex
CREATE INDEX "installments_isActive_idx" ON "installments"("isActive");

-- AddForeignKey
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_card_bills" ADD CONSTRAINT "credit_card_bills_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_card_bills" ADD CONSTRAINT "credit_card_bills_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_transactions" ADD CONSTRAINT "bill_transactions_billId_fkey" FOREIGN KEY ("billId") REFERENCES "credit_card_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_creditCardId_fkey" FOREIGN KEY ("creditCardId") REFERENCES "credit_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_billTransactionId_fkey" FOREIGN KEY ("billTransactionId") REFERENCES "bill_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
