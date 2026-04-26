-- RenameIndex
ALTER INDEX "idx_arm_stats_agent_persona" RENAME TO "PersonaArmStats_agentId_personaId_idx";

-- RenameIndex
ALTER INDEX "idx_users_persona_id" RENAME TO "User_personaId_idx";

-- RenameIndex
ALTER INDEX "idx_decisions_agent_user_sent" RENAME TO "UserDecision_agentId_userId_sentAt_idx";
