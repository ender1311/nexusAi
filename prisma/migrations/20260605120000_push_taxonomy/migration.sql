-- PushCategory
CREATE TABLE IF NOT EXISTS "PushCategory" (
  "id"        TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushCategory_slug_key" ON "PushCategory"("slug");
CREATE INDEX IF NOT EXISTS "PushCategory_isActive_sortOrder_idx" ON "PushCategory"("isActive", "sortOrder");

-- PushSubcategory
CREATE TABLE IF NOT EXISTS "PushSubcategory" (
  "id"               TEXT NOT NULL,
  "categoryId"       TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "label"            TEXT NOT NULL,
  "sortOrder"        INTEGER NOT NULL DEFAULT 0,
  "deeplinkBehavior" TEXT NOT NULL DEFAULT 'none',
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PushSubcategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubcategory_slug_key" ON "PushSubcategory"("slug");
CREATE INDEX IF NOT EXISTS "PushSubcategory_categoryId_sortOrder_idx" ON "PushSubcategory"("categoryId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "PushSubcategory" ADD CONSTRAINT "PushSubcategory_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "PushCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- MessageVariant.sortOrder + index
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "MessageVariant_category_subcategory_sortOrder_idx"
  ON "MessageVariant"("category", "subcategory", "sortOrder");

-- Seed categories (slug, label, sortOrder)
INSERT INTO "PushCategory" ("id","slug","label","sortOrder","isActive") VALUES
  ('pcat_reader','reader','Reader',0,true),
  ('pcat_votd','votd','VOTD',1,true),
  ('pcat_plans','plans','Plans',2,true),
  ('pcat_guided_scripture','guided-scripture','Guided Scripture',3,true),
  ('pcat_guided_prayer','guided-prayer','Guided Prayer',4,true),
  ('pcat_giving','giving','Giving',5,true)
ON CONFLICT ("slug") DO NOTHING;

-- Seed subcategories (categoryId, slug, label, sortOrder, deeplinkBehavior)
INSERT INTO "PushSubcategory" ("id","categoryId","slug","label","sortOrder","deeplinkBehavior","isActive") VALUES
  ('psub_open_bible','pcat_reader','open-bible','Open Bible',0,'none',true),
  ('psub_audio_bible','pcat_reader','audio-bible','Audio Bible',1,'none',true),
  ('psub_specific_verse','pcat_reader','specific-verse','Specific Verse',2,'specific-verse',true),
  ('psub_votd_page','pcat_votd','votd-page','Verse of the Day',0,'none',true),
  ('psub_todays_story','pcat_votd','todays-story','Today''s Story',1,'none',true),
  ('psub_find_plans','pcat_plans','find-plans','Find Plans',0,'none',true),
  ('psub_my_plans','pcat_plans','my-plans','My Plans',1,'none',true),
  ('psub_saved_plans','pcat_plans','saved-plans','Saved Plans',2,'none',true),
  ('psub_guided_prayer','pcat_guided_prayer','guided-prayer','Guided Prayer',0,'none',true),
  ('psub_prayer_list','pcat_guided_prayer','prayer-list','Prayer List',1,'none',true),
  ('psub_monthly_appeal','pcat_giving','monthly-appeal','Monthly Appeal',0,'none',true),
  ('psub_giving_tuesday','pcat_giving','giving-tuesday','Giving Tuesday',1,'none',true),
  ('psub_eoy','pcat_giving','eoy','End of Year',2,'none',true),
  ('psub_matching_gift','pcat_giving','matching-gift','Matching Gift',3,'none',true),
  ('psub_recurring_gift','pcat_giving','recurring-gift','Recurring Gift',4,'none',true),
  ('psub_sower_generosity','pcat_giving','sower-generosity','Sower Generosity',5,'none',true),
  ('psub_impact_story','pcat_giving','impact-story','Impact Story',6,'none',true),
  ('psub_prayer','pcat_giving','prayer','Prayer',7,'none',true),
  ('psub_thank_you_followup','pcat_giving','thank-you-followup','Thank You Follow-up',8,'none',true),
  ('psub_dynamic_handle','pcat_giving','dynamic-handle','Dynamic Handle',9,'none',true)
ON CONFLICT ("slug") DO NOTHING;
