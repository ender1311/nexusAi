-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "algorithm" TEXT NOT NULL DEFAULT 'thompson',
    "epsilon" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "valueWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "weightMode" TEXT NOT NULL DEFAULT 'fixed',
    "weightProperty" TEXT,
    "weightDefault" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "description" TEXT,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "brazeCampaignId" TEXT,
    "testedVariables" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageVariant" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "cta" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "brazeVariantId" TEXT,
    "title" TEXT,
    "iconImageUrl" TEXT,
    "deeplink" TEXT,
    "preferredHour" INTEGER,
    "preferredDayOfWeek" INTEGER,
    "frequencyCapOverride" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDecision" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageVariantId" TEXT,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brazeSendId" TEXT,
    "conversionEvent" TEXT,
    "conversionAt" TIMESTAMP(3),
    "reward" DOUBLE PRECISION,

    CONSTRAINT "UserDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "totalDecisions" INTEGER NOT NULL DEFAULT 0,
    "totalConversions" INTEGER NOT NULL DEFAULT 0,
    "totalReward" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "channelStats" JSONB NOT NULL DEFAULT '{}',
    "hourlyStats" JSONB NOT NULL DEFAULT '[]',
    "dailyStats" JSONB NOT NULL DEFAULT '[]',
    "featureVector" JSONB,
    "featureVectorAt" TIMESTAMP(3),
    "personaId" TEXT,
    "personaConfidence" DOUBLE PRECISION,
    "personaAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'Users2',
    "color" TEXT NOT NULL DEFAULT 'blue',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "centroid" JSONB,
    "clusterSize" INTEGER NOT NULL DEFAULT 0,
    "silhouetteScore" DOUBLE PRECISION,
    "traits" JSONB NOT NULL DEFAULT '{}',
    "label" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPersonaTarget" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,

    CONSTRAINT "AgentPersonaTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaArmStats" (
    "id" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "alpha" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "beta" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PersonaArmStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchedulingRule" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "frequencyCap" JSONB NOT NULL DEFAULT '{"maxSends":3,"period":"week"}',
    "quietHours" JSONB NOT NULL DEFAULT '{"start":"22:00","end":"08:00","timezone":"America/New_York"}',
    "blackoutDates" JSONB NOT NULL DEFAULT '[]',
    "smartSuppress" BOOLEAN NOT NULL DEFAULT false,
    "suppressThresh" DOUBLE PRECISION NOT NULL DEFAULT 0.5,

    CONSTRAINT "SchedulingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelMetric" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "ModelMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersonaTarget_agentId_personaId_key" ON "AgentPersonaTarget"("agentId", "personaId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaArmStats_personaId_agentId_variantId_key" ON "PersonaArmStats"("personaId", "agentId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingRule_agentId_key" ON "SchedulingRule"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageVariant" ADD CONSTRAINT "MessageVariant_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDecision" ADD CONSTRAINT "UserDecision_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "MessageVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPersonaTarget" ADD CONSTRAINT "AgentPersonaTarget_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPersonaTarget" ADD CONSTRAINT "AgentPersonaTarget_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRule" ADD CONSTRAINT "SchedulingRule_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelMetric" ADD CONSTRAINT "ModelMetric_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
