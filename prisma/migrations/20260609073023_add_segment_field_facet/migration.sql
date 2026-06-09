CREATE TABLE IF NOT EXISTS "SegmentFieldFacet" (
  "fieldId"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SegmentFieldFacet_pkey" PRIMARY KEY ("fieldId")
);
