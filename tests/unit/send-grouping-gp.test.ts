// tests/unit/send-grouping-gp.test.ts
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { GpContent } from "@/lib/votd/guided-prayer-content";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
import { hasGpTags, hasVotdTags } from "@/lib/votd/votd-tags";
import { votdContentKey } from "@/lib/votd/votd-user-key";

const gpMeta: VariantMeta = {
  channel: "push",
  title: "{{gp_verse_ref}}",
  body: "{{gp_verse_text}}",
  deeplink: "https://www.bible.com/guides/1",
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
  iconImageUrl: null, cta: null,
};

function gpContent(overrides: Partial<GpContent> = {}): GpContent {
  return {
    date: "2026-06-13",
    usfm: "JOS.1.9",
    reference: "Joshua 1:9",
    verseText: "Have I not commanded you? Be strong and courageous.",
    imageUrl: null,
    ...overrides,
  };
}

// 15:00Z = 10:00 CDT → Chicago local date 2026-06-13
const AT = new Date("2026-06-13T15:00:00Z");

function input(externalId: string, attributes: Record<string, unknown> = { timezone: "America/Chicago" }) {
  return { user: { externalId, brazeId: null, attributes }, variantId: "gv1", scheduledAt: AT, inLocalTime: false };
}

function loc(gpContentMap: Map<string, GpContent>) {
  return {
    enabled: false,
    translationsByVariant: new Map(),
    gpVariantIds: new Set(["gv1"]),
    gpContent: gpContentMap,
  };
}

// ── Tag detection (regression guards for the VOTD_TAGS cleanup) ──────────────

describe("GP tag detection — routing isolation", () => {
  it("hasGpTags detects {{gp_verse_ref}} and {{gp_verse_text}}", () => {
    expect(hasGpTags("{{gp_verse_ref}}", "body")).toBe(true);
    expect(hasGpTags("title", "{{gp_verse_text}}")).toBe(true);
    expect(hasGpTags("{{gp_verse_ref}}", "{{gp_verse_text}}")).toBe(true);
  });

  it("hasVotdTags returns false for pure GP variants — no VOTD content pre-fetched", () => {
    // Regression: {{guided_prayer_label}} was previously in VOTD_TAGS and caused
    // GP variants to appear in votdVariantIds, triggering unnecessary VOTD fetches.
    expect(hasVotdTags("{{gp_verse_ref}}", "{{gp_verse_text}}")).toBe(false);
    expect(hasVotdTags("{{guided_prayer_label}}", "{{gp_verse_text}}")).toBe(false);
    expect(hasVotdTags("{{guided_prayer_label}}", "{{gp_verse_ref}}")).toBe(false);
  });

  it("hasVotdTags still detects VOTD variants", () => {
    expect(hasVotdTags("{{guided_scripture_label}}", "{{votd_reference}}")).toBe(true);
    expect(hasVotdTags(null, "{{votd_text}}")).toBe(true);
  });
});

// ── send-grouping GP substitution ────────────────────────────────────────────

describe("send-grouping GP", () => {
  it("substitutes reference in title and verse text in body", () => {
    const map = new Map([["2026-06-13", gpContent()]]);
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["gv1", gpMeta]]),
      new Map([["u1", "d1"]]),
      loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Joshua 1:9");
    expect(g.body).toBe("Have I not commanded you? Be strong and courageous.");
  });

  it("substitutes guided_prayer_label when in title", () => {
    const meta: VariantMeta = { ...gpMeta, title: "{{guided_prayer_label}}", body: "{{gp_verse_text}}" };
    const map = new Map([["2026-06-13", gpContent()]]);
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["gv1", meta]]),
      new Map([["u1", "d1"]]),
      loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Prayer");
    expect(g.body).toBe("Have I not commanded you? Be strong and courageous.");
  });

  it("skips users with missing GP content — never sends raw {{gp_*}} tags", () => {
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["gv1", gpMeta]]),
      new Map([["u1", "d1"]]),
      loc(new Map()), // empty → no content for this date
    );
    expect(Object.keys(groups)).toHaveLength(0);
  });

  it("splits users on different local dates into separate groups with correct content", () => {
    // 03:00Z: Tokyo = Jun 14 (UTC+9), Chicago = Jun 13 (UTC-5)
    const at = new Date("2026-06-14T03:00:00Z");
    const jun13 = gpContent({ date: "2026-06-13", reference: "Joshua 1:9", verseText: "Be strong and courageous." });
    const jun14 = gpContent({ date: "2026-06-14", reference: "Psalm 46:1", verseText: "God is our refuge and strength." });
    const map = new Map([["2026-06-13", jun13], ["2026-06-14", jun14]]);

    const groups = groupDecisionsByVariant(
      [
        { user: { externalId: "tokyo", brazeId: null, attributes: { timezone: "Asia/Tokyo" } }, variantId: "gv1", scheduledAt: at, inLocalTime: false },
        { user: { externalId: "chicago", brazeId: null, attributes: { timezone: "America/Chicago" } }, variantId: "gv1", scheduledAt: at, inLocalTime: false },
      ],
      new Map([["gv1", gpMeta]]),
      new Map([["tokyo", "d1"], ["chicago", "d2"]]),
      loc(map),
    );
    const bodies = Object.values(groups).map((g) => g.body).sort();
    expect(bodies).toEqual(["Be strong and courageous.", "God is our refuge and strength."]);
  });

  it("uses America/Chicago fallback for users with no timezone attribute", () => {
    // 15:00Z = 10:00 CDT → Chicago date 2026-06-13
    const map = new Map([["2026-06-13", gpContent()]]);
    const groups = groupDecisionsByVariant(
      [{ user: { externalId: "u1", brazeId: null, attributes: {} }, variantId: "gv1", scheduledAt: AT, inLocalTime: false }],
      new Map([["gv1", gpMeta]]),
      new Map([["u1", "d1"]]),
      loc(map),
    );
    expect(Object.keys(groups)).toHaveLength(1);
    expect(Object.values(groups)[0].body).toBe("Have I not commanded you? Be strong and courageous.");
  });

  it("attaches GP image URLs when iconImageUrl is the sentinel", () => {
    const meta: VariantMeta = { ...gpMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const template = "//imageproxy.youversionapi.com/{width}x{height}/https://example.com/img.jpg";
    const map = new Map([["2026-06-13", gpContent({ imageUrl: template })]]);
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["gv1", meta]]),
      new Map([["u1", "d1"]]),
      loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBe("https://imageproxy.youversionapi.com/320x320/https://example.com/img.jpg");
    expect(g.androidImageUrl).toBe("https://imageproxy.youversionapi.com/1024x512/https://example.com/img.jpg");
  });

  it("sends text-only when sentinel is set but content has no image", () => {
    const meta: VariantMeta = { ...gpMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const map = new Map([["2026-06-13", gpContent({ imageUrl: null })]]);
    const groups = groupDecisionsByVariant(
      [input("u1")],
      new Map([["gv1", meta]]),
      new Map([["u1", "d1"]]),
      loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBeNull();
    expect(g.androidImageUrl).toBeNull();
    expect(g.body).toBe("Have I not commanded you? Be strong and courageous.");
  });

  it("GP and VOTD users in same batch get correct content from their respective maps", () => {
    const votdMeta: VariantMeta = {
      channel: "push", title: "{{guided_scripture_label}}", body: "{{votd_reference}}",
      deeplink: null, brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
      iconImageUrl: null, cta: null,
    };
    const gpContentMap = new Map([["2026-06-13", gpContent()]]);
    const votdContentMap = new Map([[
      votdContentKey("2026-06-13", "en"),
      { date: "2026-06-13", languageTag: "en", usfm: "JHN.3.16", reference: "John 3:16", verseText: "For God so loved", versionId: 111, imageUrlIos: null, imageUrlAndroid: null },
    ]]);

    const groups = groupDecisionsByVariant(
      [
        { user: { externalId: "gp_user", brazeId: null, attributes: { timezone: "America/Chicago" } }, variantId: "gv1", scheduledAt: AT, inLocalTime: false },
        { user: { externalId: "votd_user", brazeId: null, attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "vv1", scheduledAt: AT, inLocalTime: false },
      ],
      new Map([["gv1", gpMeta], ["vv1", votdMeta]]),
      new Map([["gp_user", "d1"], ["votd_user", "d2"]]),
      {
        enabled: false,
        translationsByVariant: new Map(),
        gpVariantIds: new Set(["gv1"]),
        gpContent: gpContentMap,
        votdVariantIds: new Set(["vv1"]),
        votdContent: votdContentMap,
      },
    );

    const groupList = Object.values(groups);
    expect(groupList).toHaveLength(2);
    const gpGroup = groupList.find((g) => g.body === "Have I not commanded you? Be strong and courageous.");
    const votdGroup = groupList.find((g) => g.body === "John 3:16");
    expect(gpGroup).toBeDefined();
    expect(votdGroup).toBeDefined();
  });
});
