-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('PNCP', 'TRANSPARENCIA', 'COMPRAS_GOV', 'CEIS', 'CNEP', 'TCU', 'CNPJ', 'MARKET_PRICE', 'TSE', 'CAMARA', 'SENADO');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('OVERPRICING', 'SHELL_COMPANY', 'SANCTIONED_ENTITY', 'SUSPICIOUS_NETWORK', 'AI_FLAG', 'POLITICAL_LINK');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SanctionSource" AS ENUM ('CEIS', 'CNEP', 'TCU');

-- CreateTable
CREATE TABLE "ingestion_cursors" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL,
    "cursorValue" TEXT,
    "totalFetched" INTEGER NOT NULL DEFAULT 0,
    "status" "JobStatus" NOT NULL DEFAULT 'IDLE',
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingestion_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_records" (
    "id" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "recordType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "raw_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurements" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "orgCnpj" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "orgPower" TEXT,
    "orgSphere" TEXT,
    "unitName" TEXT,
    "unitCode" TEXT,
    "ibgeCode" TEXT,
    "year" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "sequencial" INTEGER,
    "modality" TEXT NOT NULL,
    "modalityId" INTEGER,
    "description" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "statusId" INTEGER,
    "estimatedValue" DECIMAL(65,30),
    "approvedValue" DECIMAL(65,30),
    "totalValue" DECIMAL(65,30),
    "processo" TEXT,
    "legalBasis" TEXT,
    "legalBasisDescription" TEXT,
    "disputeMode" TEXT,
    "disputeModeId" INTEGER,
    "isSrp" BOOLEAN,
    "instrumentType" TEXT,
    "instrumentTypeId" INTEGER,
    "proposalOpenDate" TIMESTAMP(3),
    "proposalCloseDate" TIMESTAMP(3),
    "confidentialBudget" BOOLEAN NOT NULL DEFAULT false,
    "linkOrigem" TEXT,
    "linkProcesso" TEXT,
    "budgetSources" JSONB,
    "itemsEnrichedAt" TIMESTAMP(3),
    "state" TEXT,
    "city" TEXT,
    "riskScore" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawRecordId" TEXT,

    CONSTRAINT "procurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_items" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "procurementId" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "catmatCode" TEXT,
    "ncmCode" TEXT,
    "catalogCode" TEXT,
    "materialOrService" TEXT,
    "materialOrServiceName" TEXT,
    "situationId" INTEGER,
    "situationName" TEXT,
    "judgmentCriteria" TEXT,
    "judgmentCriteriaId" INTEGER,
    "benefitType" TEXT,
    "hasResult" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "procurement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_results" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sequencial" INTEGER NOT NULL,
    "supplierCnpj" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierSize" TEXT,
    "supplierType" TEXT,
    "countryCode" TEXT,
    "unitPrice" DECIMAL(65,30) NOT NULL,
    "totalPrice" DECIMAL(65,30) NOT NULL,
    "quantity" DECIMAL(65,30),
    "discount" DOUBLE PRECISION,
    "ranking" INTEGER,
    "isSubcontracted" BOOLEAN NOT NULL DEFAULT false,
    "resultDate" TIMESTAMP(3),
    "situationId" INTEGER,
    "situationName" TEXT,

    CONSTRAINT "bid_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "procurementId" TEXT,
    "procurementExternalId" TEXT,
    "orgCnpj" TEXT,
    "orgName" TEXT,
    "unitName" TEXT,
    "unitState" TEXT,
    "unitCity" TEXT,
    "supplierCnpj" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierType" TEXT,
    "supplierCountry" TEXT,
    "objectDescription" TEXT,
    "categoryName" TEXT,
    "categoryId" INTEGER,
    "contractType" TEXT,
    "contractTypeId" INTEGER,
    "processo" TEXT,
    "contractNumber" TEXT,
    "value" DECIMAL(65,30) NOT NULL,
    "initialValue" DECIMAL(65,30),
    "globalValue" DECIMAL(65,30),
    "installmentValue" DECIMAL(65,30),
    "installmentCount" INTEGER,
    "accumulatedValue" DECIMAL(65,30),
    "signatureDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "amendmentCount" INTEGER NOT NULL DEFAULT 0,
    "isRevenue" BOOLEAN NOT NULL DEFAULT false,
    "subcontractorCnpj" TEXT,
    "subcontractorName" TEXT,
    "description" TEXT NOT NULL,
    "rawRecordId" TEXT,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tradeName" TEXT,
    "legalNature" TEXT,
    "openDate" TIMESTAMP(3),
    "capital" DECIMAL(65,30),
    "activityCode" TEXT,
    "activityDesc" TEXT,
    "address" TEXT,
    "state" TEXT,
    "city" TEXT,
    "employeeCount" INTEGER,
    "riskScore" DOUBLE PRECISION,
    "isShellCompany" BOOLEAN NOT NULL DEFAULT false,
    "enrichedAt" TIMESTAMP(3),
    "rawRecordId" TEXT,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholders" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "role" TEXT NOT NULL,

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "entityId" TEXT,
    "cnpjCpf" TEXT NOT NULL,
    "personName" TEXT,
    "personType" TEXT,
    "source" "SanctionSource" NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "sanctionType" TEXT,
    "legalBasis" TEXT,
    "sanctioningOrg" TEXT,
    "sanctioningOrgState" TEXT,
    "sanctioningOrgPower" TEXT,
    "sanctioningOrgSphere" TEXT,
    "processNumber" TEXT,
    "publicationDate" TIMESTAMP(3),
    "transitDate" TIMESTAMP(3),
    "originDate" TIMESTAMP(3),
    "rawRecordId" TEXT,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_references" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT,

    CONSTRAINT "price_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_analyses" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "medianGovPrice" DECIMAL(65,30),
    "avgMarketPrice" DECIMAL(65,30),
    "deviation" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "isOverpriced" BOOLEAN NOT NULL,
    "details" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "procurementId" TEXT,
    "contractId" TEXT,
    "entityId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "analysisType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "findings" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "tokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procurementId" TEXT,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politicians" (
    "id" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ballotName" TEXT,
    "party" TEXT,
    "position" TEXT NOT NULL,
    "state" TEXT,
    "city" TEXT,
    "electionYear" INTEGER,
    "elected" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "photoUrl" TEXT,
    "externalId" TEXT,
    "rawRecordId" TEXT,
    "birthDate" TIMESTAMP(3),
    "birthState" TEXT,
    "birthCity" TEXT,
    "gender" TEXT,
    "education" TEXT,
    "maritalStatus" TEXT,
    "occupation" TEXT,
    "email" TEXT,
    "familyFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "politicians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_donations" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "donorName" TEXT NOT NULL,
    "donorCpfCnpj" TEXT NOT NULL,
    "donorType" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "electionYear" INTEGER NOT NULL,
    "description" TEXT,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "donorNameRfb" TEXT,
    "donorCnae" TEXT,
    "donorState" TEXT,
    "donorCity" TEXT,
    "donationDate" TIMESTAMP(3),
    "receiptNumber" TEXT,
    "originType" TEXT,
    "sourceType" TEXT,
    "speciesType" TEXT,
    "candidateName" TEXT,
    "candidateParty" TEXT,
    "candidatePosition" TEXT,
    "state" TEXT,

    CONSTRAINT "campaign_donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "political_links" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "entityId" TEXT,
    "shareholderId" TEXT,
    "contractId" TEXT,
    "linkType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "political_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_assets" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "electionYear" INTEGER NOT NULL,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_servants" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "cpf" TEXT NOT NULL,
    "cargo" TEXT,
    "funcao" TEXT,
    "orgao" TEXT,
    "orgaoCode" TEXT,
    "situacao" TEXT,
    "remuneracao" DECIMAL(65,30),
    "dataAdmissao" TIMESTAMP(3),
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_servants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politician_relatives" (
    "id" TEXT NOT NULL,
    "politicianId" TEXT NOT NULL,
    "relativeCpf" TEXT NOT NULL,
    "relativeName" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rawRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politician_relatives_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "ingestion_cursors_source_endpoint_key" ON "ingestion_cursors"("source", "endpoint");

-- CreateIndex
CREATE INDEX "raw_records_source_recordType_processedAt_idx" ON "raw_records"("source", "recordType", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "raw_records_source_recordType_externalId_key" ON "raw_records"("source", "recordType", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "procurements_externalId_key" ON "procurements"("externalId");

-- CreateIndex
CREATE INDEX "procurements_orgCnpj_idx" ON "procurements"("orgCnpj");

-- CreateIndex
CREATE INDEX "procurements_state_city_idx" ON "procurements"("state", "city");

-- CreateIndex
CREATE INDEX "procurements_publishedAt_idx" ON "procurements"("publishedAt");

-- CreateIndex
CREATE INDEX "procurements_riskScore_idx" ON "procurements"("riskScore");

-- CreateIndex
CREATE INDEX "procurements_itemsEnrichedAt_idx" ON "procurements"("itemsEnrichedAt");

-- CreateIndex
CREATE INDEX "procurements_publishedAt_id_idx" ON "procurements"("publishedAt" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_items_externalId_key" ON "procurement_items"("externalId");

-- CreateIndex
CREATE INDEX "procurement_items_catmatCode_idx" ON "procurement_items"("catmatCode");

-- CreateIndex
CREATE INDEX "procurement_items_ncmCode_idx" ON "procurement_items"("ncmCode");

-- CreateIndex
CREATE INDEX "procurement_items_procurementId_idx" ON "procurement_items"("procurementId");

-- CreateIndex
CREATE INDEX "bid_results_supplierCnpj_idx" ON "bid_results"("supplierCnpj");

-- CreateIndex
CREATE INDEX "bid_results_itemId_idx" ON "bid_results"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "bid_results_itemId_sequencial_key" ON "bid_results"("itemId", "sequencial");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_externalId_key" ON "contracts"("externalId");

-- CreateIndex
CREATE INDEX "contracts_supplierCnpj_idx" ON "contracts"("supplierCnpj");

-- CreateIndex
CREATE INDEX "contracts_orgCnpj_idx" ON "contracts"("orgCnpj");

-- CreateIndex
CREATE INDEX "contracts_procurementId_idx" ON "contracts"("procurementId");

-- CreateIndex
CREATE INDEX "contracts_startDate_idx" ON "contracts"("startDate");

-- CreateIndex
CREATE INDEX "contracts_publishedAt_idx" ON "contracts"("publishedAt");

-- CreateIndex
CREATE INDEX "contracts_startDate_id_idx" ON "contracts"("startDate" DESC, "id");

-- CreateIndex
CREATE UNIQUE INDEX "entities_cnpj_key" ON "entities"("cnpj");

-- CreateIndex
CREATE INDEX "entities_state_city_idx" ON "entities"("state", "city");

-- CreateIndex
CREATE INDEX "entities_riskScore_idx" ON "entities"("riskScore");

-- CreateIndex
CREATE INDEX "entities_isShellCompany_idx" ON "entities"("isShellCompany");

-- CreateIndex
CREATE INDEX "shareholders_cpfCnpj_idx" ON "shareholders"("cpfCnpj");

-- CreateIndex
CREATE INDEX "shareholders_entityId_idx" ON "shareholders"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "sanctions_externalId_key" ON "sanctions"("externalId");

-- CreateIndex
CREATE INDEX "sanctions_cnpjCpf_idx" ON "sanctions"("cnpjCpf");

-- CreateIndex
CREATE INDEX "sanctions_entityId_idx" ON "sanctions"("entityId");

-- CreateIndex
CREATE INDEX "sanctions_source_idx" ON "sanctions"("source");

-- CreateIndex
CREATE INDEX "sanctions_endDate_idx" ON "sanctions"("endDate");

-- CreateIndex
CREATE INDEX "price_references_itemId_idx" ON "price_references"("itemId");

-- CreateIndex
CREATE INDEX "price_analyses_itemId_idx" ON "price_analyses"("itemId");

-- CreateIndex
CREATE INDEX "price_analyses_isOverpriced_idx" ON "price_analyses"("isOverpriced");

-- CreateIndex
CREATE INDEX "alerts_type_idx" ON "alerts"("type");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_createdAt_idx" ON "alerts"("createdAt");

-- CreateIndex
CREATE INDEX "alerts_procurementId_idx" ON "alerts"("procurementId");

-- CreateIndex
CREATE INDEX "alerts_contractId_idx" ON "alerts"("contractId");

-- CreateIndex
CREATE INDEX "alerts_entityId_idx" ON "alerts"("entityId");

-- CreateIndex
CREATE INDEX "ai_analyses_targetType_targetId_idx" ON "ai_analyses"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ai_analyses_analysisType_idx" ON "ai_analyses"("analysisType");

-- CreateIndex
CREATE INDEX "ai_analyses_createdAt_idx" ON "ai_analyses"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "politicians_cpf_key" ON "politicians"("cpf");

-- CreateIndex
CREATE INDEX "politicians_cpf_idx" ON "politicians"("cpf");

-- CreateIndex
CREATE INDEX "politicians_party_idx" ON "politicians"("party");

-- CreateIndex
CREATE INDEX "politicians_state_idx" ON "politicians"("state");

-- CreateIndex
CREATE INDEX "politicians_position_idx" ON "politicians"("position");

-- CreateIndex
CREATE INDEX "politicians_active_elected_name_id_idx" ON "politicians"("active", "elected", "name", "id");

-- CreateIndex
CREATE INDEX "campaign_donations_donorCpfCnpj_idx" ON "campaign_donations"("donorCpfCnpj");

-- CreateIndex
CREATE INDEX "campaign_donations_politicianId_idx" ON "campaign_donations"("politicianId");

-- CreateIndex
CREATE INDEX "campaign_donations_donorState_idx" ON "campaign_donations"("donorState");

-- CreateIndex
CREATE INDEX "political_links_politicianId_idx" ON "political_links"("politicianId");

-- CreateIndex
CREATE INDEX "political_links_entityId_idx" ON "political_links"("entityId");

-- CreateIndex
CREATE INDEX "political_links_linkType_idx" ON "political_links"("linkType");

-- CreateIndex
CREATE INDEX "candidate_assets_politicianId_idx" ON "candidate_assets"("politicianId");

-- CreateIndex
CREATE INDEX "candidate_assets_electionYear_idx" ON "candidate_assets"("electionYear");

-- CreateIndex
CREATE INDEX "public_servants_politicianId_idx" ON "public_servants"("politicianId");

-- CreateIndex
CREATE INDEX "public_servants_cpf_idx" ON "public_servants"("cpf");

-- CreateIndex
CREATE INDEX "politician_relatives_relativeCpf_idx" ON "politician_relatives"("relativeCpf");

-- CreateIndex
CREATE UNIQUE INDEX "politician_relatives_politicianId_relativeCpf_key" ON "politician_relatives"("politicianId", "relativeCpf");

-- CreateIndex
CREATE INDEX "job_runs_jobName_idx" ON "job_runs"("jobName");

-- CreateIndex
CREATE INDEX "job_runs_layer_idx" ON "job_runs"("layer");

-- CreateIndex
CREATE INDEX "job_runs_startedAt_idx" ON "job_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "procurement_items" ADD CONSTRAINT "procurement_items_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_results" ADD CONSTRAINT "bid_results_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "procurement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplierCnpj_fkey" FOREIGN KEY ("supplierCnpj") REFERENCES "entities"("cnpj") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_references" ADD CONSTRAINT "price_references_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "procurement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_analyses" ADD CONSTRAINT "price_analyses_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "procurement_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_procurementId_fkey" FOREIGN KEY ("procurementId") REFERENCES "procurements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_donations" ADD CONSTRAINT "campaign_donations_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "political_links" ADD CONSTRAINT "political_links_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "political_links" ADD CONSTRAINT "political_links_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_assets" ADD CONSTRAINT "candidate_assets_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_servants" ADD CONSTRAINT "public_servants_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politician_relatives" ADD CONSTRAINT "politician_relatives_politicianId_fkey" FOREIGN KEY ("politicianId") REFERENCES "politicians"("id") ON DELETE CASCADE ON UPDATE CASCADE;
