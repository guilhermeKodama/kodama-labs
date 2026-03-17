-- CreateIndex
CREATE UNIQUE INDEX "transactions_externalId_businessId_key" ON "transactions"("externalId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_externalId_personalAccountId_key" ON "transactions"("externalId", "personalAccountId");
