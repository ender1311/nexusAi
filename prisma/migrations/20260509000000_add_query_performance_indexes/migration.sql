-- Performance indexes for hot query paths across cron, performance pages, and variant picker
-- See CLAUDE.md architecture section for query pattern analysis

-- UserDecision: fleet-wide 30d/24h window (performance page, dashboard counts, chart data)
CREATE INDEX IF NOT EXISTS "UserDecision_sentAt_idx" ON "UserDecision"("sentAt");

-- UserDecision: global daily cap check + event attribution (userId IN [...] AND sentAt >= today)
CREATE INDEX IF NOT EXISTS "UserDecision_userId_sentAt_idx" ON "UserDecision"("userId", "sentAt");

-- UserDecision: per-agent performance page (WHERE agentId = X AND sentAt >= 30d)
-- The existing (agentId, userId, sentAt) index has userId in the middle, so this fills the gap.
CREATE INDEX IF NOT EXISTS "UserDecision_agentId_sentAt_idx" ON "UserDecision"("agentId", "sentAt");

-- UserDecision: cron send-ID budget count (WHERE sentAt >= today AND brazeSendId IS NOT NULL)
CREATE INDEX IF NOT EXISTS "UserDecision_sentAt_brazeSendId_idx" ON "UserDecision"("sentAt", "brazeSendId");

-- TrackedUser (mapped to "User"): cron funnelStage filter (WHERE funnelStage = 'wau')
CREATE INDEX IF NOT EXISTS "User_funnelStage_idx" ON "User"("funnelStage");

-- TrackedUser: compound persona + stage for cron eligibility queries
CREATE INDEX IF NOT EXISTS "User_personaId_funnelStage_idx" ON "User"("personaId", "funnelStage");

-- MessageVariant: variant picker API (WHERE status = 'active' AND category = X AND subcategory = Y)
CREATE INDEX IF NOT EXISTS "MessageVariant_status_category_subcategory_idx" ON "MessageVariant"("status", "category", "subcategory");

-- ModelMetric: agent metrics history queries
CREATE INDEX IF NOT EXISTS "ModelMetric_agentId_timestamp_idx" ON "ModelMetric"("agentId", "timestamp");
