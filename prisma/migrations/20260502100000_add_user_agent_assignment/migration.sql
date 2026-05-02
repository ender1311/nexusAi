-- CreateTable
CREATE TABLE "UserAgentAssignment" (
    "id" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "windowCompletedAt" TIMESTAMP(3),

    CONSTRAINT "UserAgentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAgentAssignment_externalUserId_key" ON "UserAgentAssignment"("externalUserId");

-- CreateIndex
CREATE INDEX "UserAgentAssignment_agentId_idx" ON "UserAgentAssignment"("agentId");

-- CreateIndex
CREATE INDEX "UserAgentAssignment_windowCompletedAt_idx" ON "UserAgentAssignment"("windowCompletedAt");
