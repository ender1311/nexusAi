-- Replace separate Agent indexes with a composite (status, updatedAt DESC) index
-- that covers the agents list page filter (WHERE status=...) + sort (ORDER BY updatedAt DESC)
DROP INDEX IF EXISTS "Agent_updatedAt_idx";
DROP INDEX IF EXISTS "Agent_status_idx";
CREATE INDEX IF NOT EXISTS "Agent_status_updatedAt_idx" ON "Agent" ("status", "updatedAt" DESC);

-- Add composite (channel, sentAt) index on UserDecision for push-specific groupBy queries
-- (WHERE channel='push' AND sentAt >= N GROUP BY agentId)
CREATE INDEX IF NOT EXISTS "UserDecision_channel_sentAt_idx" ON "UserDecision" ("channel", "sentAt");
