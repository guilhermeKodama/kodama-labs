-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DataSource" ADD VALUE 'CAMARA_LEGISLATIVE';
ALTER TYPE "DataSource" ADD VALUE 'STF';
ALTER TYPE "DataSource" ADD VALUE 'CURATED';
ALTER TYPE "DataSource" ADD VALUE 'NEWS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'LEGAL_HISTORY';
ALTER TYPE "AlertType" ADD VALUE 'VOTING_INCOHERENCE';

-- CreateTable
CREATE TABLE "candidacies" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "electionYear" INTEGER NOT NULL,
    "position" TEXT,
    "state" TEXT,
    "ballotNumber" TEXT,
    "party" TEXT,
    "coalition" TEXT,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "source" "DataSource" NOT NULL,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidacies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parliamentary_expenses" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierDoc" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "documentDate" TIMESTAMP(3),
    "documentId" TEXT,
    "documentUrl" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parliamentary_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legislative_proposals" (
    "id" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" INTEGER,
    "year" INTEGER,
    "title" TEXT NOT NULL,
    "themes" TEXT[],
    "summary" TEXT,
    "presentedAt" TIMESTAMP(3),
    "status" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legislative_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_authorships" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'AUTHOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_authorships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legislative_votes" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "votacaoId" TEXT NOT NULL,
    "proposalId" TEXT,
    "house" TEXT NOT NULL,
    "vote" TEXT NOT NULL,
    "votacaoDate" TIMESTAMP(3),
    "votacaoTitle" TEXT,
    "orientationGov" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legislative_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "committee_memberships" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "committee" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "committee_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_terms" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "legislature" INTEGER NOT NULL,
    "position" TEXT NOT NULL,
    "state" TEXT,
    "party" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_affiliation_changes" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "fromParty" TEXT,
    "toParty" TEXT NOT NULL,
    "changeDate" TIMESTAMP(3),
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_affiliation_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_votes" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "house" TEXT NOT NULL,
    "votacaoExternalId" TEXT,
    "proposalExternalId" TEXT,
    "favorableVote" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_stances" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "verifiedBy" TEXT,
    "sourceUrl" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_stances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_proceedings" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "court" TEXT,
    "caseNumber" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "decisionDate" TIMESTAMP(3),
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "makesIneligible" BOOLEAN NOT NULL DEFAULT false,
    "source" "DataSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "verifiedBy" TEXT,
    "sourceUrl" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_proceedings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politician_scorecards" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "electionYear" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "valueNum" DOUBLE PRECISION,
    "valueText" TEXT,
    "details" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politician_scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politician_news" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "snippet" TEXT,
    "imageUrl" TEXT,
    "themes" TEXT[],
    "matchConfidence" DOUBLE PRECISION,
    "credibility" TEXT,
    "factCheckStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "factCheckUrl" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politician_news_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidacies_electionYear_status_idx" ON "candidacies"("electionYear", "status");

-- CreateIndex
CREATE INDEX "candidacies_politicianId_idx" ON "candidacies"("politicianId");

-- CreateIndex
CREATE UNIQUE INDEX "candidacies_politicianId_electionYear_key" ON "candidacies"("politicianId", "electionYear");

-- CreateIndex
CREATE INDEX "parliamentary_expenses_politicianId_idx" ON "parliamentary_expenses"("politicianId");

-- CreateIndex
CREATE INDEX "parliamentary_expenses_politicianId_year_month_idx" ON "parliamentary_expenses"("politicianId", "year", "month");

-- CreateIndex
CREATE INDEX "parliamentary_expenses_category_idx" ON "parliamentary_expenses"("category");

-- CreateIndex
CREATE INDEX "parliamentary_expenses_supplierDoc_idx" ON "parliamentary_expenses"("supplierDoc");

-- CreateIndex
CREATE UNIQUE INDEX "parliamentary_expenses_house_documentId_key" ON "parliamentary_expenses"("house", "documentId");

-- CreateIndex
CREATE INDEX "legislative_proposals_type_year_idx" ON "legislative_proposals"("type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "legislative_proposals_house_externalId_key" ON "legislative_proposals"("house", "externalId");

-- CreateIndex
CREATE INDEX "bill_authorships_politicianId_idx" ON "bill_authorships"("politicianId");

-- CreateIndex
CREATE INDEX "bill_authorships_proposalId_idx" ON "bill_authorships"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_authorships_politicianId_proposalId_role_key" ON "bill_authorships"("politicianId", "proposalId", "role");

-- CreateIndex
CREATE INDEX "legislative_votes_politicianId_idx" ON "legislative_votes"("politicianId");

-- CreateIndex
CREATE INDEX "legislative_votes_votacaoId_idx" ON "legislative_votes"("votacaoId");

-- CreateIndex
CREATE INDEX "legislative_votes_proposalId_idx" ON "legislative_votes"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "legislative_votes_politicianId_votacaoId_key" ON "legislative_votes"("politicianId", "votacaoId");

-- CreateIndex
CREATE INDEX "committee_memberships_politicianId_idx" ON "committee_memberships"("politicianId");

-- CreateIndex
CREATE INDEX "committee_memberships_committee_idx" ON "committee_memberships"("committee");

-- CreateIndex
CREATE INDEX "mandate_terms_politicianId_idx" ON "mandate_terms"("politicianId");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_terms_politicianId_legislature_house_key" ON "mandate_terms"("politicianId", "legislature", "house");

-- CreateIndex
CREATE INDEX "party_affiliation_changes_politicianId_idx" ON "party_affiliation_changes"("politicianId");

-- CreateIndex
CREATE UNIQUE INDEX "key_votes_slug_key" ON "key_votes"("slug");

-- CreateIndex
CREATE INDEX "key_votes_theme_idx" ON "key_votes"("theme");

-- CreateIndex
CREATE INDEX "policy_stances_politicianId_idx" ON "policy_stances"("politicianId");

-- CreateIndex
CREATE UNIQUE INDEX "policy_stances_politicianId_theme_source_key" ON "policy_stances"("politicianId", "theme", "source");

-- CreateIndex
CREATE INDEX "legal_proceedings_politicianId_idx" ON "legal_proceedings"("politicianId");

-- CreateIndex
CREATE INDEX "legal_proceedings_kind_idx" ON "legal_proceedings"("kind");

-- CreateIndex
CREATE INDEX "legal_proceedings_status_idx" ON "legal_proceedings"("status");

-- CreateIndex
CREATE INDEX "legal_proceedings_makesIneligible_idx" ON "legal_proceedings"("makesIneligible");

-- CreateIndex
CREATE INDEX "politician_scorecards_politicianId_idx" ON "politician_scorecards"("politicianId");

-- CreateIndex
CREATE INDEX "politician_scorecards_metric_idx" ON "politician_scorecards"("metric");

-- CreateIndex
CREATE UNIQUE INDEX "politician_scorecards_politicianId_electionYear_metric_key" ON "politician_scorecards"("politicianId", "electionYear", "metric");

-- CreateIndex
CREATE INDEX "politician_news_politicianId_publishedAt_idx" ON "politician_news"("politicianId", "publishedAt");

-- CreateIndex
CREATE INDEX "politician_news_factCheckStatus_idx" ON "politician_news"("factCheckStatus");

-- CreateIndex
CREATE UNIQUE INDEX "politician_news_politicianId_url_key" ON "politician_news"("politicianId", "url");

-- AddForeignKey
ALTER TABLE "candidacies" ADD CONSTRAINT "candidacies_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parliamentary_expenses" ADD CONSTRAINT "parliamentary_expenses_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_authorships" ADD CONSTRAINT "bill_authorships_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_authorships" ADD CONSTRAINT "bill_authorships_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "legislative_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_votes" ADD CONSTRAINT "legislative_votes_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legislative_votes" ADD CONSTRAINT "legislative_votes_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "legislative_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "committee_memberships" ADD CONSTRAINT "committee_memberships_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_terms" ADD CONSTRAINT "mandate_terms_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_affiliation_changes" ADD CONSTRAINT "party_affiliation_changes_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_stances" ADD CONSTRAINT "policy_stances_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_proceedings" ADD CONSTRAINT "legal_proceedings_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politician_scorecards" ADD CONSTRAINT "politician_scorecards_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politician_news" ADD CONSTRAINT "politician_news_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

