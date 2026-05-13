# Verse-Specific Push Library

**Date:** 2026-05-13
**Status:** Approved

## Overview

Import verse-specific push content from the 2026 Resurrection Push Dropbox campaign into a dedicated `CampaignContent` table, and extend the `/push-library` page with language switching, a read-only table view with USFM references, gap detection, and a UI for adding/editing translations.

## Data Model

New Prisma model in `schema.prisma`:

```prisma
model CampaignContent {
  id            String   @id @default(cuid())
  campaign      String              // "resurrection-push", "advent-2026", etc.
  contentType   String              // "a-title" | "b-title" | "verse-text"
  language      String              // ISO: "en", "de", "zh_CN", etc.
  usfmReference String              // "ISA.43.18+ISA.43.19"
  usfmHuman     String?             // "Isaiah 43:18-19" — computed on import, editable
  title         String?             // populated for a-title and b-title rows
  body          String?             // populated for verse-text rows
  status        String  @default("active")  // "active" | "archived"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([campaign, contentType, language, usfmReference])
  @@index([campaign, language, contentType])
}
```

**Row counts:** Resurrection Push = 20 languages × 90 USFM refs × 3 content types = 5,400 rows.

**Content types:**
- `a-title` — clickbait-style push title (e.g. "🌱 God is about to do something new…")
- `b-title` — verse-reference-style push title (e.g. "Reflect on Isaiah 43:18-19 today.")
- `verse-text` — the actual Bible verse body text

**Why not `MessageVariant`:** `MessageVariant` is an agent experiment arm with bandit statistics, Braze variant IDs, and frequency cap fields. The "Push Copy Library" already reuses it as a hack; adding language and USFM fields would make it a god table. `CampaignContent` is a clean, purpose-built model that scales to future campaigns by changing the `campaign` string.

## USFM Reference Mapping

A pure TypeScript utility `src/lib/usfm.ts` converts USFM codes to human-readable strings:

- `ISA.43.18+ISA.43.19` → `Isaiah 43:18-19`
- `2CO.4.16` → `2 Corinthians 4:16`
- `PSA.8.3+PSA.8.4` → `Psalm 8:3-4`

Algorithm:
1. Split on `+` to get each verse part
2. For each part, split on `.` → `[bookCode, chapter, verse]`
3. Look up bookCode in a static map (all 66 canonical books)
4. If all parts share the same book + chapter, collapse to `Book C:V1-V2`
5. If cross-chapter (rare), expand to `Book C1:V1–C2:V2`

The book code map is a static object in `src/lib/usfm.ts` — no external dependency needed. The file also exports a `BOOK_ORDER: Record<string, number>` map (1–66) used for sorting table rows in canonical Bible order. 88 of 90 resurrection push USFM refs already appear in the VOTD data (verified during exploration); the remaining 2 (`PHP.1.6`, `PSA.134.10`) map cleanly with the static table.

## Import Pipeline

**Script:** `scripts/seed-resurrection-push.ts`

**Source:** `<dropbox>/2026 Resurrection Push/push/Syntax Fixed/`
- `sourceA/2026-Q1-resurrection-Atitle-{lang}.yml` → `a-title`
- `sourceB/2026-Q1-resurrection-Bmessage-{lang}.yml` → `verse-text`
- `sourceC/2026-Q1-resurrection-Btitle-{lang}.yml` → `b-title`

**YAML structure:** `USFM_reference: "text content"` — one entry per verse.

**Process:**
1. For each source folder, enumerate YAML files by language code (suffix before `.yml`)
2. Parse YAML (using `js-yaml`)
3. For each `(usfmReference, text)` pair:
   - Compute `usfmHuman` via the USFM utility
   - Upsert into `CampaignContent` using `createMany` with `skipDuplicates: true`
4. Log gap summary per language on completion

**Re-runnable:** The `@@unique` constraint ensures upserts are safe. Re-running adds any missing rows without duplicating existing ones.

**Running:**
```bash
bun scripts/seed-resurrection-push.ts
```

The script reads the Dropbox path directly from the filesystem (no env var needed — path is deterministic on the developer's machine). If the path is missing, the script exits with a clear error.

## API Routes

All routes live under `src/app/api/campaign-content/`.

### `GET /api/campaign-content`
Query params: `campaign` (required), `language` (optional, defaults to all).
Returns all active rows for that campaign, optionally filtered by language.
Response: `{ data: CampaignContentRow[] }`.

### `POST /api/campaign-content`
Auth required. Creates one row.
Body: `{ campaign, contentType, language, usfmReference, usfmHuman?, title?, body? }`.
Validates: all required string fields present, contentType is one of the three valid values, `title` or `body` must be non-empty depending on contentType.
Returns `{ data: row }` with 201.

### `PATCH /api/campaign-content/[id]`
Auth required. Partial update — accepts any subset of `{ title, body, usfmHuman, status }`.
Returns updated row.

### `DELETE /api/campaign-content/[id]`
Auth required. Sets `status = "archived"` (soft delete).
Returns `{ data: { id } }`.

## UI — `/push-library` Page

The current redirect (`src/app/push-library/page.tsx`) is replaced with a real Server Component. The existing `/messages` page (generic template library) is unchanged.

### Page structure

```
Header: "Verse Push Library" | campaign selector (dropdown, initially just "Resurrection Push")
─────────────────────────────────────────────────────────
Language tabs: [en ✓90] [de ⚠82] [es ✓90] [fr ✓90] ... [+ Add Language]
─────────────────────────────────────────────────────────
[Table]
USFM Ref       | A-Title                      | B-Title              | Verse Text          | Actions
Isaiah 43:18-19| 🌱 God is about to do...     | Reflect on Isaiah... | Forget the former...| Edit
2 Cor 4:16     | ✊ Never give up!             | Hear more about...   | Therefore we do...  | Edit
Psalm 27:4     | ☝️ If you could only...      | —                    | —                   | Edit  ← gap
─────────────────────────────────────────────────────────
[Gap Panel — collapsible, shown when active language has gaps]
⚠ 8 missing entries for "de"
Isaiah 43:18-19  A-Title missing  [Add]
Psalm 27:4       B-Title missing  [Add]
...
```

### Language tabs
- Computed server-side: query distinct languages for the campaign, count rows per language
- Canonical count derived from `en` (the "full" language): tab shows `✓ N` if language is complete, `⚠ M` if gaps exist
- `+ Add Language` button opens a drawer

### Table
- One display row per USFM ref (server groups the 3 DB rows per ref into one object)
- Empty cell (rendered as `—`) = gap for that content type in the active language
- `Edit` button opens a modal with 3 text fields (A-Title, B-Title, Verse Text); each field is only saved if non-empty
- Sorted by USFM book order (canonical Bible order, not alphabetical)
- Authenticated users see Edit; unauthenticated users see read-only table

### Gap panel
- Collapsible `<details>` section below the table, open by default when gaps exist
- For each gap, shows: USFM human ref | missing content type | English text (grayed out, as reference) | `Add` button
- `Add` button pre-fills the USFM and content type in the edit modal

### Add Language drawer
- Input for ISO language code (e.g. `pt-BR`)
- On submit, shows the full 90-row table with English text alongside empty fields
- User fills in translations inline; "Save" sends individual POST requests per non-empty row
- Partial saves are fine — incomplete languages show as gaps

### Edit modal
- 3 labeled text areas: A-Title, B-Title, Verse Text
- Each independently saveable (PATCH to respective row IDs, or POST if row doesn't exist yet)
- Shows USFM human ref + the English version of each field below as reference text

## File Changes Summary

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `CampaignContent` model |
| `prisma/migrations/...` | Auto-generated migration |
| `src/lib/usfm.ts` | New: USFM → human-readable utility |
| `scripts/seed-resurrection-push.ts` | New: import script |
| `src/app/api/campaign-content/route.ts` | New: GET + POST |
| `src/app/api/campaign-content/[id]/route.ts` | New: PATCH + DELETE |
| `src/app/push-library/page.tsx` | Replace redirect with Server Component |
| `src/components/push-library/verse-library-client.tsx` | New: language tabs, table, gap panel |
| `src/components/push-library/edit-content-modal.tsx` | New: edit/add modal |
| `src/components/push-library/add-language-drawer.tsx` | New: add-language drawer |
| `tests/unit/usfm.test.ts` | New: USFM utility unit tests |
| `tests/integration/campaign-content.test.ts` | New: API integration tests |

## Testing

- **Unit:** `usfm.ts` — test all 66 book codes, multi-verse same chapter, cross-chapter, malformed input
- **Integration:** All 4 API routes — auth guard on mutations, 400 on invalid contentType, 404 on unknown ID, gap computation correctness
- **No UI automation** — table/gap logic is server-computed and testable at the API level

## Out of Scope

- YAML file upload via UI (Approach B) — seed script is sufficient for now
- Campaign metadata page (name, dates, description) — the `campaign` string field is enough until there are 2+ campaigns to manage
- Per-language Braze campaign integration — that's a separate workflow
- 2025 Resurrection Push historical data — can be added later by re-running the script against the `2025/pushq1/raw_data/` folder with a `campaign = "resurrection-push-2025"` argument
