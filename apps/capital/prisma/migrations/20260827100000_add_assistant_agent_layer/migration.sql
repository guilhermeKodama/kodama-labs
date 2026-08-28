-- CreateEnum
CREATE TYPE "AgentConversationStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "AgentTurnStatus" AS ENUM ('running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ImportPlanKind" AS ENUM ('import', 'revert');

-- CreateEnum
CREATE TYPE "ImportPlanStatus" AS ENUM ('proposed', 'confirmed', 'committed', 'rejected', 'superseded', 'reverted');

-- CreateEnum
CREATE TYPE "StatementFileType" AS ENUM ('ofx', 'csv', 'pdf');

-- AlterTable
ALTER TABLE "investment_accounts" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "investment_transactions" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "statement_imports" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "importPlanId" TEXT,
ADD COLUMN     "revertedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "status" "AgentConversationStatus" NOT NULL DEFAULT 'active',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turns" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" "AgentTurnStatus" NOT NULL DEFAULT 'running',
    "model" TEXT NOT NULL,
    "iterations" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationInputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadInputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "agent_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_files" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileType" "StatementFileType" NOT NULL,
    "statementKind" TEXT,
    "blobUrl" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "parsedPayload" JSONB,
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_plans" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ImportPlanKind" NOT NULL DEFAULT 'import',
    "status" "ImportPlanStatus" NOT NULL DEFAULT 'proposed',
    "entityType" "EntityType",
    "entityId" TEXT,
    "fileId" TEXT,
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "confirmedAt" TIMESTAMP(3),
    "confirmedVia" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT,
    "planId" TEXT,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdRecords" JSONB,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_conversations_userId_lastMessageAt_idx" ON "agent_conversations"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "agent_messages_conversationId_createdAt_idx" ON "agent_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_messages_turnId_idx" ON "agent_messages"("turnId");

-- CreateIndex
CREATE INDEX "agent_turns_conversationId_idx" ON "agent_turns"("conversationId");

-- CreateIndex
CREATE INDEX "agent_turns_createdAt_idx" ON "agent_turns"("createdAt");

-- CreateIndex
CREATE INDEX "conversation_files_conversationId_idx" ON "conversation_files"("conversationId");

-- CreateIndex
CREATE INDEX "import_plans_conversationId_status_idx" ON "import_plans"("conversationId", "status");

-- CreateIndex
CREATE INDEX "agent_actions_conversationId_createdAt_idx" ON "agent_actions"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_actions_planId_idx" ON "agent_actions"("planId");

-- CreateIndex
CREATE INDEX "investment_transactions_externalId_idx" ON "investment_transactions"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "investment_transactions_holdingId_externalId_key" ON "investment_transactions"("holdingId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "statement_imports_importPlanId_key" ON "statement_imports"("importPlanId");

-- CreateIndex
CREATE INDEX "statement_imports_conversationId_idx" ON "statement_imports"("conversationId");

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_importPlanId_fkey" FOREIGN KEY ("importPlanId") REFERENCES "import_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "agent_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_files" ADD CONSTRAINT "conversation_files_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_plans" ADD CONSTRAINT "import_plans_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "conversation_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "agent_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "import_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

