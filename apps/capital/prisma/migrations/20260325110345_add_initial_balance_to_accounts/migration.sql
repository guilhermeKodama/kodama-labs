-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "initialBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "personal_accounts" ADD COLUMN     "initialBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
