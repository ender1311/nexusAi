// Regression for the verse-push title-strategy experiment:
// a VERSE_PUSH_SENTINEL variant resolves localized copy per language/strategy
// and batches users by resolved copy.
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import { VERSE_PUSH_SENTINEL, type VersePool } from "@/lib/verse-content";

const meta = new Map<string, VariantMeta>([
  ["v-ref", { channel: "push", body: VERSE_PUSH_SENTINEL, title: "[verse:reference]", deeplink: null, brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null }],
]);

const pool: VersePool = [{
  usfm: "JHN.3.16",
  byLang: new Map<string, Record<string, string>>([
    ["en", { reference: "John 3:16", "a-title": "A", "b-title": "B", "verse-text": "For God..." }],
    ["es", { reference: "Juan 3:16", "verse-text": "Porque..." }],
  ]),
}];

const localization = {
  enabled: true,
  translationsByVariant: new Map(),
  versePool: pool,
  strategyByVariant: new Map([["v-ref", "reference" as const]]),
};

const at = new Date("2026-05-31T08:00:00Z");

function input(externalId: string, lang: string) {
  return { user: { externalId, brazeId: null, attributes: { language_tag: lang } }, variantId: "v-ref", scheduledAt: at, inLocalTime: false };
}

describe("verse-push send grouping", () => {
  it("resolves localized reference-arm copy per language", () => {
    const decById = new Map([["u-es", "d-es"], ["u-en", "d-en"]]);
    const groups = groupDecisionsByVariant([input("u-es", "es"), input("u-en", "en")], meta, decById, localization);
    const all = Object.values(groups);
    const es = all.find((g) => g.externalUserIds.includes("u-es"))!;
    const en = all.find((g) => g.externalUserIds.includes("u-en"))!;
    expect(es.body).toBe("Porque...");
    expect(es.title).toBe("Juan 3:16");
    expect(en.body).toBe("For God...");
    expect(en.title).toBe("John 3:16");
  });
  it("batches users sharing the same resolved copy", () => {
    const decById = new Map([["u-es1", "d1"], ["u-es2", "d2"]]);
    const groups = groupDecisionsByVariant([input("u-es1", "es"), input("u-es2", "es")], meta, decById, localization);
    expect(Object.values(groups).filter((g) => g.body === "Porque...").length).toBe(1);
  });
  it("skips verse-arm users when the pool is empty (never sends the raw sentinel)", () => {
    const emptyPoolLoc = { ...localization, versePool: [] as VersePool };
    const decById = new Map([["u-en", "d-en"]]);
    const groups = groupDecisionsByVariant([input("u-en", "en")], meta, decById, emptyPoolLoc);
    expect(Object.keys(groups)).toHaveLength(0);
    expect(Object.values(groups).some((g) => g.body === VERSE_PUSH_SENTINEL)).toBe(false);
  });
});
