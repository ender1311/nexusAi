-- AlterTable
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "targetSegmentName" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "UserSegment" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "segmentName" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserSegment_externalId_segmentName_key" ON "UserSegment"("externalId", "segmentName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSegment_segmentName_idx" ON "UserSegment"("segmentName");
