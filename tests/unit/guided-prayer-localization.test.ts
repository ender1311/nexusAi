// tests/unit/guided-prayer-localization.test.ts
// Regression tests: Guided Prayer verse fetched in the user's language (like VOTD).
// Covers: (a) versionForLanguage("es") used for Spanish users, (b) unsupported language
// falls back to DEFAULT_VERSION_ID, (c) send-grouping uses guidedLabels(content.languageTag).
import { describe, it, expect, mock, afterEach } from "bun:test";
import { versionForLanguage, DEFAULT_VERSION_ID } from "@/lib/votd/version-map";
import { guidedLabels } from "@/lib/votd/labels";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { GpContent } from "@/lib/votd/guided-prayer-content";
import { votdContentKey } from "@/lib/votd/votd-user-key";

// ── (a) fetchGpVerse uses versionForLanguage("es") = 149 ─────────────────────

describe("getGpContent / fetchGpVerse — version ID per language", () => {
  afterEach(() => {
    mock.restore();
  });

  it("calls bible API with Spanish version ID (149) for languageTag 'es'", async () => {
    // Mock fetch to capture the URL used for the bible API call.
    const capturedUrls: string[] = [];

    // Stub fetch: GP modules → return a usfm_text module; bible → return verse data.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      capturedUrls.push(url);

      if (url.includes("guidedprayers.youversionapi.com") && url.includes("/modules")) {
        return new Response(
          JSON.stringify({ data: [{ _type: "usfm_text", references: ["JOS.1.9"] }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("guidedprayers.youversionapi.com") && url.includes("/days/")) {
        // day image fetch
        return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("bible.youversionapi.com")) {
        return new Response(
          JSON.stringify({
            response: {
              data: {
                verses: [{ content: "No temas, porque yo estoy contigo.", reference: { human: "Josué 1:9" } }],
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    // Prisma stub: no cached row → triggers a fresh fetch.
    const prismaMock = {
      guidedPrayerDailyContent: {
        findUnique: async () => null,
        upsert: async (_args: { create: GpContent }) => _args.create,
      },
    } as unknown as typeof import("@/lib/db").prisma;

    const { getGpContent } = await import("@/lib/votd/guided-prayer-content");
    const result = await getGpContent(prismaMock, "2026-06-13", "es");

    // The bible API URL must contain id=149 (Spanish RVR09 → versionForLanguage("es") = 149).
    const bibleUrl = capturedUrls.find((u) => u.includes("bible.youversionapi.com"));
    expect(bibleUrl).toBeDefined();
    expect(bibleUrl).toContain("id=149");

    expect(result).not.toBeNull();
    expect(result?.languageTag).toBe("es");
    expect(result?.reference).toBe("Josué 1:9");
  });
});

// ── (b) unsupported language "zz" → DEFAULT_VERSION_ID (111) ─────────────────

describe("versionForLanguage — unsupported language fallback", () => {
  it("returns DEFAULT_VERSION_ID (111) for an unknown language tag 'zz'", () => {
    expect(versionForLanguage("zz")).toBe(DEFAULT_VERSION_ID);
    expect(DEFAULT_VERSION_ID).toBe(111);
  });

  it("returns 149 for 'es' (Spanish)", () => {
    expect(versionForLanguage("es")).toBe(149);
  });
});

// ── (c) send-grouping GP branch uses guidedLabels(content.languageTag) ────────

describe("send-grouping GP — localized guided_prayer_label", () => {
  const gpMeta: VariantMeta = {
    channel: "push",
    title: "{{guided_prayer_label}}",
    body: "{{gp_verse_text}}",
    deeplink: "https://www.bible.com/guides/1",
    brazeCampaignId: null,
    brazeVariantId: null,
    givingHandleStrategy: null,
    iconImageUrl: null,
    cta: null,
  };

  const AT = new Date("2026-06-13T15:00:00Z");

  it("renders Spanish guided_prayer_label when content.languageTag is 'es'", () => {
    const esContent: GpContent = {
      date: "2026-06-13",
      languageTag: "es",
      usfm: "JOS.1.9",
      reference: "Josué 1:9",
      verseText: "No temas, porque yo estoy contigo.",
      imageUrl: null,
    };
    // Spanish user: language_tag = "es", timezone = "America/Chicago"
    const map = new Map([[votdContentKey("2026-06-13", "es"), esContent]]);

    const groups = groupDecisionsByVariant(
      [{
        user: { externalId: "u_es", brazeId: null, attributes: { timezone: "America/Chicago", language_tag: "es" } },
        variantId: "gv1",
        scheduledAt: AT,
        inLocalTime: false,
      }],
      new Map([["gv1", gpMeta]]),
      new Map([["u_es", "d1"]]),
      {
        enabled: false,
        translationsByVariant: new Map(),
        gpVariantIds: new Set(["gv1"]),
        gpContent: map,
      },
    );

    const g = Object.values(groups)[0];
    expect(g).toBeDefined();
    // guidedLabels("es").guidedPrayer = "La oración guiada de hoy"
    const expectedLabel = guidedLabels("es").guidedPrayer;
    expect(expectedLabel).not.toBe(guidedLabels("en").guidedPrayer); // must be non-English
    expect(g.title).toBe(expectedLabel);
    expect(g.body).toBe("No temas, porque yo estoy contigo.");
  });

  it("renders English guided_prayer_label for English content", () => {
    const enContent: GpContent = {
      date: "2026-06-13",
      languageTag: "en",
      usfm: "JOS.1.9",
      reference: "Joshua 1:9",
      verseText: "Have I not commanded you? Be strong and courageous.",
      imageUrl: null,
    };
    const map = new Map([[votdContentKey("2026-06-13", "en"), enContent]]);

    const groups = groupDecisionsByVariant(
      [{
        user: { externalId: "u_en", brazeId: null, attributes: { timezone: "America/Chicago" } },
        variantId: "gv1",
        scheduledAt: AT,
        inLocalTime: false,
      }],
      new Map([["gv1", gpMeta]]),
      new Map([["u_en", "d1"]]),
      {
        enabled: false,
        translationsByVariant: new Map(),
        gpVariantIds: new Set(["gv1"]),
        gpContent: map,
      },
    );

    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Prayer");
  });
});
