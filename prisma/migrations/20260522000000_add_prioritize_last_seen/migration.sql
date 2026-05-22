-- Add prioritizeLastSeen flag to SchedulingRule.
-- When true (default), the hourly cron fills the audience cap with users
-- whose preferredSendHour matches the current UTC hour first, distributing
-- sends throughout the day instead of clustering at the fallback hour.
ALTER TABLE "SchedulingRule" ADD COLUMN IF NOT EXISTS "prioritizeLastSeen" BOOLEAN NOT NULL DEFAULT true;
