-- AlterTable
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "holdMaxDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "holdMaxSends" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3);
ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "releaseReason" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserAgentAssignment_releasedAt_idx" ON "UserAgentAssignment"("releasedAt");

-- CreateTable
CREATE TABLE IF NOT EXISTS "FunnelTransition" (
    "id" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "fromStage" TEXT NOT NULL,
    "toStage" TEXT NOT NULL,
    "recoveryRank" INTEGER NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributedAgentId" TEXT,
    "attributedDecisionId" TEXT,

    CONSTRAINT "FunnelTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FunnelTransition_attributedAgentId_detectedAt_idx" ON "FunnelTransition"("attributedAgentId", "detectedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FunnelTransition_detectedAt_idx" ON "FunnelTransition"("detectedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FunnelTransition_externalUserId_idx" ON "FunnelTransition"("externalUserId");
