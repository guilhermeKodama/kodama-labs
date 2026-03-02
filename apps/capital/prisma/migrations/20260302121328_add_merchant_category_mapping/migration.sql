-- CreateTable
CREATE TABLE "merchant_category_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_category_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_category_mappings_userId_idx" ON "merchant_category_mappings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_category_mappings_userId_normalizedDescription_key" ON "merchant_category_mappings"("userId", "normalizedDescription");

-- AddForeignKey
ALTER TABLE "merchant_category_mappings" ADD CONSTRAINT "merchant_category_mappings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: populate mappings from existing bill transaction history.
-- For each (userId, description) pair, picks the most recent category,
-- preferring manual classifications (isAutoCategorized=false) over AI.
INSERT INTO "merchant_category_mappings" ("id", "userId", "normalizedDescription", "category", "source", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  sub."userId",
  sub."normalizedDescription",
  sub.category,
  sub.source,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT ON (u.id, LOWER(TRIM(bt.description)))
    u.id AS "userId",
    LOWER(TRIM(bt.description)) AS "normalizedDescription",
    bt.category,
    CASE WHEN bt."isAutoCategorized" THEN 'ai' ELSE 'manual' END AS source
  FROM bill_transactions bt
  JOIN credit_card_bills ccb ON ccb.id = bt."billId"
  JOIN credit_cards cc ON cc.id = ccb."creditCardId"
  LEFT JOIN businesses b ON b.id = cc."businessId"
  LEFT JOIN personal_accounts pa ON pa.id = cc."personalAccountId"
  JOIN users u ON u.id = COALESCE(b."userId", pa."userId")
  WHERE bt.category NOT IN ('Uncategorized', 'Other')
  ORDER BY
    u.id,
    LOWER(TRIM(bt.description)),
    bt."isAutoCategorized" ASC,
    bt."updatedAt" DESC
) sub
ON CONFLICT ("userId", "normalizedDescription") DO NOTHING;
