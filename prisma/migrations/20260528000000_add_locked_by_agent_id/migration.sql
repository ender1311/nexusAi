-- AlterTable: add agent lock field to TrackedUser (mapped to "User" table)
-- No FK constraint — follows UserAgentAssignment pattern (survives agent soft-delete)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedByAgentId" TEXT;

-- CreateIndex: speeds up lock release queries (WHERE lockedByAgentId = agentId)
CREATE INDEX IF NOT EXISTS "User_lockedByAgentId_idx" ON "User"("lockedByAgentId");
