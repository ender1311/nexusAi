-- C2: durable exact-count cache for rule-segments.
ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeExact" INTEGER;
ALTER TABLE "Segment" ADD COLUMN IF NOT EXISTS "sizeComputedAt" TIMESTAMP(3);
