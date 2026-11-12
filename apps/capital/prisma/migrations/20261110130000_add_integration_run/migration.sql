-- CreateTable
CREATE TABLE "integration_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "provider" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "requested" INTEGER,
    "succeeded" INTEGER,
    "missing" INTEGER,
    "rejected" INTEGER,
    "providerLatestDate" TIMESTAMP(3),
    "error" TEXT,
    "stats" JSONB,

    CONSTRAINT "integration_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_runs_job_startedAt_idx" ON "integration_runs"("job", "startedAt");
