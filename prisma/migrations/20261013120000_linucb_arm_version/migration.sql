-- Optimistic-concurrency version for LinUCBArm (spec 2026-10-13 §6.7).
-- updateLinUCBArm compare-and-swaps on this column so concurrent rewards for
-- the same arm retry instead of overwriting each other (lost update bug).
-- ADD COLUMN with a constant default is metadata-only on PG 11+.
ALTER TABLE "LinUCBArm" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
