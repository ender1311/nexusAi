-- UserArmStats: per-user arm stats for personalized bandit blending
-- Each row stores individual user's Alpha/Beta priors for a specific agent × variant.
-- At decision time the cron blends (persona alpha + user wins, persona beta + user non-wins).
CREATE TABLE "UserArmStats" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "agentId"   TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "alpha"     DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "beta"      DOUBLE PRECISION NOT NULL DEFAULT 30.0,
    "tries"     INTEGER NOT NULL DEFAULT 0,
    "wins"      INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "UserArmStats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserArmStats_userId_agentId_variantId_key" ON "UserArmStats"("userId", "agentId", "variantId");
CREATE INDEX "UserArmStats_userId_agentId_idx" ON "UserArmStats"("userId", "agentId");

-- LinUCBArm: drop personaId (LinUCB uses feature context instead of persona segmentation)
-- The table was empty (LinUCB was never active), so we can safely recreate it.
DROP TABLE IF EXISTS "LinUCBArm";
CREATE TABLE "LinUCBArm" (
    "id"        TEXT NOT NULL,
    "agentId"   TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "aInv"      JSONB NOT NULL,
    "b"         JSONB NOT NULL,
    "tries"     INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LinUCBArm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinUCBArm_agentId_variantId_key" ON "LinUCBArm"("agentId", "variantId");
CREATE INDEX "LinUCBArm_agentId_idx" ON "LinUCBArm"("agentId");
