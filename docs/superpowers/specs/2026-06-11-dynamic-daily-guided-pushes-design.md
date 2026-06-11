# Dynamic Daily Guided Scripture / Guided Prayer Pushes — Design

**Date:** 2026-06-11
**Status:** Approved by Dan (this session)

## Problem

Guided Scripture and Guided Prayer content rotates daily and is tied to the
current day's Verse of the Day (VOTD). Static push copy in the library cannot
reference "today's verse." We need push variants whose title/body resolve
per-user, per-day, per-language at send time — without enumerating 365 days of
copy in the push library.

## Decisions (clarified with Dan)

1. **Guided Prayer = same 3 VOTD permutations** as Guided Scripture, only the
   label string and deeplink differ (`https://www.bible.com/guides/1` vs
   `https://www.bible.com/stories`).
2. **Timezone fallback:** missing `TrackedUser.timezone` → `America/Chicago`.
3. **Label localization:** translate the two label strings for all ~70
   languages in alfred's language→Bible-version map; fallback exact →
   primary subtag → English.
4. **Storage model:** liquid-style tags stored literally as the variant copy
   (`{{votd_reference}}` etc.). What the picker shows is what's in the DB.
5. **Verse image:** today's VOTD image, localized per language, from the
   YouVersion prerendered images API.
6. **Image option is per-variant** (each permutation seeded with and without
   image → 6 library options per category).

## Architecture

```
Variant copy (liquid tags)
        │  cron: select-and-send → groupDecisionsByVariant
        ▼
detect {{votd_*}} / {{guided_*}} tags
        │  per user: localDate(timezone ?? America/Chicago), languageTag
        ▼
getVotdContent(date, languageTag)  ──cache miss──▶  YouVersion APIs
        │   (VotdDailyContent table, immutable)      votd.json → verse.json → images.json
        ▼
substitute tags + attach image URLs (if subcategory votd-dynamic-image)
        ▼
buildPushPayload (existing apple_push/android_push image fields)
```

## 1. Data model (additive only)

```prisma
model VotdDailyContent {
  id              String   @id @default(cuid())
  date            String   // "YYYY-MM-DD" — user-local calendar date
  languageTag     String   // normalized push locale, e.g. "en", "es", "pt"
  usfm            String   // e.g. "JHN.3.16"
  reference       String   // localized human reference, e.g. "Juan 3:16"
  verseText       String
  versionId       Int      // Bible version id used for this language
  imageUrlIos     String?  // rendered 320x320
  imageUrlAndroid String?  // rendered 1024x512
  createdAt       DateTime @default(now())

  @@unique([date, languageTag])
}
```

- Applied with `npx prisma db execute --stdin` (additive DDL). **Never**
  `prisma migrate dev` / `db push` (prisma.config.ts loads .env.local =
  production DB; drift forces a reset prompt — never accept).
- Rows are immutable once written: a given day's VOTD never changes.

## 2. VOTD content service — `src/lib/votd/`

### `version-map.ts`
Language→Bible-version map ported from
`../alfred/votd/braze_connected_content/03_get_verse_text.yml` (lines 42–182):
~70 entries (en→111 NIV, en_GB→113, es→149, fr→133, de→73, zh_CN→48, …),
fallback `111`. Pure data + `versionForLanguage(tag): number`.

### `labels.ts`
Static translations of the two label strings:

```ts
type GuidedLabels = { guidedScripture: string; guidedPrayer: string };
const LABELS: Record<string, GuidedLabels> // keyed by language tag, ~70 langs
function guidedLabels(tag: string): GuidedLabels // exact → primary subtag → en
```

English values: "Today's Guided Scripture" / "Today's Guided Prayer".

### `votd-content.ts`

```ts
async function getVotdContent(date: string, languageTag: string): Promise<VotdContent | null>
```

1. DB lookup `(date, languageTag)` → return on hit.
2. Miss:
   - Fetch `https://moments.youversionapi.com/3.1/votd.json?type=standard&language_tag=en`
     (365-entry list `{day, usfm[], image_id}`; memoized per process).
     Required headers: `Referer: http://yvapi.youversionapi.com`,
     `X-YouVersion-Client: youversion`, `X-YouVersion-App-Platform: internal`,
     `X-YouVersion-App-Version: 1`.
   - Pick entry by day-of-year computed from `date` (handles leap years; day
     1–366).
   - Fetch verse text:
     `https://bible.youversionapi.com/3.1/verse.json?id={versionId}&reference={usfm}`
     → `{content, reference.human}`.
   - Fetch localized prerendered image:
     `https://images.youversionapi.com/3.2/items.json?usfm[]={usfm}&language_tag={tag}&category=prerendered`
     → `urls.regular` template with `{w}x{h}` placeholders, rendered at
     320×320 (iOS) and 1024×512 (Android). Image failure is non-fatal
     (nullable columns) — text-only sends still work.
   - Upsert the row (`@@unique` makes concurrent misses safe), return it.
3. Any text-path failure → return `null` (caller skips the user; never send
   raw tags).

### `local-date.ts`

```ts
function userLocalDate(timezone: string | null | undefined, now?: Date): string
```

`Intl.DateTimeFormat("en-CA", { timeZone: timezone ?? "America/Chicago", ... })`
→ `"YYYY-MM-DD"`. Invalid timezone strings fall back to America/Chicago.
A single cron run spans up to 3 calendar dates worldwide; the
`(date, language)` cache key absorbs that.

## 3. Liquid tags + seeded library variants

Tags (exact strings, substituted by search/replace like `substituteGivingCopy`):

| Tag | Resolves to |
|---|---|
| `{{guided_scripture_label}}` | localized "Today's Guided Scripture" |
| `{{guided_prayer_label}}` | localized "Today's Guided Prayer" |
| `{{votd_reference}}` | localized human reference, e.g. "John 3:16" |
| `{{votd_text}}` | localized verse text |

Seeded variants (extend `scripts/seed-push-copy-templates.ts`), 6 per category:

**Guided Scripture** (deeplink `https://www.bible.com/stories`):

| Title | Body | Subcategory |
|---|---|---|
| `{{guided_scripture_label}}` | `{{votd_reference}}` | `votd-dynamic` / `votd-dynamic-image` |
| `{{guided_scripture_label}}` | `{{votd_text}}` | `votd-dynamic` / `votd-dynamic-image` |
| `{{votd_reference}}` | `{{guided_scripture_label}}` | `votd-dynamic` / `votd-dynamic-image` |

**Guided Prayer** (deeplink `https://www.bible.com/guides/1`): same three
permutations with `{{guided_prayer_label}}`.

- Subcategory `votd-dynamic-image` marks the image-attaching twin (mirrors the
  existing `isVerseStrategy(subcategory)` convention).
- Picker (`push-variant-picker.tsx`) shows the literal tag copy; image
  variants get a "+ today's verse image" hint line. No per-day enumeration.

## 4. Send-time resolution (`send-grouping.ts`)

New hook alongside the existing verse-sentinel resolution in
`groupDecisionsByVariant`:

1. `hasVotdTags(title, body)` → dynamic path.
2. Per user: `date = userLocalDate(trackedUser.timezone)`,
   `lang` via existing push-locale resolution
   (`attributes.language_tag` + `normalizePushLocaleTag`, honoring
   `Agent.localizePush`).
3. `getVotdContent(date, lang)`; on `null` → **skip user, log**
   (counted in run summary; never send unresolved tags).
4. Substitute all four tags in title and body.
5. If subcategory is `votd-dynamic-image` and image URLs are present:
   set `asset_url`/`asset_file_type: "png"` (apple_push) and `image_url`
   (android_push) via the existing `buildPushPayload` fields.
6. Grouping is already per-variant (image flag is inherent to the variant);
   the per-user resolution key must additionally include `(date, lang)` so
   users on different local dates/languages don't share one rendered payload —
   same mechanism the existing per-user verse/locale resolution uses.

Localization note: tag substitution localizes the *content*; the
`MessageVariantTranslation` table is not needed for these variants because the
stored copy is language-neutral tags.

## 5. Testing

- **Unit** (`tests/unit/`): tag substitution (all 4 tags, title+body),
  `userLocalDate` (Chicago fallback, invalid tz, date-line cases),
  day-of-year picking (leap year), `guidedLabels` fallback chain,
  `versionForLanguage` fallback.
- **Integration** (`tests/integration/`): `getVotdContent` with mocked fetch +
  test DB (cache hit, miss→write, image failure→nullable, text failure→null);
  send-grouping end-to-end with dynamic variants (substitution, skip-on-null,
  image attachment, grouping key separation).
- **Live QA / confirmation** (explicitly requested): test-send via
  `/api/demo/send` to test users — English and one non-English user, with and
  without image — verified on device before any agent adopts the variants.

## Out of scope

- Guided Prayer-specific content API (none exists; per decision 1, prayer
  pushes use the VOTD permutations).
- Per-day pre-warming cron (lazy fetch + immutable cache is sufficient; can be
  added later if first-send latency matters).
- Liquid templating beyond exact-string tag substitution (no filters/logic).
