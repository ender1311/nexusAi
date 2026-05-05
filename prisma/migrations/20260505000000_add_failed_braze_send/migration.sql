-- CreateTable
CREATE TABLE "FailedBrazeSend" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "userIds" JSONB NOT NULL DEFAULT '[]',
    "decisionIds" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "FailedBrazeSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedBrazeSend_agentId_failedAt_idx" ON "FailedBrazeSend"("agentId", "failedAt");
