-- Recurring-giver (Sower) state tracking.
-- Last observed has_recurring_gift from Hightouch user sync; a false->true
-- transition synthesizes a sower_subscribed conversion. Nullable, no default
-- (null = never observed) so the add is non-destructive and instant.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasRecurringGift" boolean;
