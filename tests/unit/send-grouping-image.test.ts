import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import { VERSE_PUSH_SENTINEL, type VersePool, type VerseStrategy } from "@/lib/verse-content";
import { VERSE_IMAGE_SENTINEL, buildVerseImageUrls, DEFAULT_VERSE_IMAGE_ID } from "@/lib/verse-image";

const baseMeta: VariantMeta = {
  channel: "push", body: VERSE_PUSH_SENTINEL, title: "[verse]", deeplink: null,
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
  iconImageUrl: VERSE_IMAGE_SENTINEL,
};

const pool: VersePool = [
  { usfm: "JHN.3.16", imageId: "77058", byLang: new Map([["en", { "verse-text": "For God...", reference: "John 3:16", "a-title": "A", "b-title": "B" }]]) },
];

function input(externalId: string) {
  return { user: { externalId, brazeId: null, attributes: {} }, variantId: "v1", scheduledAt: new Date("2026-06-04T08:00:00Z"), inLocalTime: false };
}

describe("send-grouping verse image", () => {
  it("resolves per-verse image URLs onto the group when iconImageUrl is the sentinel", () => {
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["v1", baseMeta]]),
      new Map([["u1", "d1"]]),
      { enabled: false, translationsByVariant: new Map(), versePool: pool, strategyByVariant: new Map<string, VerseStrategy>([["v1", "reference"]]) },
    );
    const g = Object.values(groups)[0];
    const { ios, android } = buildVerseImageUrls("77058");
    expect(g.iosImageUrl).toBe(ios);
    expect(g.androidImageUrl).toBe(android);
  });

  it("uses DEFAULT_VERSE_IMAGE_ID when the chosen verse has no imageId", () => {
    const noImagePool: VersePool = [{ ...pool[0], imageId: undefined }];
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["v1", baseMeta]]),
      new Map([["u1", "d1"]]),
      { enabled: false, translationsByVariant: new Map(), versePool: noImagePool, strategyByVariant: new Map<string, VerseStrategy>([["v1", "reference"]]) },
    );
    const g = Object.values(groups)[0];
    expect(g.androidImageUrl).toBe(buildVerseImageUrls(DEFAULT_VERSE_IMAGE_ID).android);
  });

  it("passes a literal iconImageUrl through to both platforms (non-verse)", () => {
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["v1", { ...baseMeta, body: "Plain body", iconImageUrl: "https://x/y/a.png" }]]),
      new Map([["u1", "d1"]]),
    );
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBe("https://x/y/a.png");
    expect(g.androidImageUrl).toBe("https://x/y/a.png");
  });

  it("leaves image URLs null when iconImageUrl is null", () => {
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["v1", { ...baseMeta, body: "Plain body", iconImageUrl: null }]]),
      new Map([["u1", "d1"]]),
    );
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBeNull();
    expect(g.androidImageUrl).toBeNull();
  });
});
