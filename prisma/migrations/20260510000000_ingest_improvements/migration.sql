-- Add pushOpenAt to UserDecision (does not consume conversionAt slot for push opens)
ALTER TABLE "UserDecision" ADD COLUMN IF NOT EXISTS "pushOpenAt" TIMESTAMP(3);

-- Idempotency table for event attribution
CREATE TABLE IF NOT EXISTS "ProcessedEventId" (
  "eventId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessedEventId_pkey" PRIMARY KEY ("eventId")
);
CREATE INDEX IF NOT EXISTS "ProcessedEventId_createdAt_idx" ON "ProcessedEventId"("createdAt");

-- System-level ingest run log
CREATE TABLE IF NOT EXISTS "IngestSyncLog" (
  "id"        TEXT NOT NULL,
  "syncKind"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "received"  INTEGER NOT NULL,
  "upserted"  INTEGER,
  "matched"   INTEGER,
  "unmatched" INTEGER,
  "details"   JSONB,
  CONSTRAINT "IngestSyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "IngestSyncLog_syncKind_createdAt_idx" ON "IngestSyncLog"("syncKind", "createdAt");
