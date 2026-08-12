-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Beacon" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "sendError" TEXT,

    CONSTRAINT "Beacon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FocusWindow" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "FocusWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessageMeta" (
    "id" TEXT NOT NULL,
    "chatIdHash" TEXT NOT NULL,
    "senderHash" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "length" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageMeta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_deadAt_idx" ON "PushSubscription"("deadAt");

-- CreateIndex
CREATE INDEX "Beacon_subscriptionId_sentAt_idx" ON "Beacon"("subscriptionId", "sentAt");

-- CreateIndex
CREATE INDEX "Beacon_sentAt_idx" ON "Beacon"("sentAt");

-- CreateIndex
CREATE INDEX "FocusWindow_startsAt_idx" ON "FocusWindow"("startsAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessageMeta_chatIdHash_occurredAt_idx" ON "WhatsAppMessageMeta"("chatIdHash", "occurredAt");

-- AddForeignKey
ALTER TABLE "Beacon" ADD CONSTRAINT "Beacon_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
