-- CreateIndex
-- Covering index: enables index-only scan for the get-pipeline-state aggregation
-- (COUNT(*) FILTER ... GROUP BY source, recordType). The INCLUDE columns are
-- not part of the B-tree key, just stored in leaf pages.
CREATE INDEX "raw_records_breakdown_idx" ON "raw_records"("source", "recordType") INCLUDE ("processedAt", "processingError");

-- CreateIndex
-- Partial index: contains only rows still pending (processedAt IS NULL AND
-- processingError IS NULL). Accelerates processor findMany batch fetches and
-- the drain-backlog pending-count probe. Index stays small even as the table grows.
CREATE INDEX "raw_records_pending_idx" ON "raw_records"("recordType", "source", "fetchedAt") WHERE "processedAt" IS NULL AND "processingError" IS NULL;
