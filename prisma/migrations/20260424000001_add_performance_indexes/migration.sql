-- Performance indexes for cron + ingest hot paths

-- Cron: cursor-paginate users by persona
CREATE INDEX "idx_users_persona_id" ON "User"("personaId");

-- Ingest + frequency cap: look up decisions by agent + user + time window
CREATE INDEX "idx_decisions_agent_user_sent" ON "UserDecision"("agentId", "userId", "sentAt");

-- Bandit: load arm stats for a given agent × persona
CREATE INDEX "idx_arm_stats_agent_persona" ON "PersonaArmStats"("agentId", "personaId");
