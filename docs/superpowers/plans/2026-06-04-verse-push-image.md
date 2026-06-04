# Verse Push Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents attach a per-verse scripture-art image (or a static image) to push variants as an experimentable, per-variant option, riding the existing verse-push send rail.

**Architecture:** Reuse `MessageVariant.iconImageUrl` (no schema change) with a `VERSE_IMAGE_SENTINEL` marker. A pure `verse-image.ts` lib builds YouVersion imageproxy URLs (320×320 iOS, 1024×512 Android). The curated `USFM → image_id` map is seeded into `CampaignContent` as a new `contentType:"image"`; `verse-pool.ts` loads it onto `VerseEntry.imageId`. `send-grouping.ts` resolves the per-verse image at send time, keys the batch by image URL, and threads it into the payload factory, which is corrected to emit the documented iOS `asset_url` + `asset_file_type` fields and per-platform image URLs.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + Postgres (Neon), bun:test, Tailwind v4 + shadcn/ui.

**Branch:** `feat/verse-push-image` (spec committed at 90fdf13).

**Standing constraints (from CLAUDE.md + user):** `.env.local` is the PRODUCTION DB — scripts default to dry-run, only read-only SELECTs are run against prod, and `truncate`/`deleteMany` are never called outside `bun test`. Use `bun run check` (never npm). Never run tests in the background. New engine/lib fn → unit test; new endpoint → integration test; new behavior → regression test. Exclude any unrelated `.claude/settings.json` change from every commit.

---

## File Structure

**New**
- `src/lib/verse-image.ts` — pure URL/sentinel helpers. No I/O.
- `scripts/seed-verse-images.ts` — seed curated `USFM → image_id` into `CampaignContent` (`contentType:"image"`). Dry-run by default; `--commit`.
- `tests/unit/verse-image.test.ts`
- `tests/integration/payload-factory-image.test.ts`
- `tests/regression/cron-verse-push-image.test.ts`

**Modified**
- `src/lib/braze/payload-factory.ts` — iOS `asset_url`+`asset_file_type` (replaces legacy `rich_notification`); `PushMessage` gains `iosImageUrl?`/`androidImageUrl?` with `iconImageUrl` as the single-URL fallback for both.
- `src/lib/verse-content.ts` — `VerseEntry` gains `imageId?: string`.
- `src/lib/cron/verse-pool.ts` — load `contentType:"image"` into `entry.imageId`; image is NOT required for poolability.
- `src/lib/cron/send-grouping.ts` — `VariantMeta` gains `iconImageUrl`; `VariantSendGroup` gains `iosImageUrl`/`androidImageUrl`; resolve per-verse image when sentinel, fold image URLs into the group key, pass them to `buildPushPayload`.
- `src/app/api/cron/select-and-send/route.ts` — carry `iconImageUrl` into the `variantMeta` lookup.
- `scripts/create-verse-experiment.ts` — `--with-image` flag creates paired image / no-image arms.
- `src/app/api/push-library/route.ts` — accept `iconImageUrl` on POST.
- `src/components/push-library/template-form-sheet.tsx` + `src/components/agents/push-notification-preview.tsx` — image toggle/field + preview thumbnail.

---

### Task 0: Verify imageproxy center-crops 1024×512 (does not letterbox)

**Files:**
- None (manual verification gate — blocks the per-platform Android crop decision).

This is a correctness gate, not code. The Android arm requests a 1024×512 (2:1) crop from a square 1280×1280 master. If the proxy letterboxes instead of center-cropping, Android pushes show gray bars and we fall back to square-for-both (see Task 2 note).

- [ ] **Step 1: Request a 2:1 crop from a known image_id and inspect dimensions**

Run (JHN.3.16 → image_id 77058):
```bash
curl -sL -o /tmp/verse-2x1.jpg \
  "https://imageproxy-cdn.youversionapi.com/1024x512/https://s3.amazonaws.com/static-youversionapi-com/images/base/77058/1280x1280.jpg" \
  && file /tmp/verse-2x1.jpg
```
Expected: `JPEG image data ... 1024 x 512`. If the returned image is 1024×512 with no gray bars, the proxy center-crops — proceed with the 1024×512 Android decision. (Open `/tmp/verse-2x1.jpg` to eyeball for letterbox bars.)

- [ ] **Step 2: Record the result**

If center-crop confirmed: continue with Task 1 as written.
If letterboxed: in Task 1 `buildVerseImageUrls`, set Android to `320×320` (square-for-both) instead of `1024×512`, and update the Task 1 + Task 2 + Task 7 assertions accordingly. Note the change in the commit message.

---

### Task 1: Pure `verse-image.ts` lib

**Files:**
- Create: `src/lib/verse-image.ts`
- Test: `tests/unit/verse-image.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/verse-image.test.ts
import { describe, it, expect } from "bun:test";
import {
  VERSE_IMAGE_SENTINEL,
  DEFAULT_VERSE_IMAGE_ID,
  buildVerseImageUrl,
  buildVerseImageUrls,
  assetFileTypeFromUrl,
} from "@/lib/verse-image";

describe("verse-image", () => {
  it("sentinel + default id are stable constants", () => {
    expect(VERSE_IMAGE_SENTINEL).toBe("__NEXUS_VERSE_IMAGE__");
    expect(DEFAULT_VERSE_IMAGE_ID).toBe("1012");
  });

  it("buildVerseImageUrl composes the imageproxy URL with WxH and image_id", () => {
    expect(buildVerseImageUrl("77058", 320, 320)).toBe(
      "https://imageproxy-cdn.youversionapi.com/320x320/https://s3.amazonaws.com/static-youversionapi-com/images/base/77058/1280x1280.jpg"
    );
  });

  it("buildVerseImageUrls returns 320x320 iOS and 1024x512 Android", () => {
    const { ios, android } = buildVerseImageUrls("56520");
    expect(ios).toBe(buildVerseImageUrl("56520", 320, 320));
    expect(android).toBe(buildVerseImageUrl("56520", 1024, 512));
  });

  it("assetFileTypeFromUrl reads the extension, defaulting to jpg", () => {
    expect(assetFileTypeFromUrl("https://x/y/1280x1280.jpg")).toBe("jpg");
    expect(assetFileTypeFromUrl("https://x/y/a.PNG")).toBe("png");
    expect(assetFileTypeFromUrl("https://x/y/a.gif?w=1")).toBe("gif");
    expect(assetFileTypeFromUrl("https://x/y/noext")).toBe("jpg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/verse-image.test.ts`
Expected: FAIL — `Cannot find module '@/lib/verse-image'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/verse-image.ts
// Pure helpers for verse-push images. A MessageVariant whose iconImageUrl equals
// VERSE_IMAGE_SENTINEL resolves a per-verse image at send time from the chosen
// verse's image_id; a literal https URL is used as-is. No I/O.

/** iconImageUrl marker: resolve a per-verse image from the chosen verse's image_id. */
export const VERSE_IMAGE_SENTINEL = "__NEXUS_VERSE_IMAGE__";

/** Fallback image_id when a verse has no curated image (the Canvas default). */
export const DEFAULT_VERSE_IMAGE_ID = "1012";

const PROXY = "https://imageproxy-cdn.youversionapi.com";
const MASTER = "https://s3.amazonaws.com/static-youversionapi-com/images/base";

/** Build a YouVersion imageproxy URL: {W}x{H} crop of the square 1280x1280 master. */
export function buildVerseImageUrl(imageId: string, w: number, h: number): string {
  return `${PROXY}/${w}x${h}/${MASTER}/${imageId}/1280x1280.jpg`;
}

/** Per-platform verse image URLs: 320x320 square for iOS, 1024x512 (2:1) for Android. */
export function buildVerseImageUrls(imageId: string): { ios: string; android: string } {
  return {
    ios: buildVerseImageUrl(imageId, 320, 320),
    android: buildVerseImageUrl(imageId, 1024, 512),
  };
}

/** Braze iOS asset_file_type from a URL extension. Defaults to "jpg". */
export function assetFileTypeFromUrl(url: string): string {
  const m = url.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  const ext = m?.[1]?.toLowerCase();
  return ext && ["jpg", "jpeg", "png", "gif", "mp4"].includes(ext)
    ? (ext === "jpeg" ? "jpg" : ext)
    : "jpg";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/verse-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/verse-image.ts tests/unit/verse-image.test.ts
git commit -m "feat(verse-image): pure imageproxy URL + sentinel lib"
```

---

### Task 2: Payload factory — iOS `asset_url` fix + per-platform image URLs

**Files:**
- Modify: `src/lib/braze/payload-factory.ts:1-7` (PushMessage), `:71-90` (android/apple msg)
- Test: `tests/integration/payload-factory-image.test.ts`

Note: per CLAUDE.md this is a `tests/integration/` test but it needs no DB — it exercises pure payload construction. Keep it there for discoverability with the feature.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/payload-factory-image.test.ts
import { describe, it, expect } from "bun:test";
import { PayloadFactory } from "@/lib/braze/payload-factory";

const factory = new PayloadFactory();
const aud = { externalUserIds: ["u1"] };

function pushOf(payload: Record<string, unknown>) {
  const messages = payload.messages as Record<string, Record<string, unknown>>;
  return { android: messages.android_push, apple: messages.apple_push };
}

describe("payload-factory image fields", () => {
  it("sets per-platform image URLs (iOS asset_url + asset_file_type, Android image_url)", () => {
    const p = factory.buildPushPayload(
      {
        title: "t", body: "b",
        iosImageUrl: "https://x/y/77058/1280x1280.jpg",
        androidImageUrl: "https://x/y/1024.png",
      },
      aud,
    );
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBe("https://x/y/77058/1280x1280.jpg");
    expect(apple.asset_file_type).toBe("jpg");
    expect(apple.rich_notification).toBeUndefined();
    expect(android.image_url).toBe("https://x/y/1024.png");
  });

  it("falls back to iconImageUrl for both platforms when per-platform URLs absent", () => {
    const p = factory.buildPushPayload(
      { title: "t", body: "b", iconImageUrl: "https://x/y/a.png" },
      aud,
    );
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBe("https://x/y/a.png");
    expect(apple.asset_file_type).toBe("png");
    expect(android.image_url).toBe("https://x/y/a.png");
  });

  it("omits image fields entirely when no image is supplied", () => {
    const p = factory.buildPushPayload({ title: "t", body: "b" }, aud);
    const { android, apple } = pushOf(p);
    expect(apple.asset_url).toBeUndefined();
    expect(apple.asset_file_type).toBeUndefined();
    expect(android.image_url).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/payload-factory-image.test.ts`
Expected: FAIL — `apple.asset_url` is undefined (factory still emits `rich_notification`).

- [ ] **Step 3: Edit `PushMessage` interface**

In `src/lib/braze/payload-factory.ts`, add the two optional per-platform fields and import the file-type helper at the top:

```typescript
import { assetFileTypeFromUrl } from "@/lib/verse-image";

interface PushMessage {
  title: string;
  body: string;
  deeplink?: string;
  iconImageUrl?: string;
  /** iOS-specific image (square). Falls back to iconImageUrl. */
  iosImageUrl?: string;
  /** Android-specific image (2:1). Falls back to iconImageUrl. */
  androidImageUrl?: string;
  extraData?: Record<string, unknown>;
}
```

- [ ] **Step 4: Edit the android/apple message construction**

Replace the `androidMsg`/`appleMsg` blocks (currently `:71-90`) with:

```typescript
    const androidImage = msg.androidImageUrl ?? msg.iconImageUrl;
    const iosImage = msg.iosImageUrl ?? msg.iconImageUrl;

    const androidMsg: Record<string, unknown> = {
      alert: msg.body,
      title: msg.title,
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(androidImage && { image_url: androidImage }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(resolvedAndroidVariantId && { message_variation_id: resolvedAndroidVariantId }),
      ...((audience.externalUserIds || audience.recipients) && { app_id: this.androidAppId }),
    };

    const appleMsg: Record<string, unknown> = {
      alert: { body: msg.body, title: msg.title },
      ...(msg.deeplink && { custom_uri: msg.deeplink }),
      ...(iosImage && { asset_url: iosImage, asset_file_type: assetFileTypeFromUrl(iosImage) }),
      ...(msg.extraData && { extra: msg.extraData }),
      ...(resolvedIosVariantId && { message_variation_id: resolvedIosVariantId }),
      ...((audience.externalUserIds || audience.recipients) && { app_id: this.iosAppId }),
    };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/integration/payload-factory-image.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Guard against regressions in existing payload tests**

Run: `bun test tests/ -t "payload"`
Expected: PASS. If any existing test asserts `rich_notification`/`media_url`, update it to assert `asset_url`/`asset_file_type` (legacy format is intentionally removed).

- [ ] **Step 7: Commit**

```bash
git add src/lib/braze/payload-factory.ts tests/integration/payload-factory-image.test.ts
git commit -m "fix(braze): iOS asset_url image format + per-platform push image URLs"
```

---

### Task 3: `VerseEntry.imageId` field

**Files:**
- Modify: `src/lib/verse-content.ts:24`

No standalone test — exercised by Tasks 4 and 7.

- [ ] **Step 1: Add `imageId` to the `VerseEntry` type**

In `src/lib/verse-content.ts`, change:
```typescript
export type VerseEntry = { usfm: string; byLang: Map<string, VerseLangContent> };
```
to:
```typescript
export type VerseEntry = { usfm: string; byLang: Map<string, VerseLangContent>; imageId?: string };
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/verse-content.ts
git commit -m "feat(verse-content): VerseEntry.imageId for per-verse image"
```

---

### Task 4: `verse-pool.ts` loads `contentType:"image"` into `imageId`

**Files:**
- Modify: `src/lib/cron/verse-pool.ts`
- Test: `tests/unit/verse-pool-image.test.ts` (new — `shapeVersePool` is pure)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/verse-pool-image.test.ts
import { describe, it, expect } from "bun:test";
import { shapeVersePool, type CampaignContentRow } from "@/lib/cron/verse-pool";

function row(p: Partial<CampaignContentRow>): CampaignContentRow {
  return { contentType: "", language: "en", usfmReference: "JHN.3.16", usfmHuman: null, title: null, body: null, ...p };
}

// An entry is poolable only if EN can render every arm.
const renderable = (usfm: string): CampaignContentRow[] => [
  row({ contentType: "verse-text", usfmReference: usfm, body: "text" }),
  row({ contentType: "a-title", usfmReference: usfm, title: "A" }),
  row({ contentType: "b-title", usfmReference: usfm, title: "B" }),
];

describe("shapeVersePool image rows", () => {
  it("attaches image_id from a contentType:image row to entry.imageId", () => {
    const pool = shapeVersePool([
      ...renderable("JHN.3.16"),
      row({ contentType: "image", usfmReference: "JHN.3.16", body: "77058" }),
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].imageId).toBe("77058");
  });

  it("leaves imageId undefined when no image row exists", () => {
    const pool = shapeVersePool(renderable("JHN.3.16"));
    expect(pool[0].imageId).toBeUndefined();
  });

  it("does NOT make an image-only entry poolable (still needs renderable copy)", () => {
    const pool = shapeVersePool([
      row({ contentType: "image", usfmReference: "GEN.1.1", body: "999" }),
    ]);
    expect(pool).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/verse-pool-image.test.ts`
Expected: FAIL — `image` rows are skipped by the `CONTENT_TYPES` guard, so `imageId` is undefined.

- [ ] **Step 3: Edit `verse-pool.ts`**

Add an image content type for loading without adding it to the render-requirement set. Replace lines `5-6`:

```typescript
const CAMPAIGN = "resurrection-push";
// Render fields required for an entry to be poolable.
const CONTENT_TYPES = ["reference", "a-title", "b-title", "verse-text"] as const;
const IMAGE_CONTENT_TYPE = "image";
// Types fetched from the DB (image is loaded but not required for poolability).
const LOAD_CONTENT_TYPES = [...CONTENT_TYPES, IMAGE_CONTENT_TYPE] as const;
```

In `shapeVersePool`, handle image rows before the `CONTENT_TYPES` guard. Replace the loop body (currently `:21-30`) with:

```typescript
  for (const r of rows) {
    let e = byUsfm.get(r.usfmReference);
    if (!e) { e = { usfm: r.usfmReference, byLang: new Map() }; byUsfm.set(r.usfmReference, e); }

    if (r.contentType === IMAGE_CONTENT_TYPE) {
      const id = r.body?.trim();
      if (id) e.imageId = id;
      continue;
    }

    const field = r.contentType as VerseField;
    if (!CONTENT_TYPES.includes(field as (typeof CONTENT_TYPES)[number])) continue;
    let lc = e.byLang.get(r.language) as VerseLangContent | undefined;
    if (!lc) { lc = {}; e.byLang.set(r.language, lc); }
    const value = field === "a-title" || field === "b-title" ? r.title : r.body;
    if (value && value.trim()) lc[field] = value;
  }
```

Update the DB query in `loadVersePool` (currently `:49`) to fetch image rows too:

```typescript
    where: { campaign: CAMPAIGN, status: "active", contentType: { in: [...LOAD_CONTENT_TYPES] } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/verse-pool-image.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Guard the existing verse-pool suite**

Run: `bun test tests/ -t "verse-pool"`
Expected: PASS (image-less pools still shape identically; imageId just stays undefined).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron/verse-pool.ts tests/unit/verse-pool-image.test.ts
git commit -m "feat(verse-pool): load contentType:image into VerseEntry.imageId"
```

---

### Task 5: `send-grouping.ts` — thread image through meta, group key, payload

**Files:**
- Modify: `src/lib/cron/send-grouping.ts`
- Test: covered by Task 7 (cron regression). Add a focused unit test here too.
- Test: `tests/unit/send-grouping-image.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/send-grouping-image.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/send-grouping-image.test.ts`
Expected: FAIL — `VariantMeta` has no `iconImageUrl`; group has no `iosImageUrl`/`androidImageUrl`.

- [ ] **Step 3: Extend the types**

In `src/lib/cron/send-grouping.ts`, add the import and extend both types.

Add to the imports near the top:
```typescript
import { VERSE_IMAGE_SENTINEL, DEFAULT_VERSE_IMAGE_ID, buildVerseImageUrls } from "@/lib/verse-image";
```

Add to `VariantSendGroup` (after `deeplink: string | null;`):
```typescript
  iosImageUrl: string | null;
  androidImageUrl: string | null;
```

Add to `VariantMeta` (after `givingHandleStrategy: ...;`):
```typescript
  /** null = no image; VERSE_IMAGE_SENTINEL = per-verse image; https URL = static image. */
  iconImageUrl: string | null;
```

- [ ] **Step 4: Resolve image URLs inside `groupDecisionsByVariant`**

Inside the loop, the verse arm already computes `verse` when `isVerse`. Capture the verse's imageId. Add a resolved-image computation after `copyKeyed` is determined (just before `const groupInLocalTime = isFallback;`).

First, hoist the chosen verse so it is visible after the branch. Change the verse block (currently `:107-112`) so the picked verse is stored:

```typescript
      let verseImageId: string | undefined;
      if (isVerse) {
        const dateBucket = scheduledAt.toISOString().slice(0, 10);
        const verse = pickVerse(localization!.versePool!, user.externalId, dateBucket);
        // Empty pool → skip rather than deliver the raw sentinel as a push body.
        if (!verse) continue;
        copy = resolveVerseCopy(verse, tag, verseStrategy!);
        verseImageId = verse.imageId;
      } else if (localization?.enabled && meta.channel === "push") {
```

(Keep the rest of that `else if` block unchanged. Declare `let verseImageId` inside the `else` branch scope where `isVerse` lives — i.e. immediately before the `if (isVerse)`.)

Then, after `copyKeyed = ...;` for the non-giving branch and before `const groupInLocalTime`, compute the per-platform image URLs for this user:

```typescript
    // Resolve per-platform image URLs (payload-determining → folded into the group key).
    let iosImageUrl: string | null = null;
    let androidImageUrl: string | null = null;
    if (meta.iconImageUrl === VERSE_IMAGE_SENTINEL) {
      // Sentinel only resolves on a verse arm (we have a chosen verse). On a
      // non-verse arm the sentinel is meaningless → no image.
      if (meta.body === VERSE_PUSH_SENTINEL && meta.channel === "push") {
        const { ios, android } = buildVerseImageUrls(verseImageId ?? DEFAULT_VERSE_IMAGE_ID);
        iosImageUrl = ios;
        androidImageUrl = android;
      }
    } else if (meta.iconImageUrl) {
      iosImageUrl = meta.iconImageUrl;
      androidImageUrl = meta.iconImageUrl;
    }
```

Note: `verseImageId` is declared inside the `else` (non-giving) branch. To reference it after the branch, declare `let verseImageId: string | undefined;` at the top of the loop body (alongside `let copy`), and assign it within the verse block. Adjust Step 4's verse block to assign (not re-declare) `verseImageId`.

**Corrected placement** — at the top of the loop, with the other `let` declarations:
```typescript
    let copy: LocalizedCopy = { title: meta.title, body: meta.body };
    let resolvedDeeplink: string | null;
    let copyKeyed: boolean;
    let verseImageId: string | undefined;
```
and in the verse block use `verseImageId = verse.imageId;` (no `let`).

- [ ] **Step 5: Fold image URLs into the group key and the group object**

Change the `groupKey` (currently `:133-135`) to include the image so users resolving to different images batch separately:

```typescript
    const imageKey = `${iosImageUrl ?? ""} ${androidImageUrl ?? ""}`;
    const groupKey = (copyKeyed
      ? `${baseKey}:${copy.title ?? ""} ${copy.body}`
      : baseKey) + ` ${imageKey}`;
```

Add the two fields to the group initializer (currently `:138-151`), after `deeplink:`:

```typescript
        iosImageUrl,
        androidImageUrl,
```

- [ ] **Step 6: Pass image URLs into `buildPushPayload`**

In `sendVariantGroup`, the push branch (currently `:196-202`) becomes:

```typescript
      payload = factory.buildPushPayload(
        {
          title: group.title ?? "",
          body: group.body,
          deeplink: group.deeplink ?? undefined,
          iosImageUrl: group.iosImageUrl ?? undefined,
          androidImageUrl: group.androidImageUrl ?? undefined,
        },
        audience,
        resolvedCampaignId,
        group.brazeVariantId ?? undefined,
        group.inLocalTime,
      );
```

- [ ] **Step 7: Run the focused test**

Run: `bun test tests/unit/send-grouping-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Guard the existing send-grouping suite**

Run: `bun test tests/ -t "grouping"`
Expected: PASS. If any existing test constructs a `VariantMeta` literal, it now needs `iconImageUrl: null` — add it.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/unit/send-grouping-image.test.ts
git commit -m "feat(send-grouping): resolve + thread per-verse image through group key and payload"
```

---

### Task 6: Cron route carries `iconImageUrl` into `variantMeta`

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts:521-541`

The agent query (`:113-116`) already loads all variant columns (no `select`), so `v.iconImageUrl` is available.

- [ ] **Step 1: Add `iconImageUrl` to the inline `variantMeta` type**

In the `new Map<string, {...}>()` type literal (currently `:521-529`), add after `givingHandleStrategy: GivingHandleStrategy | null;`:
```typescript
      iconImageUrl: string | null;
```

- [ ] **Step 2: Populate it in the `variantMeta.set(...)` call**

In the `.set(v.id, {...})` object (currently `:532-540`), add after `givingHandleStrategy: ...,`:
```typescript
          iconImageUrl: v.iconImageUrl ?? null,
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: no errors (the `VariantMeta` type from send-grouping now requires `iconImageUrl`, which this map supplies).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat(cron): carry iconImageUrl into variantMeta for image resolution"
```

---

### Task 7: Cron regression test — verse arm attaches per-verse image end-to-end

**Files:**
- Test: `tests/regression/cron-verse-push-image.test.ts`

This exercises the grouping → payload path the cron uses, asserting the imageproxy URL carries the seeded image_id. It runs against the pure `groupDecisionsByVariant` + `PayloadFactory` (no DB), mirroring how the cron builds the push.

- [ ] **Step 1: Write the test**

```typescript
// tests/regression/cron-verse-push-image.test.ts
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
    brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
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
```

- [ ] **Step 2: Run test**

Run: `bun test tests/regression/cron-verse-push-image.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/regression/cron-verse-push-image.test.ts
git commit -m "test(regression): verse-push image threads through cron send path"
```

---

### Task 8: Seed script — curated `USFM → image_id` into `CampaignContent`

**Files:**
- Create: `scripts/seed-verse-images.ts`

Pattern mirrors `scripts/seed-resurrection-push.ts` (same `CAMPAIGN`, `createMany` + `skipDuplicates`, dry-run default). Image rows: `contentType:"image"`, `language:"en"`, `usfmReference:<USFM>`, `body:<image_id>`, `usfmHuman: usfmToHuman(usfm)`, `title:null`.

- [ ] **Step 1: Write the script**

```typescript
// scripts/seed-verse-images.ts
// Seed the curated USFM → image_id map into CampaignContent as contentType:"image"
// for the resurrection-push verse pool. Dry-run by default; pass --commit.
// prisma here targets .env.local (production) per CLAUDE.md — review the dry run.
import { prisma } from "@/lib/db";
import { usfmToHuman } from "@/lib/usfm";

const CAMPAIGN = "resurrection-push";

// Curated map from the Braze Resurrection Canvas liquid (deterministic, on-brand).
const VERSE_IMAGE_IDS: Record<string, number> = {
  "1CO.13.4": 79064,
  "1CO.3.16": 82877,
  "1CO.3.7": 97460,
  "1JN.1.9": 98384,
  "1JN.2.6": 113693,
  "1JN.3.16": 78243,
  "1JN.4.9": 86002,
  "1PE.3.15": 95231,
  "1PE.4.8": 56511,
  "1PE.5.8": 88791,
  "2CO.12.9": 58404,
  "2CO.3.17": 94253,
  "2CO.5.18": 91310,
  "2CO.5.21": 97917,
  "2CO.9.7": 84274,
  "2TI.1.7": 87968,
  "ACT.1.8": 81965,
  "ACT.10.43": 98380,
  "ACT.2.38": 71812,
  "ACT.4.12": 51164,
  "ACT.4.31": 110090,
  "AMO.5.24": 91942,
  "COL.3.2": 91354,
  "EPH.2.10": 98382,
  "EPH.2.8": 25568,
  "EZK.36.26": 52766,
  "GAL.5.16": 81966,
  "GAL.5.25": 60133,
  "HEB.12.2": 56520,
  "ISA.1.17": 106546,
  "ISA.12.2": 67209,
  "ISA.43.2": 37578,
  "ISA.53.5": 80556,
  "ISA.53.6": 81632,
  "ISA.55.6": 68506,
  "JAS.1.5": 106624,
  "JAS.4.7": 13741,
  "JHN.1.12": 113708,
  "JHN.15.12": 112538,
  "JHN.15.2": 46344,
  "JHN.16.13": 89267,
  "JHN.16.33": 110327,
  "JHN.20.21": 71804,
  "JHN.3.16": 77058,
  "JHN.3.17": 46025,
  "JHN.5.24": 46358,
  "JHN.8.12": 110600,
  "LUK.6.28": 91943,
  "MAT.10.20": 113690,
  "MAT.16.24": 112156,
  "MAT.28.19": 67133,
  "MAT.28.6": 101963,
  "MAT.5.10": 94010,
  "MAT.5.14": 424,
  "MAT.5.16": 44251,
  "MAT.5.3": 81643,
  "MAT.5.4": 92875,
  "MAT.5.5": 92880,
  "MAT.5.6": 92876,
  "MAT.5.7": 92879,
  "MAT.5.8": 92881,
  "MAT.5.9": 92884,
  "MAT.6.33": 91314,
  "MAT.9.37": 81648,
  "MIC.6.8": 61799,
  "MRK.13.33": 97470,
  "MRK.16.15": 94047,
  "PHP.2.5": 94045,
  "PRO.13.20": 46032,
  "PRO.29.25": 72140,
  "PRO.9.10": 100136,
  "PSA.103.13": 58425,
  "PSA.139.14": 68525,
  "PSA.145.18": 23025,
  "PSA.23.3": 39665,
  "PSA.27.14": 112517,
  "PSA.32.8": 17238,
  "PSA.34.18": 72329,
  "PSA.4.8": 88784,
  "PSA.42.11": 52780,
  "ROM.1.16": 98397,
  "ROM.1.17": 112545,
  "ROM.10.13": 110599,
  "ROM.10.14": 101978,
  "ROM.10.17": 98400,
  "ROM.10.9": 113711,
  "ROM.3.23": 104846,
  "ROM.5.8": 112155,
  "ROM.8.18": 46359,
  "ROM.8.31": 83999,
  "ZEC.14.9": 2628,
};

async function main() {
  const doCommit = process.argv.includes("--commit");
  const entries = Object.entries(VERSE_IMAGE_IDS);
  console.log(`Seed verse images — ${doCommit ? "COMMIT" : "DRY RUN"} — ${entries.length} verses`);
  for (const [usfm, id] of entries.slice(0, 5)) {
    console.log(`  ${usfm.padEnd(12)} → image_id ${id} (${usfmToHuman(usfm)})`);
  }
  console.log(`  … and ${entries.length - 5} more`);
  if (!doCommit) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); return; }

  const rows = entries.map(([usfmReference, imageId]) => ({
    campaign: CAMPAIGN,
    contentType: "image",
    language: "en",
    usfmReference,
    usfmHuman: usfmToHuman(usfmReference),
    title: null,
    body: String(imageId),
  }));
  const result = await prisma.campaignContent.createMany({ data: rows, skipDuplicates: true });
  console.log(`\nInserted ${result.count} new image rows (skipped ${rows.length - result.count} existing).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Typecheck + dry-run**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run scripts/seed-verse-images.ts`
Expected: prints `DRY RUN — nothing written`, 91 verses, a 5-row sample. (Do NOT pass `--commit` here — committing to prod is a separate, user-initiated step.)

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-verse-images.ts
git commit -m "feat(scripts): seed curated USFM->image_id into CampaignContent"
```

---

### Task 9: `create-verse-experiment.ts` — `--with-image` paired arms

**Files:**
- Modify: `scripts/create-verse-experiment.ts`

`--with-image` creates, for each of the 4 strategies, two arms: one without an image and one with `iconImageUrl = VERSE_IMAGE_SENTINEL`. The bandit attributes per `variantId`, so image-vs-no-image lift is learned within one experiment.

- [ ] **Step 1: Edit the script**

Add the import:
```typescript
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
```

Replace `main()` body's commit section so arms expand when `--with-image` is set. Change the arm-creation loop (currently `:34-39`) to:

```typescript
  const withImage = process.argv.includes("--with-image");
  for (const a of ARMS) {
    const variants = withImage
      ? [
          { name: a.name, iconImageUrl: null as string | null },
          { name: `${a.name} + image`, iconImageUrl: VERSE_IMAGE_SENTINEL as string | null },
        ]
      : [{ name: a.name, iconImageUrl: null as string | null }];
    for (const v of variants) {
      await prisma.messageVariant.create({
        data: { messageId: message.id, name: v.name, body: VERSE_PUSH_SENTINEL, title: a.title,
          status: "active", category: "verse-experiment", subcategory: a.strategy,
          ...(v.iconImageUrl && { iconImageUrl: v.iconImageUrl }) },
      });
    }
  }
  const armCount = withImage ? ARMS.length * 2 : ARMS.length;
  console.log(`\nCreated agent ${agent.id} (draft), message ${message.id}, ${armCount} arms.`);
```

Also update the dry-run summary loop (currently `:21-24`) to reflect `--with-image`:
```typescript
  const withImageDry = process.argv.includes("--with-image");
  for (const a of ARMS) {
    console.log(`  arm ${a.strategy.padEnd(11)} title="${a.title}" body=${VERSE_PUSH_SENTINEL} ` +
      `(title<-${VERSE_STRATEGY[a.strategy].title}, body<-${VERSE_STRATEGY[a.strategy].body})` +
      (withImageDry ? "  [+ paired image arm]" : ""));
  }
```

(Remove the now-superseded single-line `console.log` that printed the old arm count.)

- [ ] **Step 2: Typecheck + dry-run both modes**

Run: `bun run typecheck`
Expected: no errors.

Run: `bun run scripts/create-verse-experiment.ts`
Expected: 4 arms listed, `DRY RUN`.

Run: `bun run scripts/create-verse-experiment.ts --with-image`
Expected: 4 arms listed each marked `[+ paired image arm]`, `DRY RUN`.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-verse-experiment.ts
git commit -m "feat(scripts): --with-image creates paired image/no-image verse arms"
```

---

### Task 10: UI — image toggle/field + preview thumbnail

**Files:**
- Modify: `src/app/api/push-library/route.ts:72-80,126-138` (accept iconImageUrl on POST)
- Modify: `src/components/push-library/template-form-sheet.tsx`
- Modify: `src/components/agents/push-notification-preview.tsx`

The PATCH route (`/api/variants/[id]`) already allows `iconImageUrl` (route ALLOWED list). The POST route (`/api/push-library`) does not yet — add it.

- [ ] **Step 1: Accept `iconImageUrl` on push-library POST**

In `src/app/api/push-library/route.ts`, add `iconImageUrl` to the destructure (`:72-80`):
```typescript
  const { name, category, subcategory, title, body: msgBody, deeplink, cta, iconImageUrl } = body as {
    name?: unknown;
    category?: unknown;
    subcategory?: unknown;
    title?: unknown;
    body?: unknown;
    deeplink?: unknown;
    cta?: unknown;
    iconImageUrl?: unknown;
  };
```

And to the `messageVariant.create` data (`:126-137`), after `subcategory:`:
```typescript
        iconImageUrl: typeof iconImageUrl === "string" ? iconImageUrl.trim() || null : null,
```

- [ ] **Step 2: Add an integration test for the POST field**

Append to (or create) `tests/integration/push-library.test.ts` a case asserting a POST with `iconImageUrl` persists it. (Use existing builders/cleanup conventions in that file. If the file does not exist, add a minimal one with `requireAdmin` mocked the same way sibling endpoint tests do.)

```typescript
it("persists iconImageUrl on create", async () => {
  const res = await POST(makeReq({
    name: "Img arm", category: "verse", title: "T", body: "B",
    iconImageUrl: "__NEXUS_VERSE_IMAGE__",
  }));
  expect(res.status).toBe(201);
  const { data } = await res.json();
  expect(data.iconImageUrl).toBe("__NEXUS_VERSE_IMAGE__");
});
```

Run: `bun test tests/integration/push-library.test.ts`
Expected: PASS (new case green; existing cases unaffected).

- [ ] **Step 3: Thread `iconImageUrl` through the form**

In `src/components/push-library/template-form-sheet.tsx`:

Add to `TemplateVariant` type:
```typescript
  iconImageUrl: string | null;
```

Add the sentinel import:
```typescript
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
```

Add state (after `const [cta, ...]`):
```typescript
  const [iconImageUrl, setIconImageUrl] = useState(variant?.iconImageUrl ?? "");
```

Reset it in `resetForm` (create mode): add `setIconImageUrl("");`.

In `handleSubmit`, include it in both POST and PATCH bodies:
```typescript
            iconImageUrl: iconImageUrl.trim() || null,
```
(POST: as `iconImageUrl: iconImageUrl.trim() || undefined,`; PATCH: `iconImageUrl: iconImageUrl.trim() || null,`.)

- [ ] **Step 4: Render the image control**

After the CTA field block and before the Preview block, add an image control. For verse subcategories show a toggle that sets the sentinel; otherwise a URL input.

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="iconImage">Image (optional)</Label>
            {["reference", "headline-a", "headline-b", "inverted"].includes(subcategory) ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={iconImageUrl === VERSE_IMAGE_SENTINEL}
                  onChange={(e) => setIconImageUrl(e.target.checked ? VERSE_IMAGE_SENTINEL : "")}
                />
                Attach the per-verse scripture image
              </label>
            ) : (
              <Input
                id="iconImage"
                value={iconImageUrl === VERSE_IMAGE_SENTINEL ? "" : iconImageUrl}
                onChange={(e) => setIconImageUrl(e.target.value)}
                placeholder="https://… (image URL)"
              />
            )}
          </div>
```

Pass an image preview hint to the live preview — for the sentinel, show a representative verse image (JHN.3.16 → 77058); for a literal URL, show it directly:

```tsx
            <PushNotificationPreview
              title={title || undefined}
              body={body || "Your message body will appear here."}
              imageUrl={
                iconImageUrl === VERSE_IMAGE_SENTINEL
                  ? "https://imageproxy-cdn.youversionapi.com/320x320/https://s3.amazonaws.com/static-youversionapi-com/images/base/77058/1280x1280.jpg"
                  : (iconImageUrl || undefined)
              }
              deeplink={/* unchanged */}
            />
```

- [ ] **Step 5: Render the image in the preview component**

In `src/components/agents/push-notification-preview.tsx`, add an optional `imageUrl` prop and render a big-picture thumbnail under the body.

Extend `PushNotificationPreviewProps`:
```typescript
  imageUrl?: string;
```

Thread it through `PushNotificationPreview` into each `NotificationCard`. Extend `NotificationCard` to accept and render it:
```tsx
function NotificationCard({ title, body, deeplink, imageUrl }: { title: string; body: string; deeplink?: string | null; imageUrl?: string }) {
```
After the `<div className="flex items-start gap-2.5">…</div>` row and before the deeplink block, add:
```tsx
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Push image" className="mt-2 w-full rounded-lg object-cover" />
        )}
```
Pass `imageUrl` from `PushNotificationPreview` to all three `<NotificationCard … />` usages (no-personalization, personalized, fallback).

- [ ] **Step 6: Manual UI check**

Run: `bun run dev`
Open the Push Library, create/edit a push variant. Verify: (a) for a verse subcategory the "Attach the per-verse scripture image" checkbox appears and toggling it shows the verse thumbnail in the preview; (b) for a non-verse subcategory a URL field appears and a pasted image URL renders in the preview; (c) saving persists the value (reopen edit sheet → state restored). If you cannot run the browser, state so explicitly.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/push-library/route.ts src/components/push-library/template-form-sheet.tsx src/components/agents/push-notification-preview.tsx tests/integration/push-library.test.ts
git commit -m "feat(ui): verse/static push image field + preview thumbnail"
```

---

### Task 11: Full check + finish

- [ ] **Step 1: Run the full suite**

Run: `bun run check`
Expected: typecheck + lint + unit/integration/regression all green. Fix anything red before finishing. Do NOT run in the background.

- [ ] **Step 2: Confirm no stray `.claude/settings.json` change is staged**

Run: `git status`
Expected: only feature files. If `.claude/settings.json` appears, leave it unstaged (excluded per standing constraint).

- [ ] **Step 3: Finish the branch**

Use `superpowers:finishing-a-development-branch`. Per the user's standing "push and merge" preference: push `feat/verse-push-image`, open a GitLab MR via `glab`, and merge when ready (don't poll for Greptile).

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-04-verse-push-image-design.md`):
- Per-variant opt-in via `iconImageUrl` + `VERSE_IMAGE_SENTINEL`, no schema change → Tasks 1, 5, 6, 9, 10. ✓
- Curated `USFM → image_id` in `CampaignContent` `contentType:"image"` → Tasks 4, 8. ✓
- 320×320 iOS + 1024×512 Android → Task 1 (+ Task 0 verification gate). ✓
- iOS `asset_url` + `asset_file_type` correctness fix → Task 2. ✓
- `verse-image.ts` (sentinel, default id, build fns, assetFileTypeFromUrl) → Task 1. ✓
- `VerseEntry.imageId`, verse-pool loading → Tasks 3, 4. ✓
- send-grouping threading + group key includes image URL → Task 5. ✓
- route variantMeta iconImageUrl → Task 6. ✓
- seed script + create-experiment `--with-image` → Tasks 8, 9. ✓
- UI field + preview → Task 10. ✓
- Edge cases: missing curated id → default (Task 5/7); literal URL → both platforms (Task 5); image in group key (Task 5). ✓
- Tests: unit/integration/regression as specced → Tasks 1, 2, 4, 5, 7, 10. ✓

**Placeholder scan:** No TBD/TODO; the only deferred item is the user-initiated `--commit` of the seed (intentional, prod-write). Image map is complete (91 entries).

**Type consistency:** `VERSE_IMAGE_SENTINEL`/`DEFAULT_VERSE_IMAGE_ID` (string) used consistently across verse-image, send-grouping, route, scripts, tests. `buildVerseImageUrls` returns `{ios, android}` everywhere. `PushMessage.iosImageUrl`/`androidImageUrl` (Task 2) match the call site in `sendVariantGroup` (Task 5). `VariantMeta.iconImageUrl: string | null` (Task 5) matches the route's map (Task 6) and the test literals. `VariantSendGroup.iosImageUrl`/`androidImageUrl: string | null` set at init (Task 5) and read in the push branch (Task 5).
