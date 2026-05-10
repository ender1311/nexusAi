-- Add brazeId to TrackedUser (stored as "User" table) for unverified user targeting
-- Unverified users have a Braze profile (braze_id) but no linked external_user_id.
-- For these users, externalId is set to brazeId and brazeId is also stored here so
-- the send cron can route to the recipients[] array format instead of external_user_ids.

ALTER TABLE "User" ADD COLUMN "brazeId" TEXT;
CREATE UNIQUE INDEX "User_brazeId_key" ON "User"("brazeId");
