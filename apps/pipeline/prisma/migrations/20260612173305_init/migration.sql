-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('HYPOTHESIS', 'VALIDATING', 'VALIDATED', 'KILLED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('META', 'GOOGLE', 'ORGANIC', 'DIRECT', 'OTHER');

-- CreateEnum
CREATE TYPE "ThresholdChannel" AS ENUM ('ALL', 'META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ONBOARDING', 'QUALIFIED', 'ACTIVE', 'CUSTOMER', 'COLD', 'LOST');

-- CreateEnum
CREATE TYPE "MetricKey" AS ENUM ('CPM', 'CPC', 'CTR', 'BOUNCE_RATE', 'SESSION_TO_LEAD', 'CPL', 'AR', 'PCR', 'CAC');

-- CreateEnum
CREATE TYPE "ThresholdSource" AS ENUM ('CONFIG', 'MANUAL', 'DEFAULT');

-- CreateEnum
CREATE TYPE "SpendSource" AS ENUM ('API', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "IdeaStatus" NOT NULL DEFAULT 'HYPOTHESIS',
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "landingUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "priceMonthlyCents" INTEGER,
    "projectedLtvCents" INTEGER,
    "maxCacCents" INTEGER,
    "cacCeilingLeadCents" INTEGER,
    "channelKillCacCents" INTEGER,
    "cacBands" JSONB,
    "gates" JSONB,
    "metaAdAccountId" TEXT,
    "googleCustomerId" TEXT,
    "googleCampaignPrefix" TEXT,
    "ga4PropertyId" TEXT,
    "adsLaunchedAt" TIMESTAMP(3),
    "goNoGoAt" TIMESTAMP(3),
    "budgetTotalCents" INTEGER,
    "budgetWeeks" INTEGER,
    "configHash" TEXT,
    "rawConfig" JSONB,
    "syncedAt" TIMESTAMP(3),
    "lastSyncCommit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_thresholds" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "metric" "MetricKey" NOT NULL,
    "channel" "ThresholdChannel" NOT NULL DEFAULT 'ALL',
    "healthyValue" DECIMAL(14,6) NOT NULL,
    "deathValue" DECIMAL(14,6) NOT NULL,
    "source" "ThresholdSource" NOT NULL DEFAULT 'CONFIG',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contact" TEXT,
    "name" TEXT,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmMedium" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "utmContent" TEXT NOT NULL DEFAULT '',
    "utmTerm" TEXT NOT NULL DEFAULT '',
    "referrer" TEXT NOT NULL DEFAULT '',
    "gclid" TEXT NOT NULL DEFAULT '',
    "channel" "Channel" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "onboardingAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "coldAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "notes" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "customerValueCents" INTEGER,
    "resubmitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_status_events" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "actor" TEXT,
    "forced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lead_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_inbox" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "leadId" TEXT,
    "error" TEXT,

    CONSTRAINT "lead_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_spend_daily" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT,
    "channel" "Channel" NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "source" "SpendSource" NOT NULL DEFAULT 'API',
    "pulledAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_spend_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ga4_sessions_daily" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "date" DATE NOT NULL,
    "sessions" INTEGER NOT NULL,
    "engagedSessions" INTEGER NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "ga4SyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ga4_sessions_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "layer" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsIn" INTEGER,
    "recordsOut" INTEGER,
    "error" TEXT,
    "metadata" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ideas_slug_key" ON "ideas"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "metric_thresholds_ideaId_metric_channel_key" ON "metric_thresholds"("ideaId", "metric", "channel");

-- CreateIndex
CREATE INDEX "leads_ideaId_status_idx" ON "leads"("ideaId", "status");

-- CreateIndex
CREATE INDEX "leads_ideaId_channel_createdAt_idx" ON "leads"("ideaId", "channel", "createdAt");

-- CreateIndex
CREATE INDEX "leads_ideaId_createdAt_idx" ON "leads"("ideaId", "createdAt");

-- CreateIndex
CREATE INDEX "leads_ideaId_activatedAt_idx" ON "leads"("ideaId", "activatedAt");

-- CreateIndex
CREATE INDEX "leads_ideaId_convertedAt_idx" ON "leads"("ideaId", "convertedAt");

-- CreateIndex
CREATE UNIQUE INDEX "leads_ideaId_email_key" ON "leads"("ideaId", "email");

-- CreateIndex
CREATE INDEX "lead_status_events_leadId_occurredAt_idx" ON "lead_status_events"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_inbox_slug_receivedAt_idx" ON "lead_inbox"("slug", "receivedAt");

-- CreateIndex
CREATE INDEX "lead_inbox_processedAt_idx" ON "lead_inbox"("processedAt");

-- CreateIndex
CREATE INDEX "ad_spend_daily_ideaId_date_idx" ON "ad_spend_daily"("ideaId", "date");

-- CreateIndex
CREATE INDEX "ad_spend_daily_channel_date_idx" ON "ad_spend_daily"("channel", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ad_spend_daily_channel_accountId_campaignId_date_key" ON "ad_spend_daily"("channel", "accountId", "campaignId", "date");

-- CreateIndex
CREATE INDEX "ga4_sessions_daily_ideaId_date_idx" ON "ga4_sessions_daily"("ideaId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ga4_sessions_daily_ideaId_channel_date_key" ON "ga4_sessions_daily"("ideaId", "channel", "date");

-- CreateIndex
CREATE INDEX "job_runs_jobName_idx" ON "job_runs"("jobName");

-- CreateIndex
CREATE INDEX "job_runs_layer_idx" ON "job_runs"("layer");

-- CreateIndex
CREATE INDEX "job_runs_startedAt_idx" ON "job_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "metric_thresholds" ADD CONSTRAINT "metric_thresholds_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_status_events" ADD CONSTRAINT "lead_status_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_spend_daily" ADD CONSTRAINT "ad_spend_daily_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ga4_sessions_daily" ADD CONSTRAINT "ga4_sessions_daily_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
