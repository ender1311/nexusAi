-- AddIndex: Message.agentId
CREATE INDEX IF NOT EXISTS "Message_agentId_idx" ON "Message"("agentId");

-- AddIndex: Goal.agentId
CREATE INDEX IF NOT EXISTS "Goal_agentId_idx" ON "Goal"("agentId");

-- AddIndex: CampaignContent.campaign + status
CREATE INDEX IF NOT EXISTS "CampaignContent_campaign_status_idx" ON "CampaignContent"("campaign", "status");
