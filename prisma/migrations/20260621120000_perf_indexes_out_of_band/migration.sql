-- Records the four performance indexes that were applied to production out-of-band
-- (2026-06-16) so fresh environments (preview deploys, new DBs) create them via
-- `migrate deploy`. IF NOT EXISTS → no-op on prod and any DB that already has them.
-- Two are partial indexes (WHERE ...), which Prisma `@@index` can't express — hence
-- they live here as raw SQL rather than in the schema models. Plain (non-CONCURRENT)
-- because Prisma runs migrations in a transaction; on a fresh/empty table the build
-- is instant, and on prod the IF NOT EXISTS short-circuits before any lock.

CREATE INDEX IF NOT EXISTS "UserDecision_sent_agent_sentAt_user_idx"
  ON "UserDecision" ("agentId", "sentAt", "userId") WHERE "brazeSendId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "UserDecision_agent_convEvent_convAt_idx"
  ON "UserDecision" ("agentId", "conversionEvent", "conversionAt");

CREATE INDEX IF NOT EXISTS "UserAgentAssignment_active_agentId_idx"
  ON "UserAgentAssignment" ("agentId") WHERE "releasedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserAgentAssignment_agent_startedAt_idx"
  ON "UserAgentAssignment" ("agentId", "startedAt");
