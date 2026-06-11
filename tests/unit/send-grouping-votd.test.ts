// tests/unit/send-grouping-votd.test.ts
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { VotdContent } from "@/lib/votd/votd-content";
import { votdContentKey } from "@/lib/votd/votd-user-key";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";

const votdMeta: VariantMeta = {
  channel: "push",
  body: "{{votd_reference}}",
  title: "{{guided_scripture_label}}",
  deeplink: "https://www.bible.com/stories",
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
  iconImageUrl: null,
};

function content(overrides: Partial<VotdContent> = {}): VotdContent {
  return {
    date: "2026-06-11", languageTag: "en", usfm: "JHN.3.16",
    reference: "John 3:16", verseText: "For God so loved the world",
    versionId: 111, imageUrlIos: null, imageUrlAndroid: null,
    ...overrides,
  };
}

// 15:00Z = 10:00 CDT → Chicago local date 2026-06-11
const AT = new Date("2026-06-11T15:00:00Z");

function input(externalId: string, attributes: Record<string, unknown> = { language_tag: "en", timezone: "America/Chicago" }) {
  return { user: { externalId, brazeId: null, attributes }, variantId: "v1", scheduledAt: AT, inLocalTime: false };
}

function loc(votdContent: Map<string, VotdContent>) {
  return {
    enabled: false,
    translationsByVariant: new Map(),
    votdVariantIds: new Set(["v1"]),
    votdContent,
  };
}

describe("send-grouping VOTD", () => {
  it("substitutes label + reference for an English user", () => {
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Scripture");
    expect(g.body).toBe("John 3:16");
    expect(g.deeplink).toBe("https://www.bible.com/stories");
  });

  it("substitutes the localized label + reference for a Spanish user", () => {
    const map = new Map([[votdContentKey("2026-06-11", "es"), content({ languageTag: "es", reference: "Juan 3:16" })]]);
    const groups = groupDecisionsByVariant(
      [input("u1", { language_tag: "es", timezone: "America/Chicago" })],
      new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("La Escritura guiada de hoy");
    expect(g.body).toBe("Juan 3:16");
  });

  it("substitutes the prayer label and verse text", () => {
    const meta: VariantMeta = { ...votdMeta, title: "{{guided_prayer_label}}", body: "{{votd_text}}", deeplink: "https://www.bible.com/guides/1" };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Prayer");
    expect(g.body).toBe("For God so loved the world");
  });

  it("skips users whose (date, language) content is missing — never sends raw tags", () => {
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(new Map()));
    expect(Object.keys(groups)).toHaveLength(0);
  });

  it("attaches the content image URLs when iconImageUrl is the sentinel", () => {
    const meta: VariantMeta = { ...votdMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content({ imageUrlIos: "https://img/ios.jpg", imageUrlAndroid: "https://img/android.jpg" })]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBe("https://img/ios.jpg");
    expect(g.androidImageUrl).toBe("https://img/android.jpg");
  });

  it("sends text-only when the sentinel is set but the content has no images", () => {
    const meta: VariantMeta = { ...votdMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBeNull();
    expect(g.androidImageUrl).toBeNull();
    expect(g.body).toBe("John 3:16"); // copy still substituted
  });

  it("splits users on different local dates into different groups", () => {
    // 03:00Z: Tokyo = Jun 11, Chicago = Jun 10
    const at = new Date("2026-06-11T03:00:00Z");
    const map = new Map([
      [votdContentKey("2026-06-11", "en"), content({ date: "2026-06-11", reference: "John 3:16" })],
      [votdContentKey("2026-06-10", "en"), content({ date: "2026-06-10", reference: "Psalm 23:1" })],
    ]);
    const groups = groupDecisionsByVariant(
      [
        { user: { externalId: "tokyo", brazeId: null, attributes: { language_tag: "en", timezone: "Asia/Tokyo" } }, variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: { externalId: "chicago", brazeId: null, attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      new Map([["v1", votdMeta]]),
      new Map([["tokyo", "d1"], ["chicago", "d2"]]),
      loc(map),
    );
    const bodies = Object.values(groups).map((g) => g.body).sort();
    expect(bodies).toEqual(["John 3:16", "Psalm 23:1"]);
  });

  it("leaves non-VOTD variants untouched", () => {
    const meta: VariantMeta = { ...votdMeta, title: "Plain", body: "Copy" };
    const groups = groupDecisionsByVariant(
      [{ ...input("u1"), variantId: "v2" }],
      new Map([["v2", meta]]),
      new Map([["u1", "d1"]]),
      loc(new Map()), // votdVariantIds only contains v1
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Plain");
    expect(g.body).toBe("Copy");
  });
});
