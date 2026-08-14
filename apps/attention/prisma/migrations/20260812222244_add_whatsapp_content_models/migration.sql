-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL,
    "waChatId" TEXT NOT NULL,
    "name" TEXT,
    "isGroup" BOOLEAN NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "backfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "waContactId" TEXT NOT NULL,
    "name" TEXT,
    "pushname" TEXT,
    "isMyContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderContactId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "mentionedMe" BOOLEAN NOT NULL DEFAULT false,
    "quotedWaMessageId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationStatus" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    "qrPayload" TEXT,
    "sessionStartedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "IntegrationStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Chat_waChatId_key" ON "Chat"("waChatId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_waContactId_key" ON "Contact"("waContactId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");

-- CreateIndex
CREATE INDEX "Message_chatId_occurredAt_idx" ON "Message"("chatId", "occurredAt");

-- CreateIndex
CREATE INDEX "Message_occurredAt_idx" ON "Message"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationStatus_channel_key" ON "IntegrationStatus"("channel");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderContactId_fkey" FOREIGN KEY ("senderContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
