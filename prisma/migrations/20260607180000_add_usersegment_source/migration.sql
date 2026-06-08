-- Add a source discriminator so rule-materialized membership (source='rule')
-- coexists with Hightouch-synced membership (source='hightouch') under the same
-- segmentName. The rule job's stale-member sweep filters on source='rule', so it
-- never deletes Hightouch-owned rows. Idempotent: safe to re-run.
ALTER TABLE "UserSegment" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'hightouch';

-- Swap the old 2-column unique for the 3-column unique. Prisma's default index
-- name for the old constraint is "UserSegment_externalId_segmentName_key"
-- (confirmed in local test DB; matches prod Prisma naming).
DROP INDEX IF EXISTS "UserSegment_externalId_segmentName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "UserSegment_externalId_segmentName_source_key"
  ON "UserSegment" ("externalId", "segmentName", "source");
