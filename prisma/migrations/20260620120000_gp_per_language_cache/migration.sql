-- Guided Prayer cache becomes per-language: key on (date, languageTag) instead of date.
-- The GP guide is English-only, so usfm/imageUrl are shared; reference/verseText are
-- localized per languageTag. Existing rows are backfilled to 'en'.
ALTER TABLE "GuidedPrayerDailyContent" ADD COLUMN "languageTag" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "GuidedPrayerDailyContent" DROP CONSTRAINT "GuidedPrayerDailyContent_pkey";
ALTER TABLE "GuidedPrayerDailyContent" ADD CONSTRAINT "GuidedPrayerDailyContent_pkey" PRIMARY KEY ("date", "languageTag");
ALTER TABLE "GuidedPrayerDailyContent" ALTER COLUMN "languageTag" DROP DEFAULT;
