-- New table for saved, rule-based audience segments. Idempotent so it can be
-- applied by hand to both prod and the local test DB (we never run
-- `prisma migrate dev` — prisma.config.ts loads .env.local = PROD).
CREATE TABLE IF NOT EXISTS "Segment" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "rule"        JSONB NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdBy"   TEXT,
  CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Segment_name_key" ON "Segment"("name");
