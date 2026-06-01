-- Add USD-normalized gift revenue column for attributed gift_given decisions.
ALTER TABLE "UserDecision" ADD COLUMN IF NOT EXISTS "conversionValue" DOUBLE PRECISION;
