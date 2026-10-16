-- Pluggable content sources (spec 2026-10-15). Additive and idempotent.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "contentSource" TEXT NOT NULL DEFAULT 'nexus-library';
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "contentSource" TEXT NOT NULL DEFAULT 'nexus-library';
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS "MessageVariant_contentSource_externalRef_key"
  ON "MessageVariant" ("contentSource", "externalRef") WHERE "externalRef" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "ContentSyncRun" (
  "id"         TEXT PRIMARY KEY,
  "source"     TEXT NOT NULL,
  "startedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finishedAt" TIMESTAMPTZ,
  "status"     TEXT NOT NULL,
  "created"    INTEGER NOT NULL DEFAULT 0,
  "updated"    INTEGER NOT NULL DEFAULT 0,
  "archived"   INTEGER NOT NULL DEFAULT 0,
  "skipped"    INTEGER NOT NULL DEFAULT 0,
  "errors"     JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS "ContentSyncRun_source_startedAt_idx" ON "ContentSyncRun" ("source", "startedAt" DESC);
