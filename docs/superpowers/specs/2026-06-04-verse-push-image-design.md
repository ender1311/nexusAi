# Verse Push Image — Design

**Status:** Draft for review
**Branch:** `feat/verse-push-image`
**Author:** Dan Luk (with Claude)
**Date:** 2026-06-04

## Goal

Let agents attach a verse image (a square scripture-art image, keyed by the
verse's USFM reference) to verse-related push notifications, as an
**experimentable, per-variant** option. Some arms carry the image, some don't,
and the bandit learns which lifts conversion — overall and per persona.

This generalizes the behavior already proven in the Braze "Resurrection Push"
Canvas, which attaches a 320×320 square verse image derived from the daily VOTD
USFM.

## Background: how the Braze Canvas does it

The Canvas computes a verse image URL from `votd_usfm` via YouVersion's image
proxy:

```
https://imageproxy-cdn.youversionapi.com/{W}x{H}/https://s3.amazonaws.com/static-youversionapi-com/images/base/{IMAGE_ID}/1280x1280.jpg
```

Two derivations of `IMAGE_ID` exist:
- **Dynamic** — `GET images.youversionapi.com/3.2/items.json?usfm[]=<USFM>&language_tag=<lang>`,
  take the most recent `category=prerendered` image.
- **Deterministic / curated** — a hand-maintained `USFM → image_id` map
  (~90 verses) that picks the best on-brand image per verse. This is what the
  Canvas actually ships, because the dynamic lookup returns variable quality.

The image is set on Android `image_url` (big picture) and the iOS rich
attachment.

## Braze image requirements (from docs)

| | iOS rich push | Android big-picture |
|---|---|---|
| API field | `asset_url` + `asset_file_type` (`jpg`/`png`/`gif`/`mp4`/…) | `image_url` |
| Max | 1038×1038, ≤5 MB (10 MB hard cap) | recommend 2:1, ≤500 KB, JPEG/PNG |
| Square handling | ideal — fills the expanded view | expects 2:1; a square is center-cropped/letterboxed |
| Payload cap | alert + extra ≤ 1912 bytes | ≤ 4000 bytes |

**Decision (size/shape):** emit **320×320 square for iOS** (`asset_url`) and a
**1024×512 (2:1) crop for Android** (`image_url`). Best per-platform look.

**Risk:** the proxy serves from a square 1280×1280 master, so a `1024x512`
request must *center-crop*, not letterbox. Verified during implementation
(Task 0); fallback is square-for-both if the proxy letterboxes.

## Current Nexus state (what already exists)

- `PayloadFactory.buildPushPayload` already attaches an image from
  `msg.iconImageUrl`: Android `image_url`, iOS
  `rich_notification.media_url` / `media_type: "img"`.
  **The iOS shape is legacy** — the current documented field is
  `asset_url` + `asset_file_type`. Needs a correctness fix.
- `MessageVariant.iconImageUrl` column exists but is **never threaded through
  the cron send pipeline** (`send-grouping.ts` builds the push with only
  title/body/deeplink).
- Verse pushes already work: a variant with `body === VERSE_PUSH_SENTINEL` and a
  strategy in `subcategory`; the cron picks a per-user verse at send time from
  the `CampaignContent` pool (campaign `resurrection-push`) via
  `loadVersePool` → `pickVerse` → `resolveVerseCopy`, then
  `groupDecisionsByVariant` → `sendVariantGroup` → `buildPushPayload`.

The image rides the **same rail**, keyed by the chosen verse's USFM.

## Design decisions (confirmed)

1. **Opt-in: per-variant, reuse `iconImageUrl` + a sentinel.** No schema change.
   - `iconImageUrl === VERSE_IMAGE_SENTINEL` → resolve a per-verse image at send
     time from the chosen verse's `image_id`.
   - `iconImageUrl === <https URL>` → static image for any push variant (now
     actually delivered, once threaded).
   - `iconImageUrl === null` → no image.
   - Experiment shape: paired arms (`reference` / `reference + image`, …); the
     bandit attributes per `variantId`, so it learns the image's lift per arm
     and per persona. Mixing image/no-image in one experiment is free.

2. **Map source: curated `USFM → image_id` in `CampaignContent` (DB).**
   New `contentType: "image"`, `language: "en"`, `usfmReference: <USFM>`,
   `body: <image_id>`. Seeded from the curated map. Editable; deterministic;
   zero send-time HTTP. (Optional future: a sync script fills gaps from the live
   images API.)

3. **iOS field fix:** switch the payload factory's iOS image to
   `asset_url` + `asset_file_type` (derived from URL extension; default `jpg`).

## Architecture / file structure

**New**
- `src/lib/verse-image.ts` — pure. `VERSE_IMAGE_SENTINEL`,
  `DEFAULT_VERSE_IMAGE_ID`, `buildVerseImageUrl(imageId, w, h)`,
  `buildVerseImageUrls(imageId)` → `{ ios: 320×320, android: 1024×512 }`,
  `assetFileTypeFromUrl(url)`.
- `scripts/seed-verse-images.ts` — seed the curated `USFM → image_id` map into
  `CampaignContent` (`contentType:"image"`). Dry-run by default; `--commit`.
- Tests: `tests/unit/verse-image.test.ts`,
  `tests/integration/payload-factory-image.test.ts`,
  `tests/regression/cron-verse-push-image.test.ts`.

**Modified**
- `src/lib/braze/payload-factory.ts` — `PushMessage` gains
  `iosImageUrl?` / `androidImageUrl?` (with `iconImageUrl` as the single-URL
  fallback for both, preserving existing callers). iOS uses
  `asset_url` + `asset_file_type`; Android keeps `image_url`.
- `src/lib/verse-content.ts` — `VerseEntry` gains `imageId?: string`.
- `src/lib/cron/verse-pool.ts` — load `contentType:"image"` into
  `entry.imageId`; `CONTENT_TYPES` extended for the query (but image is *not*
  required for an entry to be poolable).
- `src/lib/cron/send-grouping.ts` — `VariantMeta` + `VariantSendGroup` gain
  `iconImageUrl`. In `groupDecisionsByVariant`, when a verse arm's
  `iconImageUrl === VERSE_IMAGE_SENTINEL`, derive the per-verse URLs from
  `verse.imageId ?? DEFAULT_VERSE_IMAGE_ID`; a literal URL passes through.
  Include the resolved image URL in the group key. `sendVariantGroup` passes the
  image into `buildPushPayload` for the push channel.
- `src/app/api/cron/select-and-send/route.ts` — carry `iconImageUrl` in the
  variant lookup that feeds `variantMeta`.
- `scripts/create-verse-experiment.ts` — `--with-image` flag stamps
  `iconImageUrl = VERSE_IMAGE_SENTINEL` on the arms (or creates paired
  image/no-image arms).
- UI — `template-form-sheet.tsx` + `push-notification-preview.tsx`: an image
  field/toggle for push variants, with the image shown in the live preview.

## Data flow (verse arm with image)

```
cron: load agent.messages[].variants (now incl. iconImageUrl)
  → variantMeta[variantId].iconImageUrl = VERSE_IMAGE_SENTINEL
  → loadVersePool(): CampaignContent rows (incl. contentType:"image")
       → VerseEntry { usfm, byLang, imageId }
  → groupDecisionsByVariant(): per user, pickVerse() → verse
       if iconImageUrl === SENTINEL:
         { ios, android } = buildVerseImageUrls(verse.imageId ?? DEFAULT)
       group key += image URL
  → sendVariantGroup(): buildPushPayload({ title, body, deeplink,
         iosImageUrl: ios, androidImageUrl: android })
       iOS  → apple_push.asset_url + asset_file_type:"jpg"
       Android → android_push.image_url
```

## Error handling / edge cases

- Verse has no curated `image_id` → fall back to `DEFAULT_VERSE_IMAGE_ID`
  (1012, the Canvas default). Never block the send.
- `iconImageUrl` literal URL with no recognizable extension →
  `asset_file_type` defaults to `"jpg"`.
- Static image on a non-verse push: same single URL used for both platforms
  (no 2:1 crop available; acceptable for operator-supplied URLs).
- Image URL is part of the grouping key, so users who resolve to different
  verse images never batch into one Braze payload.

## Testing

- **Unit** (`verse-image.test.ts`): URL construction for square + 2:1; default
  fallback id; `assetFileTypeFromUrl` (jpg/png/gif/unknown→jpg).
- **Integration** (`payload-factory-image.test.ts`): push payload sets iOS
  `asset_url`+`asset_file_type` and Android `image_url`; single-URL fallback;
  no image when absent.
- **Regression** (`cron-verse-push-image.test.ts`): a verse arm with the
  sentinel attaches the per-verse image (assert the imageproxy URL contains the
  seeded `image_id`); a paired no-image arm attaches none; missing curated id →
  default image; a static-URL push variant passes its URL through.
- `bun run check` green before MR.

## Out of scope

- Dynamic (live-API) image selection at send time — curated map only for now.
- Per-language image variants (`language_tag` differences) — seed/lookup are
  English-keyed; revisit if localized art is needed.
- Email/in-app imagery — push channel only.
