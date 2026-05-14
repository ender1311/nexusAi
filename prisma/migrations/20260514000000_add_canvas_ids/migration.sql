-- Add brazeCanvasId to Message: Braze canvas UUID used for canvas attribution routing.
-- Add brazeCanvasStepId to MessageVariant: Braze canvas step UUID for per-variant attribution.
-- Both were previously added via db push without a migration file; using IF NOT EXISTS for idempotency.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "brazeCanvasId" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "brazeCanvasStepId" TEXT;
CREATE INDEX IF NOT EXISTS "MessageVariant_brazeCanvasStepId_idx" ON "MessageVariant"("brazeCanvasStepId");
