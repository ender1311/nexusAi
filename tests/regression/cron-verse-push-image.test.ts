// Regression: a verse arm with iconImageUrl = VERSE_IMAGE_SENTINEL must attach
// the per-verse image (imageproxy URL containing the seeded image_id) to the
// push payload; a paired no-image arm attaches none; a missing curated id falls
// back to the default image; a static-URL arm passes its URL through.
// Bug context: iconImageUrl existed on MessageVariant but was never threaded
// through the cron send pipeline.
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import { VERSE_PUSH_SENTINEL, type VersePool, type VerseStrategy } from "@/lib/verse-content";
import { VERSE_IMAGE_SENTINEL, DEFAULT_VERSE_IMAGE_ID } from "@/lib/verse-image";
import { PayloadFactory } from "@/lib/braze/payload-factory";

const factory = new PayloadFactory();

const pool: VersePool = [
  { usfm: "JHN.3.16", imageId: "77058", byLang: new Map([["en", { "verse-text": "For God so loved", reference: "John 3:16", "a-title": "A", "b-title": "B" }]]) },
];

function verseMeta(over: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push", body: VERSE_PUSH_SENTINEL, title: "[verse:reference]", deeplink: null,
    brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null, cta: null,
    iconImageUrl: VERSE_IMAGE_SENTINEL, ...over,
  };
}

function run(meta: VariantMeta, versePool: VersePool) {
  const groups = groupDecisionsByVariant(
    [{ user: { externalId: "u1", brazeId: null, attributes: {} }, variantId: "v1", scheduledAt: new Date("2026-06-04T08:00:00Z"), inLocalTime: false }],
    new Map([["v1", meta]]),
    new Map([["u1", "d1"]]),
    { enabled: false, translationsByVariant: new Map(), versePool, strategyByVariant: new Map<string, VerseStrategy>([["v1", "reference"]]) },
  );
  const g = Object.values(groups)[0];
  const payload = factory.buildPushPayload(
    { title: g.title ?? "", body: g.body, iosImageUrl: g.iosImageUrl ?? undefined, androidImageUrl: g.androidImageUrl ?? undefined },
    { externalUserIds: g.externalUserIds },
  );
  const messages = payload.messages as Record<string, Record<string, unknown>>;
  return { apple: messages.apple_push, android: messages.android_push };
}

describe("cron verse-push image (regression)", () => {
  it("attaches the seeded image_id to both platforms", () => {
    const { apple, android } = run(verseMeta(), pool);
    expect(apple.asset_url).toContain("/77058/");
    expect(apple.asset_url).toContain("320x320");
    expect(android.image_url).toContain("/77058/");
    expect(android.image_url).toContain("1024x512");
  });

  it("paired no-image arm (iconImageUrl null) attaches no image", () => {
    const { apple, android } = run(verseMeta({ iconImageUrl: null }), pool);
    expect(apple.asset_url).toBeUndefined();
    expect(android.image_url).toBeUndefined();
  });

  it("missing curated id falls back to DEFAULT_VERSE_IMAGE_ID", () => {
    const noId: VersePool = [{ ...pool[0], imageId: undefined }];
    const { android } = run(verseMeta(), noId);
    expect(android.image_url).toContain(`/${DEFAULT_VERSE_IMAGE_ID}/`);
  });

  it("static-URL arm passes its URL through unchanged", () => {
    const { apple, android } = run(verseMeta({ body: "Plain push", iconImageUrl: "https://cdn/x/static.png" }), pool);
    expect(apple.asset_url).toBe("https://cdn/x/static.png");
    expect(android.image_url).toBe("https://cdn/x/static.png");
  });
});
