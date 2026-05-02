-- Add destination category for wizard filtering
-- Values: 'bible-verse' | 'guided-scripture' | 'plans' | 'general'
ALTER TABLE "MessageVariant" ADD COLUMN "category" TEXT;

-- Track clone → template relationship for sync
-- ON DELETE SET NULL: deleting a template orphans clones gracefully
ALTER TABLE "MessageVariant" ADD COLUMN "sourceTemplateId" TEXT
  REFERENCES "MessageVariant"("id") ON DELETE SET NULL;
