-- Add uniqueUsersCap to Agent.
-- Lifetime cap on the number of distinct users this agent will ever target.
-- null = unlimited. Enforced at cron time: agent is skipped once COUNT(DISTINCT externalUserId) >= cap.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "uniqueUsersCap" INTEGER;
