-- Idempotent: safe to run against prod and the local test DB.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "deeplinkOverride" TEXT;
