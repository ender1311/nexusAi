-- Add indexes on Agent for common query patterns
CREATE INDEX IF NOT EXISTS "Agent_updatedAt_idx" ON "Agent"("updatedAt" DESC);
CREATE INDEX IF NOT EXISTS "Agent_status_idx" ON "Agent"("status");
