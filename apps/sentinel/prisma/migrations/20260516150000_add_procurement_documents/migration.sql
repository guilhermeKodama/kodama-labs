-- AlterTable
ALTER TABLE "procurements" ADD COLUMN     "documentsEnrichedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "procurement_documents" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "sequencial" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT,
    "sourceUrl" TEXT,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "statusAtivo" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawRecordId" TEXT,

    CONSTRAINT "procurement_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "procurement_documents_externalId_key" ON "procurement_documents"("externalId");

-- CreateIndex
CREATE INDEX "procurement_documents_procurementId_idx" ON "procurement_documents"("procurementId");

-- CreateIndex
CREATE INDEX "procurement_documents_documentType_idx" ON "procurement_documents"("documentType");

-- CreateIndex
CREATE INDEX "procurement_documents_fetchedAt_idx" ON "procurement_documents"("fetchedAt");

-- CreateIndex
CREATE INDEX "procurements_documentsEnrichedAt_idx" ON "procurements"("documentsEnrichedAt");

-- AddForeignKey
ALTER TABLE "procurement_documents" ADD CONSTRAINT "procurement_documents_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
