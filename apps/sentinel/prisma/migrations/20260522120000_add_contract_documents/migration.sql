-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "year" INTEGER;
ALTER TABLE "contracts" ADD COLUMN "sequencial" INTEGER;
ALTER TABLE "contracts" ADD COLUMN "documentsEnrichedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contract_documents" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
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

    CONSTRAINT "contract_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_documents_externalId_key" ON "contract_documents"("externalId");

-- CreateIndex
CREATE INDEX "contract_documents_contractId_idx" ON "contract_documents"("contractId");

-- CreateIndex
CREATE INDEX "contract_documents_documentType_idx" ON "contract_documents"("documentType");

-- CreateIndex
CREATE INDEX "contract_documents_fetchedAt_idx" ON "contract_documents"("fetchedAt");

-- CreateIndex
CREATE INDEX "contracts_documentsEnrichedAt_idx" ON "contracts"("documentsEnrichedAt");

-- AddForeignKey
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill year/sequencial from raw_records for existing PNCP contracts
UPDATE "contracts" c
SET
  "year" = COALESCE(c."year", (r.data->>'anoContrato')::int),
  "sequencial" = COALESCE(c."sequencial", (r.data->>'sequencialContrato')::int)
FROM "raw_records" r
WHERE c."rawRecordId" = r.id
  AND r.source = 'PNCP'
  AND r."recordType" = 'contract'
  AND (c."year" IS NULL OR c."sequencial" IS NULL);
