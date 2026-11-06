-- Budget kind and income-to-expense-category reimbursement.
-- Additive and nullable: existing rows stay NULL (variável, no reimbursement).
-- The budgets unique key is unchanged: one budget per category, period and scope.

CREATE TYPE "BudgetKind" AS ENUM ('fixo', 'variavel');

ALTER TABLE "budgets" ADD COLUMN "kind" "BudgetKind";

ALTER TABLE "ledger_entries" ADD COLUMN "reimbursesCategoryId" TEXT;

CREATE INDEX "ledger_entries_reimbursesCategoryId_idx" ON "ledger_entries"("reimbursesCategoryId");

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_reimbursesCategoryId_fkey"
  FOREIGN KEY ("reimbursesCategoryId") REFERENCES "categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
