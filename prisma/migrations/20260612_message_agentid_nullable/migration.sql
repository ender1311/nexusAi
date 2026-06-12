-- Make Message.agentId nullable — library messages (push/email) use agentId = NULL
-- instead of sentinel agent rows. Existing library messages are detached first,
-- then the now-orphaned sentinel agents are deleted.

ALTER TABLE "Message" ALTER COLUMN "agentId" DROP NOT NULL;

-- Detach library messages from their sentinel agents
UPDATE "Message"
SET "agentId" = NULL
WHERE "agentId" IN (
  SELECT id FROM "Agent"
  WHERE name IN ('Push Copy Library', '__email_library__')
);

-- Remove the sentinel agents (no child rows remain after the UPDATE above)
DELETE FROM "Agent" WHERE name IN ('Push Copy Library', '__email_library__');
