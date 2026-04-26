-- Add action features to MessageVariant (semantic descriptor for oracle generalization)
ALTER TABLE "MessageVariant" ADD COLUMN "actionFeatures" JSONB;

-- Add decision context snapshot to UserDecision (for offline analysis and oracle training)
ALTER TABLE "UserDecision" ADD COLUMN "decisionContext" JSONB;

-- LinUCB arm table (contextual bandit with linear UCB, per persona×agent×variant)
CREATE TABLE "LinUCBArm" (
    "id"        TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "agentId"   TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "aInv"      JSONB NOT NULL,
    "b"         JSONB NOT NULL,
    "tries"     INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LinUCBArm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LinUCBArm_personaId_agentId_variantId_key"
    ON "LinUCBArm"("personaId", "agentId", "variantId");

CREATE INDEX "LinUCBArm_agentId_personaId_idx"
    ON "LinUCBArm"("agentId", "personaId");
