# Push Localization — Design

**Date:** 2026-05-30
**Status:** Approved (design); implementation pending
**Author:** Dan Luk + Claude

## Problem

Nexus push sends are English-only. The cron (`/api/cron/select-and-send`) picks an English
`MessageVariant` via the bandit, then **filters recipients** down to `language_tag` starting
with `"en"` (route.ts:649-662) — non-English and missing-`language_tag` users are excluded from
push entirely. ~25%+ of the user base is non-English (es, pt, fr, id largest).

Today, localization is done **outside Nexus**: the comms team authors per-language files in
Dropbox and hand-assembles a Braze `{% case language %}` Liquid switch
(`combined/liquid_*.html`). That is effectively the "one campaign per language" approach the
operator wants to retire.

## Goal

Each English push variant carries a set of localized strings. The cron picks the right
localized string per recipient's `language_tag`, falling back to English. No per-language
agents. Easy for a non-technical operator to orchestrate: **upload a folder** of translation
JSON in the Nexus UI. Existing English pushes in the DB library get their translations
**backfilled** from the 2025/2026 Dropbox corpus. The UI surfaces language coverage so the
operator can still choose English and see how many languages a push supports.

## Source of truth: Dropbox corpus

Path root:
`~/Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint/Clint McManaman’s files/Shared/YouVersionTeam/Communications/Campaigns/{2025,2026}/`

**Canonical ingest unit = a folder = one push.** Each push folder (e.g. `.../2026-01 Daily
reward-remind/push/remind/push1/`) contains one file per language:

```
2026-01-daily-remind-PUSH-1-en.json
2026-01-daily-remind-PUSH-1-es.json
2026-01-daily-remind-PUSH-1-pt.json
2026-01-daily-remind-PUSH-1-zh_TW.json   ... (~20-40 languages)
```

File shape:

```json
{
  "push_title": "Build your Bible habit!",
  "push_message_personal": "${NAME}, take a moment to spend time in God’s Word today.",
  "push_message_non_personal": "take a moment to spend time in God’s Word today.",
  "push_deeplink": "https://www.bible.com/today?..."
}
```

- Filename pattern: `<stem>-<lang>.json` (also `.yml` for older verse campaigns; see Backfill).
- `<stem>` is the stable push key shared across all languages (`2026-01-daily-remind-PUSH-1`).
- The `-en` file is the canonical anchor.
- Corpus breadth (2025+2026): ~1,857 English files; 800-1,100 files each for es, pt, fr, de,
  vi, zh_CN, zh_TW, uk, ru, ko, it, tl, id, nl, ro, pl, th, ja; long tail of 40+ langs
  (ar, zh_HK, fi, bg, be, tr, sk, no, my, hr, es_ES, el, ta, ca, lv, yo, sn, hi, ht, my_MM, …).

### Mapping a file to our model

| JSON key | Maps to | Note |
|---|---|---|
| `push_title` | `MessageVariantTranslation.title` | |
| `push_message_non_personal` | `MessageVariantTranslation.body` | **default** — tokenless; Nexus sends `alert`/`title` as plain strings (no Liquid layer), so `${NAME}` would be sent literally |
| `push_message_personal` | (stored optional) | retained for future personalization wiring; not sent today |
| `push_deeplink` | (ignored for translation) | language-independent; lives on `MessageVariant.deeplink` |

English text lives on `MessageVariant.body/title` and is the source of truth — **no `en`
translation row is created.** The bandit keeps selecting among English variants unchanged.

## Data model

```prisma
model Agent {
  // ...
  localizePush  Boolean @default(false)   // opt-in; OFF = today's EN-only behavior
}

model MessageVariantTranslation {          // NEW
  id                String   @id @default(cuid())
  messageVariantId  String
  language          String                 // canonical code: es, pt, fr, zh_CN, zh_TW, ...
  title             String?
  body              String
  bodyPersonal      String?                // push_message_personal, future use
  status            String   @default("active")
  source            String?                // "import:dropbox" | "upload" | "manual"
  sourceFile        String?                // provenance for audit / re-import
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  variant MessageVariant @relation(fields: [messageVariantId], references: [id], onDelete: Cascade)

  @@unique([messageVariantId, language])
  @@index([messageVariantId, status])
}
```

`MessageVariant` gains the back-relation `translations MessageVariantTranslation[]`.

**Migration applied to BOTH prod and test DB** (per CLAUDE.md: prisma migrate hits prod via
`.env.local`; test DB updated via `ALTER TABLE` over the Neon HTTP client with the test
`DATABASE_URL`).

## Send-path change (`select-and-send`)

No change to bandit selection or reward logic. Two changes:

1. **Targeting (route.ts:649-662).** When `agent.localizePush === true`, the push agent does
   **not** force `effectiveAgentLang = "en"` and does **not** exclude missing-`language_tag`
   users — it sends to all channel-eligible recipients (English fallback guarantees everyone
   gets copy). When `false`, behavior is byte-for-byte identical to today.

2. **Localization at payload build.** After a variant is chosen for a user, resolve
   `(variantId, recipient language_tag)` → localized `title/body`; fall back to the English
   variant when absent. Localized strings flow into `PayloadFactory` push `alert`/`title`
   (payload-factory.ts:72-82). Translations for the page's variants are loaded once per cron
   page (batch `findMany` keyed by `variantId`), not per user (avoids N+1).

### Language resolution — `src/lib/push-locale.ts` (pure, unit-tested)

```
resolvePushLocale(tag, translationsByLang, englishVariant) -> { title, body }
```

1. Normalize recipient `language_tag`: trim; canonicalize script case (`zh_tw`→`zh_TW`,
   `zh_cn`→`zh_CN`, `zh_hk`→`zh_HK`); lowercase the primary subtag.
2. Exact match on full tag (`es_ES`, `zh_TW`).
3. Base subtag match (`es_es`→`es`, `pt_pt`→`pt`, `fr_ca`→`fr`).
4. English fallback (always available from the variant).

`zh_CN` / `zh_TW` / `zh_HK` are kept distinct — never collapsed to a bare `zh`. A bare `zh`
recipient tag with no exact row falls through to English (logged), since picking a script
arbitrarily is wrong.

## The importer — `src/lib/push-import/` (pure parse + grouping, unit-tested)

One importer powers both UI upload and backfill.

**Input:** a flat list of `{ relativePath, contents }` for `*.json` (and `*.yml`) files.

**Algorithm:**
1. For each file, parse `<stem>` and `<lang>` from the filename suffix.
2. Group files by `<stem>` → one logical push per stem, with a `{ lang → {title, body, bodyPersonal} }` map.
3. Resolve each stem to a target `MessageVariant`:
   - **Primary:** match `<stem>` against `MessageVariant.actionFeatures.sourceFile`
     (strip the `-en.json` suffix from sourceFile to get its stem).
   - Report stems with no match as **unmatched** (operator decides: skip, or create new).
4. Produce an **import plan**: per stem → matched variant (or unmatched), per-language
   create/update/no-op, and a diff when the incoming English text differs from the variant's
   current English (`--refresh-english` flag, default OFF, controls whether to overwrite).
5. **Commit:** upsert `MessageVariantTranslation` rows by `(messageVariantId, language)`.

The parse/group/plan stages are pure and unit-tested against fixtures copied from the real
Dropbox files. Only the commit stage touches the DB.

## UI

### Folder upload (operator self-serve)

- `<input type="file" webkitdirectory>` — operator picks a push folder (e.g. `push1/`) **or** a
  parent folder (e.g. `remind/`, which holds `push1..push16`). The browser submits every file
  with its relative path; the importer groups by stem, so single-push and many-push folders
  both work.
- POST to `src/app/api/push-translations/import` (multipart). Route runs the importer in
  **dry-run** first and returns the plan; the UI shows matched/unmatched pushes and per-language
  add/update counts; operator confirms → second call commits. `requireAdmin()` gates the mutation.
- Response contract per API CLAUDE.md: `{ data }` / `{ error }`, validate before DB, no Prisma
  leakage.

### Visibility

- Push library / variant views show a **language-coverage badge** ("EN + 18 languages") and a
  per-push coverage breakdown (which languages present, which missing vs. the English anchor) —
  reuses the gap-detection pattern already built for `/push-library`.
- Operator can still select/send the English push; localization is additive and opt-in via the
  agent's `localizePush` toggle.

## Backfill (run once after migration; re-runnable)

Script `scripts/import-push-translations.ts` walks the 2025/2026 Campaigns tree, feeds all
`<stem>-<lang>.{json,yml}` files through the **same importer**, and:

- Runs in `--dry-run` by default, printing a verification report: # stems found, # matched to
  variants, # unmatched (with names), per-language coverage counts, and English-divergence
  diffs.
- Writes only with `--commit`. Idempotent via the `(messageVariantId, language)` unique key.
- Production-DB safety: dry-run report is reviewed by a human before `--commit`; the script
  performs no deletes.

Verse campaigns (e.g. Resurrection) use `.yml` keyed by USFM refs and a different folder shape;
the importer's filename parser handles the `-<lang>.yml` suffix, and USFM-keyed multi-verse
files are expanded to one logical push per key. Overlap with the existing `CampaignContent`
verse library is acceptable — `CampaignContent` stays the browse library; `MessageVariantTranslation`
is the send-path home.

## Testing

- **Unit** (`tests/unit/`): `push-locale.ts` resolution (exact / base subtag / zh scripts /
  fallback / malformed tag); importer parse+group+plan against real-file fixtures (json + yml,
  matched + unmatched, English-divergence).
- **Integration** (`tests/integration/`): `push-translations/import` endpoint (dry-run plan
  shape, commit upserts, auth, bad payload → 400) using `tests/helpers/builders.ts`.
- **Regression** (`tests/regression/`): cron localizes per `language_tag` and falls back to
  English; `localizePush=false` agent is unchanged (still EN-only, still excludes non-en).

## Out of scope

- Auto-translation / translation APIs (translations come from the comms team via Dropbox).
- Email/SMS localization (push only; email has no default language gate today and 0 email sends).
- Dropbox API auto-sync (operator uploads folders manually in the UI).
- Personalization (`${NAME}`) wiring at the Nexus send layer (`bodyPersonal` is stored for later).
```