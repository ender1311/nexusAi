-- Trigger-based enrollment + interaction-flag conversions.
-- enrollmentMode: "fixed" (frozen cohort, default — zero behavior change for
-- existing agents) vs "continuous" (cron re-evaluates segment membership each
-- run; leavers released with releaseReason='segment_exit').
-- conversionType: per-goal crediting mode for *_has_ever_flag goals
-- ("first_interaction" | "any_interaction"); NULL for regular event goals.
-- enrollmentFlags: snapshot of the 9 interaction flags at enrollment time —
-- the Type-A (first_interaction) baseline. Idempotent: safe to re-run.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "enrollmentMode" TEXT NOT NULL DEFAULT 'fixed';
ALTER TABLE "Goal" ADD COLUMN IF NOT EXISTS "conversionType" TEXT;
ALTER TABLE "UserAgentAssignment" ADD COLUMN IF NOT EXISTS "enrollmentFlags" JSONB;
