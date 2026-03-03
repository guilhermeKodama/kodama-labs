-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "statementImportId" TEXT;

-- CreateTable
CREATE TABLE "statement_imports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "bankName" TEXT,
    "fileName" TEXT,
    "transactionCount" INTEGER NOT NULL,
    "categorizationStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessId" TEXT,
    "personalAccountId" TEXT,

    CONSTRAINT "statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "statement_imports_userId_idx" ON "statement_imports"("userId");

-- CreateIndex
CREATE INDEX "statement_imports_categorizationStatus_idx" ON "statement_imports"("categorizationStatus");

-- CreateIndex
CREATE INDEX "statement_imports_businessId_idx" ON "statement_imports"("businessId");

-- CreateIndex
CREATE INDEX "statement_imports_personalAccountId_idx" ON "statement_imports"("personalAccountId");

-- CreateIndex
CREATE INDEX "transactions_externalId_idx" ON "transactions"("externalId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statementImportId_fkey" FOREIGN KEY ("statementImportId") REFERENCES "statement_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_personalAccountId_fkey" FOREIGN KEY ("personalAccountId") REFERENCES "personal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
