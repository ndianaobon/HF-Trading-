-- CreateIndex
CREATE INDEX "AutoBotTrade_participantId_status_idx" ON "AutoBotTrade"("participantId", "status");

-- CreateIndex
CREATE INDEX "CopyTrade_subscriptionId_status_idx" ON "CopyTrade"("subscriptionId", "status");

