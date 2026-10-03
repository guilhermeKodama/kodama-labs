-- Add systemKey column to categories table
ALTER TABLE "categories" ADD COLUMN "systemKey" TEXT;

-- Backfill systemKey for existing default/system categories
-- Income categories (isDefault, not isSystem)
UPDATE "categories" SET "systemKey" = 'client_payment' WHERE "isDefault" = true AND "name" = 'Client Payment' AND "type" = 'income';
UPDATE "categories" SET "systemKey" = 'salary' WHERE "isDefault" = true AND "name" = 'Salary' AND "type" = 'income';
UPDATE "categories" SET "systemKey" = 'dividends' WHERE "isDefault" = true AND "name" = 'Dividends' AND "type" = 'income';
UPDATE "categories" SET "systemKey" = 'interest' WHERE "isDefault" = true AND "name" = 'Interest' AND "type" = 'income';
UPDATE "categories" SET "systemKey" = 'refund' WHERE "isDefault" = true AND "name" = 'Refund' AND "type" = 'income';
UPDATE "categories" SET "systemKey" = 'other_income' WHERE "isDefault" = true AND "name" = 'Other Income' AND "type" = 'income';

-- Expense categories (isDefault, not isSystem)
UPDATE "categories" SET "systemKey" = 'software_tools' WHERE "isDefault" = true AND "name" = 'Software & Tools' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'hardware' WHERE "isDefault" = true AND "name" = 'Hardware' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'office' WHERE "isDefault" = true AND "name" = 'Office' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'travel_default' WHERE "isDefault" = true AND "name" = 'Travel' AND "type" = 'expense' AND "isSystem" = false;
UPDATE "categories" SET "systemKey" = 'marketing' WHERE "isDefault" = true AND "name" = 'Marketing' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'legal_accounting' WHERE "isDefault" = true AND "name" = 'Legal & Accounting' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'taxes' WHERE "isDefault" = true AND "name" = 'Taxes' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'insurance' WHERE "isDefault" = true AND "name" = 'Insurance' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'utilities' WHERE "isDefault" = true AND "name" = 'Utilities' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'other_expense' WHERE "isDefault" = true AND "name" = 'Other Expense' AND "type" = 'expense';

-- Investment categories (isDefault, not isSystem)
UPDATE "categories" SET "systemKey" = 'stocks' WHERE "isDefault" = true AND "name" = 'Stocks' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'bonds' WHERE "isDefault" = true AND "name" = 'Bonds' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'crypto' WHERE "isDefault" = true AND "name" = 'Crypto' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'real_estate' WHERE "isDefault" = true AND "name" = 'Real Estate' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'savings' WHERE "isDefault" = true AND "name" = 'Savings' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'retirement' WHERE "isDefault" = true AND "name" = 'Retirement' AND "type" = 'investment';
UPDATE "categories" SET "systemKey" = 'other_investment' WHERE "isDefault" = true AND "name" = 'Other Investment' AND "type" = 'investment';

-- System expense categories (isSystem = true)
UPDATE "categories" SET "systemKey" = 'credit_card' WHERE "isSystem" = true AND "name" = 'Credit Card' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'subscriptions' WHERE "isSystem" = true AND "name" = 'Subscriptions' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'groceries' WHERE "isSystem" = true AND "name" = 'Groceries' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'restaurants_dining' WHERE "isSystem" = true AND "name" = 'Restaurants & Dining' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'transportation' WHERE "isSystem" = true AND "name" = 'Transportation' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'shopping' WHERE "isSystem" = true AND "name" = 'Shopping' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'entertainment' WHERE "isSystem" = true AND "name" = 'Entertainment' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'health_pharmacy' WHERE "isSystem" = true AND "name" = 'Health & Pharmacy' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'travel_system' WHERE "isSystem" = true AND "name" = 'Travel' AND "type" = 'expense' AND "isDefault" = true;
UPDATE "categories" SET "systemKey" = 'education' WHERE "isSystem" = true AND "name" = 'Education' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'personal_care' WHERE "isSystem" = true AND "name" = 'Personal Care' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'home' WHERE "isSystem" = true AND "name" = 'Home' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'fees_charges' WHERE "isSystem" = true AND "name" = 'Fees & Charges' AND "type" = 'expense';
UPDATE "categories" SET "systemKey" = 'other_system' WHERE "isSystem" = true AND "name" = 'Other' AND "type" = 'expense';

-- Create unique constraint on userId + systemKey
CREATE UNIQUE INDEX "categories_userId_systemKey_key" ON "categories"("userId", "systemKey");
