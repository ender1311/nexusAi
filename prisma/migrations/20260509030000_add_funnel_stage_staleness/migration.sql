-- Add funnelStageUpdatedAt to TrackedUser so the cron can detect stale audience membership.
-- Set on every Hightouch ingest when funnel_stage is present; null = never synced.
ALTER TABLE "User" ADD COLUMN "funnelStageUpdatedAt" TIMESTAMP(3);

-- Add staleFunnelStageDays to Agent — how many days after audience exit we keep targeting.
-- null = no staleness gate (backward compat for existing agents).
-- Recommended: lapsed agents = 14, wau/connected/new_user = 2.
ALTER TABLE "Agent" ADD COLUMN "staleFunnelStageDays" INTEGER;
