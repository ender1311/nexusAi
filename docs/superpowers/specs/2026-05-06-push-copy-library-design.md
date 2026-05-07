# Push Copy Template Library Design

## Overview

Replace the manual "Add Push Message" form with a template-only picker backed by a curated library of 200+ pre-approved push variants. Operators pick a destination (category + sub-goal), preview approved title/body combinations, and select the arms they want the agent to test. No free-form copy entry in the agent message dialog.

Send timing (`preferredHour`, `preferredDayOfWeek`) is **not configurable per template**. The agent computes the optimal send time per user from their app-usage behavioral data (`recommendedSendHour` from `decideForUser`). These fields are removed from the template creation flow entirely.

---

## Categories & Sub-Goals

Five categories map to the five content destinations in the YouVersion Bible app:

| Category | Sub-goals | Key Deeplinks |
|---|---|---|
| **reader** | open-bible, specific-verse, audio-bible, bible-search | `youversion://bible`, `https://www.bible.com/bible/{version_id}/{USFM}` |
| **plans** | find-plans, my-plans, saved-plans, specific-plan, plan-collection | `https://www.bible.com/reading-plans`, `https://www.bible.com/my-plans`, `https://www.bible.com/saved_plans`, `https://www.bible.com/reading-plans/{PLAN_ID}`, `https://www.bible.com/reading-plans-collection/{COLLECTION_ID}` |
| **votd** | votd-page, votd-image | `https://www.bible.com/verse-of-the-day` |
| **guided-scripture** | todays-story, specific-story | `https://www.bible.com/stories`, `https://www.bible.com/stories/{STORY_ID}` |
| **guided-prayer** | prayer-list, prayer-add, guided-prayer | `https://www.bible.com/prayer`, `https://www.bible.com/prayers/add`, `https://www.bible.com/guides/1` |

---

## Data Model Changes

### 1. New `Deeplink` table

Catalog of all relevant YouVersion deeplinks — seeded from the wayfinder inventory (`/Users/danluk/repos/wayfinder/src/lib/data/deeplink-inventory-data.ts`). Scoped to the 5 categories above (~30 entries).

```prisma
model Deeplink {
  id          String   @id @default(cuid())
  wayfinderId String   @unique          // matches DeeplinkEntry.id in wayfinder
  category    String                    // reader | plans | votd | guided-scripture | guided-prayer
  subcategory String                    // find-plans | my-plans | open-bible | votd-page | etc.
  label       String                    // "Find Plans", "Bible Reader", "Verse of the Day"
  description String?
  urlTemplate String                    // URL with {PARAM} placeholders
  example     String?                   // concrete resolved example URL
  sortOrder   Int      @default(0)
}
```

No foreign key from `MessageVariant.deeplink` to this table — variants store the resolved URL string. The catalog is for display labels and the sub-goal filter UI.

### 2. Updated `MessageVariant` — add `subcategory`

```prisma
  category         String?   // reader | plans | votd | guided-scripture | guided-prayer
  subcategory      String?   // find-plans | my-plans | open-bible | votd-page | etc.
  sourceTemplateId String?   // clone → template FK (existing)
```

`preferredHour` and `preferredDayOfWeek` remain in the schema (used historically) but are **not shown in the template picker UI** and not set on seeded templates. The cron uses `recommendedSendHour` from `decideForUser` for per-user optimal timing.

### 3. Category rename

Existing 9 template variants in the `__push-copy-library__` agent use old category names (`bible-verse`, `general`). The new seed script replaces them entirely with the 5 new category names. Old variants are deleted and re-seeded.

---

## Template Library Seed

**Source:** 127+ Dropbox campaign push files at:
`/Users/danluk/Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint/Clint McManaman's files/Shared/YouVersionTeam/Communications/Campaigns/`

**Target:** ≥ 200 variants across 5 categories (≥ 35 per category).

**Seed script:** `scripts/seed-push-copy-templates.ts` (full rewrite)

Each template variant has:
- `name` — descriptive label (e.g., "2024-03 Lent Day 1")
- `title` — English push title (clean text, no Liquid syntax)
- `body` — English push body (clean text, no Liquid syntax)
- `deeplink` — resolved URL for the sub-goal
- `category` — one of 5
- `subcategory` — one of the sub-goals within that category
- `status: "active"`
- No `preferredHour`, `preferredDayOfWeek`, `brazeVariantId`

Script is idempotent: upserts by `(agentId, name)` — safe to re-run.

**Extraction rule for Dropbox files:**
- Read `push/liquid_title.html` and `push/liquid_message.html`
- Take the English content (first `{% if ... contains 'en' %}` block, or raw text if no Liquid)
- Map campaign theme to category:
  - "Bible Plans", "Reading Plans", "My Plans" → **plans**
  - "Verse of the Day", "VOTD" → **votd**
  - "Guided Scripture", "Stories", "Story" → **guided-scripture**
  - "Prayer", "Guided Prayer" → **guided-prayer**
  - "Bible", "Read", "Scripture", "Word of God" (general reading) → **reader**
- Map deeplink from `push/liquid_link.html` (English URL)

---

## "Add Push Message" Dialog UX

### Replace: manual form (`PushVariantForm` entries)
### With: two-step template picker

**Step 1 — Destination picker:**
```
Category tabs:  [ Reader ] [ Plans ] [ VOTD ] [ Guided Scripture ] [ Guided Prayer ]

Sub-goal pills (updates based on selected tab):
Plans: [ Find Plans ] [ My Plans ] [ Saved Plans ] [ Specific Plan ] [ Plan Collection ]
```

Selecting a category + sub-goal filters the variant cards below.

**Step 2 — Variant selector:**
- Grid of push notification preview cards (title + body + deeplink label)
- Click to select/deselect — multi-select (these become the A/B/C arms)
- Selected variants highlighted with a checkmark and ring
- Selection count shown: "3 variants selected"

**Message name:**
- Auto-suggested: `{CategoryLabel} — {SubGoalLabel}` (e.g., "Plans — My Plans")
- Editable text field above the picker

**Save action:**
- Creates `Message` record + `MessageVariant` records cloned from templates
- Each clone has `sourceTemplateId` pointing to the template variant
- `preferredHour`/`preferredDayOfWeek` not set (null)

### Component: `TemplatePicker`

New component at `src/components/agents/template-picker.tsx`:
- Props: `agentId`, `onSaved` callback
- Internal state: `selectedCategory`, `selectedSubcategory`, `selectedVariantIds`, `messageName`
- Fetches: `GET /api/variants?category={cat}&subcategory={subcat}`
- Saves via existing: `POST /api/agents/{agentId}/messages` with variant array including `sourceTemplateId`

### API change: `GET /api/variants`

Add `?subcategory=` filter (alongside existing `?category=`):
```
GET /api/variants?category=plans&subcategory=my-plans
```

---

## Files Changed

| Action | Path | Change |
|---|---|---|
| Create | `prisma/migrations/.../migration.sql` | Add `Deeplink` table + `subcategory` on `MessageVariant` |
| Modify | `prisma/schema.prisma` | Add `Deeplink` model + `subcategory` field |
| Modify | `scripts/seed-push-copy-templates.ts` | Full rewrite — 200+ variants, 5 categories, deeplink catalog seed |
| Create | `scripts/seed-deeplink-catalog.ts` | Seed `Deeplink` table from wayfinder inventory |
| Modify | `src/app/api/variants/route.ts` | Add `?subcategory=` filter + include `subcategory` in response |
| Create | `src/components/agents/template-picker.tsx` | New two-step template picker component |
| Modify | `src/components/agents/agent-message-manager.tsx` | Replace `PushVariantForm` dialog with `TemplatePicker` |
| Create | `tests/integration/variants-subcategory.test.ts` | Tests for subcategory filter |

---

## What Is NOT Changed

- `MessageVariant.preferredHour` / `preferredDayOfWeek` — columns stay, just not set from templates
- `PATCH /api/variants/[id]` template sync — unchanged
- `GET /api/cron/sync-template-variants` — unchanged
- Agent wizard's existing `PushVariantPicker` — unchanged (wizard uses category-only filtering; subcategory filtering is for the message dialog)
- All existing test infrastructure

---

## Testing

- Unit: none needed (template picker is pure UI with no business logic)
- Integration: `GET /api/variants?subcategory=` filter — 3 tests
- Integration: seed script idempotency verified manually
- Manual E2E: open any agent → Messages tab → Add Push Message → pick Plans → My Plans → select 3 variants → verify message created with correct `sourceTemplateId` on each clone
