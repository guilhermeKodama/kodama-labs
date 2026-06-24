-- AlterTable
ALTER TABLE "fire_goals" ADD COLUMN     "currentAge" INTEGER,
ADD COLUMN     "retirementAge" INTEGER,
ADD COLUMN     "lifeExpectancyAge" INTEGER NOT NULL DEFAULT 95,
ADD COLUMN     "annualVolatility" DOUBLE PRECISION NOT NULL DEFAULT 0.12,
ADD COLUMN     "milestones" JSONB NOT NULL DEFAULT '[]';
