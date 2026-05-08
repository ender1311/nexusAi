-- Convert Agent.funnelStage from PostgreSQL enum type to plain TEXT,
-- mapping old enum values to the new funnel stage taxonomy.

-- 1. Cast the enum column to text
ALTER TABLE "Agent" ALTER COLUMN "funnelStage" TYPE TEXT USING "funnelStage"::TEXT;

-- 2. Map old enum values to new taxonomy
UPDATE "Agent" SET "funnelStage" = CASE "funnelStage"
  WHEN 'connected'  THEN 'wau'
  WHEN 'engaged'    THEN 'dau4'
  WHEN 'lapsed'     THEN 'lapsed_mau'
  WHEN 'activated'  THEN 'new'
  WHEN 'inspired'   THEN 'dau4'
  ELSE "funnelStage"  -- 'new' stays as 'new'; any unexpected value kept as-is
END;

-- 3. Update default to match new taxonomy
ALTER TABLE "Agent" ALTER COLUMN "funnelStage" SET DEFAULT 'wau';

-- 4. Drop the old enum type (no longer referenced)
DROP TYPE IF EXISTS "FunnelStage";
