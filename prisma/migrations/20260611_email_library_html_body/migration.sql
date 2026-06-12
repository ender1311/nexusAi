-- Add htmlBody to MessageVariant (email channel HTML templates)
ALTER TABLE "MessageVariant" ADD COLUMN "htmlBody" TEXT;

-- Add subject and htmlBody to MessageVariantTranslation (per-language email)
ALTER TABLE "MessageVariantTranslation" ADD COLUMN "subject" TEXT;
ALTER TABLE "MessageVariantTranslation" ADD COLUMN "htmlBody" TEXT;
