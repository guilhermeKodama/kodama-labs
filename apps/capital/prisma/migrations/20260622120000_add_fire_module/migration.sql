-- CreateTable
CREATE TABLE "fire_goals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "targetMonthlyIncome" DOUBLE PRECISION NOT NULL,
    "safeWithdrawalRate" DOUBLE PRECISION NOT NULL DEFAULT 0.035,
    "nominalAnnualReturn" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "annualInflation" DOUBLE PRECISION NOT NULL DEFAULT 0.045,
    "monthlyIncome" DOUBLE PRECISION,
    "planningMode" TEXT NOT NULL DEFAULT 'by_date',
    "targetYear" INTEGER,
    "phaseProfile" TEXT NOT NULL DEFAULT 'front_loaded',
    "phases" JSONB NOT NULL,
    "baristaMonthlyIncome" DOUBLE PRECISION,
    "coastStopYear" INTEGER,
    "leanMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "fatMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.6,
    "includeEntityBalances" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fire_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fire_snapshots" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "currentInvested" DOUBLE PRECISION NOT NULL,
    "currentMonthlyExpenses" DOUBLE PRECISION NOT NULL,
    "fireNumber" DOUBLE PRECISION NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL,
    "monthsToFire" INTEGER,
    "projectedFireDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fire_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fire_goals_userId_key" ON "fire_goals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "fire_snapshots_goalId_period_key" ON "fire_snapshots"("goalId", "period");

-- CreateIndex
CREATE INDEX "fire_snapshots_goalId_period_idx" ON "fire_snapshots"("goalId", "period");

-- AddForeignKey
ALTER TABLE "fire_goals" ADD CONSTRAINT "fire_goals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fire_snapshots" ADD CONSTRAINT "fire_snapshots_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "fire_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
