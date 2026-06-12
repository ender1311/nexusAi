CREATE TABLE "GuidedPrayerDailyContent" (
    "date"      TEXT NOT NULL,
    "usfm"      TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "verseText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuidedPrayerDailyContent_pkey" PRIMARY KEY ("date")
);
