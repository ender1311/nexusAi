-- CreateTable
CREATE TABLE "CampaignContent" (
    "id" TEXT NOT NULL,
    "campaign" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "usfmReference" TEXT NOT NULL,
    "usfmHuman" TEXT,
    "title" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignContent_campaign_contentType_language_usfmReference_key" ON "CampaignContent"("campaign", "contentType", "language", "usfmReference");

-- CreateIndex
CREATE INDEX "CampaignContent_campaign_language_contentType_idx" ON "CampaignContent"("campaign", "language", "contentType");
