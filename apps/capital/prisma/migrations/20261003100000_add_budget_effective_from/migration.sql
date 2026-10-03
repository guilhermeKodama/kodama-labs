-- Add effectiveFrom field to budgets for effective-dated budget changes
ALTER TABLE "budgets" ADD COLUMN "effectiveFrom" TIMESTAMP(3);

-- Set effectiveFrom for existing budgets based on year/month
UPDATE "budgets" SET "effectiveFrom" = make_date("year", COALESCE("month", 1), 1);

-- Make effectiveFrom NOT NULL after populating
ALTER TABLE "budgets" ALTER COLUMN "effectiveFrom" SET NOT NULL;

-- Drop old unique indexes
DROP INDEX IF EXISTS "budgets_businessId_category_period_year_month_key";
DROP INDEX IF EXISTS "budgets_personalAccountId_category_period_year_month_key";

-- Add new unique indexes with effectiveFrom (matching Prisma @@unique)
CREATE UNIQUE INDEX "budgets_businessId_category_effectiveFrom_key" ON "budgets"("businessId", "category", "effectiveFrom");
CREATE UNIQUE INDEX "budgets_personalAccountId_category_effectiveFrom_key" ON "budgets"("personalAccountId", "category", "effectiveFrom");

-- Add index on effectiveFrom for efficient lookup
CREATE INDEX "budgets_effectiveFrom_idx" ON "budgets"("effectiveFrom");
