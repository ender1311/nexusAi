-- AlterTable
ALTER TABLE "MessageVariant" ADD COLUMN "deeplink" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN "frequencyCapOverride" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN "iconImageUrl" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN "preferredDayOfWeek" INTEGER;
ALTER TABLE "MessageVariant" ADD COLUMN "preferredHour" INTEGER;
ALTER TABLE "MessageVariant" ADD COLUMN "title" TEXT;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalId" TEXT NOT NULL,
    "attributes" TEXT NOT NULL DEFAULT '{}',
    "totalDecisions" INTEGER NOT NULL DEFAULT 0,
    "totalConversions" INTEGER NOT NULL DEFAULT 0,
    "totalReward" REAL NOT NULL DEFAULT 0.0,
    "channelStats" TEXT NOT NULL DEFAULT '{}',
    "hourlyStats" TEXT NOT NULL DEFAULT '[]',
    "dailyStats" TEXT NOT NULL DEFAULT '[]',
    "featureVector" TEXT,
    "featureVectorAt" DATETIME,
    "personaId" TEXT,
    "personaConfidence" REAL,
    "personaAssignedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'Users2',
    "color" TEXT NOT NULL DEFAULT 'blue',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "centroid" TEXT,
    "clusterSize" INTEGER NOT NULL DEFAULT 0,
    "silhouetteScore" REAL,
    "traits" TEXT NOT NULL DEFAULT '{}',
    "label" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "discoveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentPersonaTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    CONSTRAINT "AgentPersonaTarget_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentPersonaTarget_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonaArmStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "personaId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "alpha" REAL NOT NULL DEFAULT 1.0,
    "beta" REAL NOT NULL DEFAULT 1.0,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "valueWeight" REAL NOT NULL DEFAULT 1.0,
    "weightMode" TEXT NOT NULL DEFAULT 'fixed',
    "weightProperty" TEXT,
    "weightDefault" REAL NOT NULL DEFAULT 1.0,
    "description" TEXT,
    CONSTRAINT "Goal_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("agentId", "description", "eventName", "id", "tier", "valueWeight") SELECT "agentId", "description", "eventName", "id", "tier", "valueWeight" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "brazeCampaignId" TEXT,
    "testedVariables" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("agentId", "brazeCampaignId", "channel", "createdAt", "id", "name") SELECT "agentId", "brazeCampaignId", "channel", "createdAt", "id", "name" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPersonaTarget_agentId_personaId_key" ON "AgentPersonaTarget"("agentId", "personaId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaArmStats_personaId_agentId_variantId_key" ON "PersonaArmStats"("personaId", "agentId", "variantId");
