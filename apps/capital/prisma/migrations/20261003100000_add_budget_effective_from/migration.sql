-- Add effectiveFrom field to budgets for effective-dated budget changes
ALTER TABLE "budgets" ADD COLUMN "effectiveFrom" TIMESTAMP(3);

-- Set effectiveFrom for existing budgets based on year/month
UPDATE "budgets" SET "effectiveFrom" = make_date("year", COALESCE("month", 1), 1);

-- Make effectiveFrom NOT NULL after populating
ALTER TABLE "budgets" ALTER COLUMN "effectiveFrom" SET NOT NULL;

-- Drop old unique constraints (they don't support effective dating)
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_businessId_category_period_year_month_key";
ALTER TABLE "budgets" DROP CONSTRAINT IF EXISTS "budgets_personalAccountId_category_period_year_month_key";

-- Add new unique constraints with effectiveFrom
-- This allows multiple budgets for the same category with different effective dates
CREATE UNIQUE INDEX "budgets_businessId_category_effectiveFrom_key" ON "budgets"("businessId", "category", "effectiveFrom") WHERE "businessId" IS NOT NULL;
CREATE UNIQUE INDEX "budgets_personalAccountId_category_effectiveFrom_key" ON "budgets"("personalAccountId", "category", "effectiveFrom") WHERE "personalAccountId" IS NOT NULL;
