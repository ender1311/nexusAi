-- Add brazeScheduleId: schedule_id returned by /messages/schedule/create
-- Add brazeAnalyticsFetchedAt: timestamp when /sends/data_series was polled (for daily 900-sendId cap)
ALTER TABLE "UserDecision" ADD COLUMN "brazeScheduleId" TEXT;
ALTER TABLE "UserDecision" ADD COLUMN "brazeAnalyticsFetchedAt" TIMESTAMP(3);
