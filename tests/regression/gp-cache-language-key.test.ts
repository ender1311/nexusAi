// tests/regression/gp-cache-language-key.test.ts
//
// REGRESSION (Task 5 — localized GP cache): GuidedPrayerDailyContent is keyed by
// @@id([date, languageTag]) so that English and Spanish (and any other language) GP
// content for the same calendar date can coexist without collision.
//
// This test locks in that the composite primary key works correctly:
//   - Two rows with the same `date` but different `languageTag` must both persist.
//   - findUnique({ where: { date_languageTag: { date, languageTag: "es" } } }) must
//     return the Spanish row, not the English row.
// A future schema change that drops or renames languageTag will fail here before
// reaching production and serving English text to Spanish users.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "../helpers/db";

const TEST_DATE = "2026-06-20";

beforeEach(async () => {
  await prisma.guidedPrayerDailyContent.deleteMany({ where: { date: TEST_DATE } });
});

afterEach(async () => {
  await prisma.guidedPrayerDailyContent.deleteMany({ where: { date: TEST_DATE } });
});

describe("GuidedPrayerDailyContent composite key @@id([date, languageTag])", () => {
  it("allows two rows with the same date but different languageTag", async () => {
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "es",
        usfm: "JOS.1.9",
        reference: "Josué 1:9",
        verseText: "No temas, porque yo estoy contigo.",
        imageUrl: null,
      },
    });

    const all = await prisma.guidedPrayerDailyContent.findMany({
      where: { date: TEST_DATE },
    });
    expect(all).toHaveLength(2);
  });

  it("findUnique by date_languageTag returns the Spanish row", async () => {
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "es",
        usfm: "JOS.1.9",
        reference: "Josué 1:9",
        verseText: "No temas, porque yo estoy contigo.",
        imageUrl: null,
      },
    });

    const esRow = await prisma.guidedPrayerDailyContent.findUnique({
      where: { date_languageTag: { date: TEST_DATE, languageTag: "es" } },
    });

    expect(esRow).not.toBeNull();
    expect(esRow?.languageTag).toBe("es");
    expect(esRow?.reference).toBe("Josué 1:9");
    expect(esRow?.verseText).toBe("No temas, porque yo estoy contigo.");
    // Confirm it's NOT the English row
    expect(esRow?.verseText).not.toContain("courageous");
  });

  it("findUnique for 'en' returns the English row, not Spanish", async () => {
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "es",
        usfm: "JOS.1.9",
        reference: "Josué 1:9",
        verseText: "No temas, porque yo estoy contigo.",
        imageUrl: null,
      },
    });

    const enRow = await prisma.guidedPrayerDailyContent.findUnique({
      where: { date_languageTag: { date: TEST_DATE, languageTag: "en" } },
    });

    expect(enRow).not.toBeNull();
    expect(enRow?.languageTag).toBe("en");
    expect(enRow?.reference).toBe("Joshua 1:9");
    expect(enRow?.verseText).toContain("courageous");
  });

  it("duplicate insert for same (date, languageTag) throws a unique constraint error", async () => {
    await prisma.guidedPrayerDailyContent.create({
      data: {
        date: TEST_DATE,
        languageTag: "en",
        usfm: "JOS.1.9",
        reference: "Joshua 1:9",
        verseText: "Have I not commanded you? Be strong and courageous.",
        imageUrl: null,
      },
    });

    // Verify the composite primary key prevents duplicates.
    // Use try/catch because Bun's .rejects.toThrow() has quirks with PrismaPromise.
    let threw = false;
    try {
      await prisma.guidedPrayerDailyContent.create({
        data: {
          date: TEST_DATE,
          languageTag: "en",
          usfm: "JOS.1.9",
          reference: "Joshua 1:9 (duplicate)",
          verseText: "Duplicate entry should fail.",
          imageUrl: null,
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
