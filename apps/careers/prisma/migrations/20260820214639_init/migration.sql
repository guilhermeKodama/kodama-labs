-- CreateEnum
CREATE TYPE "Tristate" AS ENUM ('SIM', 'PROVAVEL_SIM', 'A_CONFIRMAR', 'PROVAVEL_NAO', 'NAO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RADAR', 'TRIAGEM', 'SHORTLIST', 'APLICADA', 'ENTREVISTA', 'OFERTA', 'CONTRATADA', 'DESCARTADA');

-- CreateEnum
CREATE TYPE "Track" AS ENUM ('IC', 'MANAGER');

-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('JUNIOR', 'MID', 'SENIOR', 'STAFF', 'SENIOR_STAFF', 'PRINCIPAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WorkModel" AS ENUM ('REMOTO', 'HIBRIDO', 'PRESENCIAL', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "CompanyHealth" AS ENUM ('FORTE', 'ATENCAO', 'RISCO', 'A_CONFIRMAR');

-- CreateEnum
CREATE TYPE "AtsProvider" AS ENUM ('GREENHOUSE', 'LEVER', 'ASHBY', 'SMARTRECRUITERS', 'WORKABLE', 'RECRUITEE', 'BREEZY', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('ATS', 'AGGREGATOR', 'FORUM', 'SCRAPE');

-- CreateEnum
CREATE TYPE "PostingDecision" AS ENUM ('PENDING', 'FILTERED_OUT', 'DUPLICATE', 'PROMOTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "InterestSource" AS ENUM ('AGENT', 'USER');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('MODEL', 'LLM', 'USER');

-- CreateEnum
CREATE TYPE "BuildVsOperate" AS ENUM ('CONSTROI', 'MEIO_TERMO', 'OPERA', 'INDETERMINADO');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('TAILORED_RESUME', 'COVER_LETTER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "TriageLabel" AS ENUM ('SHORTLIST', 'DESCARTAR');

-- CreateEnum
CREATE TYPE "RuleProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "SearchProfile" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "requireRemote" BOOLEAN NOT NULL DEFAULT true,
    "requirePaysUsd" BOOLEAN NOT NULL DEFAULT true,
    "requireHiresBrazil" BOOLEAN NOT NULL DEFAULT true,
    "contractForms" TEXT[],
    "excludePeopleMgmt" BOOLEAN NOT NULL DEFAULT true,
    "salaryFloorUsdAnnual" INTEGER NOT NULL DEFAULT 165000,
    "track" "Track" NOT NULL DEFAULT 'IC',
    "builderOrOperator" TEXT NOT NULL DEFAULT 'builder',
    "targetTitles" TEXT[],
    "minSeniority" "Seniority" NOT NULL DEFAULT 'SENIOR',
    "yearsExperience" INTEGER NOT NULL DEFAULT 13,
    "currentTitle" TEXT,
    "acceptedFormats" TEXT[],
    "coreStack" TEXT[],
    "domains" TEXT[],
    "wantsEquity" BOOLEAN NOT NULL DEFAULT true,
    "equityWeight" TEXT NOT NULL DEFAULT 'alto',
    "salaryTargetUsdAnnual" INTEGER NOT NULL DEFAULT 187000,
    "referenceCompanies" TEXT[],
    "preferredSectors" TEXT[],
    "prioritizeYc" BOOLEAN NOT NULL DEFAULT true,
    "bonusCoreInfra" BOOLEAN NOT NULL DEFAULT true,
    "desiredStack" TEXT[],
    "timezoneBase" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "minOverlapHours" INTEGER NOT NULL DEFAULT 4,
    "companySizes" TEXT[],
    "avoidStack" TEXT[],
    "wantToDo" TEXT[],
    "doNotWant" TEXT[],
    "desiredCulture" TEXT[],
    "excludedCompanies" TEXT[],
    "excludedTitleSubstrs" TEXT[],
    "maxJobsPerDay" INTEGER NOT NULL DEFAULT 10,
    "maxJobsPerCompanyPerRun" INTEGER NOT NULL DEFAULT 3,
    "initialStatus" "JobStatus" NOT NULL DEFAULT 'TRIAGEM',
    "dedupBy" TEXT[] DEFAULT ARRAY['empresa', 'cargo']::TEXT[],
    "extras" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "originalName" TEXT,
    "blobUrl" TEXT,
    "pathname" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "contentJson" JSONB NOT NULL,
    "contentText" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextDocument" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "blobUrl" TEXT,
    "pathname" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "includeInPrompt" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER,
    "sectorGroup" TEXT,
    "stackSummary" TEXT,
    "careersUrl" TEXT,
    "pjBrazil" "Tristate" NOT NULL DEFAULT 'A_CONFIRMAR',
    "pjBrazilNote" TEXT,
    "health" "CompanyHealth" NOT NULL DEFAULT 'A_CONFIRMAR',
    "foundedYear" INTEGER,
    "headcount" INTEGER,
    "stage" TEXT,
    "totalRaisedRaw" TEXT,
    "totalRaisedUsd" BIGINT,
    "lastRoundRaw" TEXT,
    "valuationRaw" TEXT,
    "profitable" "Tristate" NOT NULL DEFAULT 'A_CONFIRMAR',
    "profitableNote" TEXT,
    "profileUpdatedAt" TIMESTAMP(3),
    "healthMarkdown" TEXT,
    "sources" TEXT[],
    "isExcluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,

    CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBoard" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "AtsProvider" NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastJobCount" INTEGER,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "CompanyBoard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "key" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "rateLimitMs" INTEGER NOT NULL DEFAULT 1000,
    "maxPerRun" INTEGER NOT NULL DEFAULT 50,
    "config" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "Source_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "runDate" DATE NOT NULL,
    "runType" TEXT NOT NULL DEFAULT 'daily',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "cap" INTEGER NOT NULL,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "considered" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "promoted" INTEGER NOT NULL DEFAULT 0,
    "deferred" INTEGER NOT NULL DEFAULT 0,
    "warnings" TEXT[],

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "boardId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "httpStatus" INTEGER,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "promoted" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,
    "warnings" TEXT[],

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawPosting" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "companyName" TEXT,
    "locationRaw" TEXT,
    "descriptionText" TEXT,
    "compensationRaw" TEXT,
    "postedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "decision" "PostingDecision" NOT NULL DEFAULT 'PENDING',
    "filterReason" TEXT,
    "needsEnrichment" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "jobId" TEXT,

    CONSTRAINT "RawPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dedupTitle" TEXT NOT NULL,
    "track" "Track" NOT NULL DEFAULT 'IC',
    "seniority" "Seniority" NOT NULL DEFAULT 'UNKNOWN',
    "seniorityNote" TEXT,
    "workModel" "WorkModel" NOT NULL DEFAULT 'DESCONHECIDO',
    "locationRaw" TEXT,
    "regions" TEXT[],
    "hiresBrazil" "Tristate" NOT NULL DEFAULT 'A_CONFIRMAR',
    "hiresBrazilNote" TEXT,
    "equity" "Tristate" NOT NULL DEFAULT 'A_CONFIRMAR',
    "equityNote" TEXT,
    "currency" TEXT,
    "currencyNote" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryPeriod" TEXT DEFAULT 'YEAR',
    "salaryRaw" TEXT,
    "stack" TEXT[],
    "sector" TEXT,
    "sectorTags" TEXT[],
    "canonicalUrl" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'TRIAGEM',
    "interest" INTEGER NOT NULL DEFAULT 3,
    "interestSource" "InterestSource" NOT NULL DEFAULT 'AGENT',
    "manualRank" DOUBLE PRECISION,
    "peopleManagement" BOOLEAN,
    "buildVsOperate" "BuildVsOperate" NOT NULL DEFAULT 'INDETERMINADO',
    "compatibilityScore" INTEGER,
    "scoreSource" "ScoreSource",
    "autoTriagedAt" TIMESTAMP(3),
    "autoTriageModelId" TEXT,
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "latestScoreId" TEXT,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSighting" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "rawPostingId" TEXT,
    "externalId" TEXT NOT NULL,
    "url" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "JobSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobScore" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "resumeVersionId" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "interest" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "fitWhy" TEXT,
    "fitRedFlags" TEXT,
    "fitToConfirm" TEXT,
    "peopleManagement" BOOLEAN,
    "buildVsOperate" "BuildVsOperate" NOT NULL DEFAULT 'INDETERMINADO',
    "signals" TEXT[],
    "llmCallId" TEXT,
    "importNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobStatusChange" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fromStatus" "JobStatus",
    "toStatus" "JobStatus" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'user',
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageDecision" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "label" "TriageLabel" NOT NULL,
    "reason" TEXT,
    "featuresSnapshot" JSONB NOT NULL,
    "modelId" TEXT,
    "wasCorrection" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoringModel" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "coefficients" JSONB NOT NULL,
    "intercept" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "precision" DOUBLE PRECISION NOT NULL,
    "recall" DOUBLE PRECISION NOT NULL,
    "auc" DOUBLE PRECISION,
    "trainedOnCount" INTEGER NOT NULL,
    "shadowMode" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "trainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoringModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileRuleProposal" (
    "id" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "proposedRule" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "evidenceJobIds" TEXT[],
    "rationale" TEXT NOT NULL,
    "status" "RuleProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileRuleProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resumeVersionId" TEXT,
    "coverLetterId" TEXT,
    "tailoredResumeId" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT,
    "externalRef" TEXT,
    "notes" TEXT,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedDocument" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "baseResumeVersionId" TEXT,
    "profileVersionId" TEXT,
    "model" TEXT NOT NULL,
    "contentMarkdown" TEXT NOT NULL,
    "contentJson" JSONB,
    "blobUrl" TEXT,
    "pathname" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "llmCallId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeSuggestion" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "resumeVersionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "anchorText" TEXT,
    "beforeText" TEXT,
    "afterText" TEXT NOT NULL,
    "rationale" TEXT,
    "accepted" BOOLEAN,
    "llmCallId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ResumeSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "contentJson" JSONB NOT NULL,
    "contentText" TEXT NOT NULL DEFAULT '',
    "jobId" TEXT,
    "companyId" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "uniqueKey" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "rubricHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SearchProfile_version_key" ON "SearchProfile"("version");

-- CreateIndex
CREATE INDEX "SearchProfile_isActive_idx" ON "SearchProfile"("isActive");

-- CreateIndex
CREATE INDEX "ResumeVersion_isDefault_idx" ON "ResumeVersion"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVersion_label_version_key" ON "ResumeVersion"("label", "version");

-- CreateIndex
CREATE INDEX "ContextDocument_includeInPrompt_sortOrder_idx" ON "ContextDocument"("includeInPrompt", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE INDEX "Company_isFavorite_priority_idx" ON "Company"("isFavorite", "priority");

-- CreateIndex
CREATE INDEX "Company_health_idx" ON "Company"("health");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_alias_key" ON "CompanyAlias"("alias");

-- CreateIndex
CREATE INDEX "CompanyAlias_companyId_idx" ON "CompanyAlias"("companyId");

-- CreateIndex
CREATE INDEX "CompanyBoard_companyId_idx" ON "CompanyBoard"("companyId");

-- CreateIndex
CREATE INDEX "CompanyBoard_enabled_nextRetryAt_idx" ON "CompanyBoard"("enabled", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBoard_provider_slug_key" ON "CompanyBoard"("provider", "slug");

-- CreateIndex
CREATE INDEX "Source_enabled_priority_idx" ON "Source"("enabled", "priority");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "IngestionRun_runDate_runType_key" ON "IngestionRun"("runDate", "runType");

-- CreateIndex
CREATE INDEX "SourceRun_runId_idx" ON "SourceRun"("runId");

-- CreateIndex
CREATE INDEX "SourceRun_sourceKey_startedAt_idx" ON "SourceRun"("sourceKey", "startedAt");

-- CreateIndex
CREATE INDEX "RawPosting_decision_lastSeenAt_idx" ON "RawPosting"("decision", "lastSeenAt");

-- CreateIndex
CREATE INDEX "RawPosting_contentHash_idx" ON "RawPosting"("contentHash");

-- CreateIndex
CREATE INDEX "RawPosting_jobId_idx" ON "RawPosting"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "RawPosting_sourceKey_externalId_key" ON "RawPosting"("sourceKey", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_latestScoreId_key" ON "Job"("latestScoreId");

-- CreateIndex
CREATE INDEX "Job_status_interest_idx" ON "Job"("status", "interest" DESC);

-- CreateIndex
CREATE INDEX "Job_interest_discoveredAt_idx" ON "Job"("interest" DESC, "discoveredAt" DESC);

-- CreateIndex
CREATE INDEX "Job_manualRank_idx" ON "Job"("manualRank");

-- CreateIndex
CREATE INDEX "Job_companyId_status_idx" ON "Job"("companyId", "status");

-- CreateIndex
CREATE INDEX "Job_discoveredAt_idx" ON "Job"("discoveredAt" DESC);

-- CreateIndex
CREATE INDEX "Job_closedAt_idx" ON "Job"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_dedupTitle_key" ON "Job"("companyId", "dedupTitle");

-- CreateIndex
CREATE INDEX "JobSighting_jobId_idx" ON "JobSighting"("jobId");

-- CreateIndex
CREATE INDEX "JobSighting_lastSeenAt_idx" ON "JobSighting"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobSighting_sourceKey_externalId_key" ON "JobSighting"("sourceKey", "externalId");

-- CreateIndex
CREATE INDEX "JobScore_jobId_createdAt_idx" ON "JobScore"("jobId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "JobScore_rubricHash_idx" ON "JobScore"("rubricHash");

-- CreateIndex
CREATE UNIQUE INDEX "JobScore_jobId_rubricHash_key" ON "JobScore"("jobId", "rubricHash");

-- CreateIndex
CREATE INDEX "JobStatusChange_jobId_changedAt_idx" ON "JobStatusChange"("jobId", "changedAt");

-- CreateIndex
CREATE INDEX "TriageDecision_jobId_decidedAt_idx" ON "TriageDecision"("jobId", "decidedAt");

-- CreateIndex
CREATE INDEX "TriageDecision_modelId_idx" ON "TriageDecision"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoringModel_version_key" ON "ScoringModel"("version");

-- CreateIndex
CREATE INDEX "ScoringModel_trainedAt_idx" ON "ScoringModel"("trainedAt" DESC);

-- CreateIndex
CREATE INDEX "ProfileRuleProposal_status_createdAt_idx" ON "ProfileRuleProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Application_jobId_appliedAt_idx" ON "Application"("jobId", "appliedAt");

-- CreateIndex
CREATE INDEX "GeneratedDocument_jobId_kind_createdAt_idx" ON "GeneratedDocument"("jobId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ResumeSuggestion_jobId_resumeVersionId_idx" ON "ResumeSuggestion"("jobId", "resumeVersionId");

-- CreateIndex
CREATE INDEX "Note_jobId_updatedAt_idx" ON "Note"("jobId", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_companyId_updatedAt_idx" ON "Note"("companyId", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_updatedAt_idx" ON "Note"("updatedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Task_uniqueKey_key" ON "Task"("uniqueKey");

-- CreateIndex
CREATE INDEX "Task_status_runAt_idx" ON "Task"("status", "runAt");

-- CreateIndex
CREATE INDEX "LlmCall_createdAt_idx" ON "LlmCall"("createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_purpose_createdAt_idx" ON "LlmCall"("purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBoard" ADD CONSTRAINT "CompanyBoard_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "Source"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPosting" ADD CONSTRAINT "RawPosting_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "Source"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPosting" ADD CONSTRAINT "RawPosting_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_latestScoreId_fkey" FOREIGN KEY ("latestScoreId") REFERENCES "JobScore"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSighting" ADD CONSTRAINT "JobSighting_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSighting" ADD CONSTRAINT "JobSighting_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "Source"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSighting" ADD CONSTRAINT "JobSighting_rawPostingId_fkey" FOREIGN KEY ("rawPostingId") REFERENCES "RawPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScore" ADD CONSTRAINT "JobScore_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScore" ADD CONSTRAINT "JobScore_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "SearchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobScore" ADD CONSTRAINT "JobScore_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobStatusChange" ADD CONSTRAINT "JobStatusChange_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDecision" ADD CONSTRAINT "TriageDecision_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageDecision" ADD CONSTRAINT "TriageDecision_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ScoringModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileRuleProposal" ADD CONSTRAINT "ProfileRuleProposal_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "SearchProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_coverLetterId_fkey" FOREIGN KEY ("coverLetterId") REFERENCES "GeneratedDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tailoredResumeId_fkey" FOREIGN KEY ("tailoredResumeId") REFERENCES "GeneratedDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_baseResumeVersionId_fkey" FOREIGN KEY ("baseResumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedDocument" ADD CONSTRAINT "GeneratedDocument_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "SearchProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeSuggestion" ADD CONSTRAINT "ResumeSuggestion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeSuggestion" ADD CONSTRAINT "ResumeSuggestion_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCall" ADD CONSTRAINT "LlmCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
