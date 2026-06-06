-- CreateIndex
-- Matches the entities listing orderBy: (riskScore DESC NULLS LAST, id ASC).
-- The NULLS LAST modifier cannot be expressed in Prisma's @@index syntax; the
-- @@index([riskScore(sort: Desc), id]) line in schema.prisma corresponds to
-- this hand-edited statement. With it, the listing-page cursor scan can read
-- straight from the index instead of sorting the whole table.
CREATE INDEX IF NOT EXISTS "entities_riskScore_id_listing_idx"
  ON "entities"("riskScore" DESC NULLS LAST, "id" ASC);

-- CreateIndex
-- Matches the politicians listing orderBy:
-- (active DESC, elected DESC, name ASC, id ASC). The existing
-- politicians_active_elected_name_id_idx is all-ASC and can only be scanned
-- forward (all ASC) or backward (all DESC); it cannot serve a mixed-direction
-- sort, forcing a full sort in memory on every page load.
CREATE INDEX IF NOT EXISTS "politicians_listing_idx"
  ON "politicians"("active" DESC, "elected" DESC, "name" ASC, "id" ASC);
