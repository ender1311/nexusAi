# Comprehensive Deeplink System — Design

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan
**Author:** Dan Luk (with Claude)

## Goal

Give Nexus agents a complete, structured deeplink capability:

1. A **bulk per-agent override** ("link all variants to this URL") plus a **per-variant editor** — both mechanisms available.
2. The **full YouVersion deeplink inventory** (all 54 entries from wayfinder) with a param-driven URL builder.
3. A **DB-backed plan/collection metadata store**, seeded from the YouVersion APIs and from local Dropbox campaign exports, so agents can link to specific reading plans and collections and reuse existing localized push copy.

Delivered in **three independently-shippable phases**.

## Decisions (locked during brainstorming)

| Fork | Choice |
|------|--------|
| Bulk override mechanism | **Both** — agent-level override field + per-variant editor |
| Inventory / plan-collection data source | **Copy into Nexus, maintain locally** (static module + Prisma tables + offline seed/import scripts; no runtime dependency on wayfinder) |
| Rollout | **Phased**, each phase ships independently |
| Dropbox collection push-copy | **In scope** — import from the local Dropbox export |

## Background: how links flow today

- `MessageVariant.deeplink` (a nullable string) is the only link field. It is passed **verbatim** to Braze as `custom_uri` (`src/lib/braze/payload-factory.ts:83,92`) for both Android and Apple. Braze accepts both `youversion://…` app-scheme deeplinks and `https://…` web URLs.
- The variant's deeplink is resolved at send time in `src/lib/decide.ts:301` (`deeplink: selected.deeplink ?? null`).
- The resolved deeplink is part of the send-grouping key (`src/lib/cron/send-grouping.ts`); a special `GIVING_LINK_SENTINEL` already exists for per-user giving URLs.
- Verse-specific deeplinks are built by `src/lib/push-deeplinks.ts` (`buildSpecificVerseDeeplink`, `resolveSpecificVerseDeeplink`, etc.).
- The current picker is `src/components/agents/deeplink-select.tsx`, sourced from `YOUVERSION_DEEPLINKS` in `src/lib/constants/youversion.ts`, with a free-text "Custom URL…" option.
- **There is today no agent-level override and no structured/param-driven link builder.**

### Content-mismatch hazard (must be surfaced, not silently allowed)

If a push quotes a specific verse (e.g. Isaiah 41:10) but the link points to a generic destination (e.g. `https://www.bible.com/verse-of-the-day`), the tap opens **today's** verse-of-the-day, not the quoted verse. The UI must warn when a verse-quoting agent is given a generic override.

## Source material (reference, copied — not depended on at runtime)

From `../wayfinder`:
- `src/lib/data/deeplink-inventory-data.ts` — `DEEPLINK_INVENTORY`: 54 entries across 12 categories (Scripture, Reading Plans, Prayer, Stories & Guided Scripture, Giving, Social & Community, Content & Discovery, Organizations & Churches, Settings & Account, BAFK, BAL, Transactional/Automation). Each entry: `id, category, label, description, urlTemplate, scheme, sources, requiredParams[], optionalParams[], channelVariants?, verification, warning?, notes?, isReferenceOnly?`. Param types: `text | usfm | numeric | select`.
- `src/lib/utils/url-builder.ts` — `normalizePlaceholderName`, `extractPlaceholders`, `substitutePlaceholders`, `appendQuery`, `appendQueryAny`, `buildResolvedUrl` (handles `{X}` and `{{X}}` tokens, `opt_`-prefixed optional query params, optional UTM).
- `src/lib/services/youversion-transforms.ts` — `LANGUAGE_MAP`, `buildPlanUrl`, `extractPublisher`, `extractDays`, `mapLanguageTag`.
- `src/lib/server/plan-collections.ts` — Postgres `plan_collections` (plan_id, set_id, title) + `cache_plans_by_language` (set_id, language_tag, plans jsonb, cached_at); YV seeding via `collections/view.json` + `collections/items.json` with headers `Referer`, `X-YouVersion-Client: youversion`, `X-YouVersion-App-Platform: internal`, `X-YouVersion-App-Version: 1`.
- `src/lib/data/collections.ts` — 31 static `COLLECTION_PRESETS` (id, slug, title, category).

From `../alfred/plans_info`: plans API fetch + parse (`view.json?id={plan_id}`), copyright/publisher extraction.

bible.com URL formats:
- Reader: `https://www.bible.com/bible/{version_id}/{USFM}`
- Plan: `https://www.bible.com/reading-plans/{PLAN_ID}` (+ `/day/{DAY}`, `?subscribe=true`, `?add_to_queue=true`)
- Plan collection: `https://www.bible.com/reading-plans-collection/{COLLECTION_ID}` (unique per language)
- Find plans: `https://www.bible.com/reading-plans` · My plans: `https://www.bible.com/my-plans` · Saved: `https://www.bible.com/saved_plans`
- VOTD: `https://www.bible.com/verse-of-the-day` (⚠️ Broken on Android — BA-7285)

### Dropbox export structure

Base: `/Users/danluk/Library/CloudStorage/Dropbox-Life.Church/Ion/Interactive/Design/Clint/Clint McManaman’s files/Shared/YouVersionTeam/Communications/Campaigns/`
(note the curly apostrophe `’` U+2019 in the path; treat read-only).

- **Collection→plan mapping** — `Campaigns/plans/{slug}/`:
  - `set_id.txt` — `collection title: …`, `set id: …`, cassi URL.
  - `collection_id_by_lang.txt` — `lang: collection_id` lines.
  - `collection_id_url.txt` — `lang: https://www.bible.com/reading-plans-collection/{id}` lines.
  - `top_rated/top_rated_target_plan_ids_fixed_4.html` (also `fixed_12`, `top20`) — JSON-**fragment** bodies: `"{lang}": ["planId", …],` lines (must be wrapped in `{…}` before `JSON.parse`).
  - `plan_ids/` — plan IDs by language.
- **Push copy** — `Campaigns/{year}/{campaign}/push/{campaign}-PUSH-{lang}.json`:
  - `{ "push_title": "…", "push_message": "…" }`. IAM copy lives in `in-app message/` with a parallel shape.

## Architecture

### Phase 1 — Bulk override + curated link picker

**Schema**
- Add `Agent.deeplinkOverride String?`.
- Migration: idempotent DDL (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) applied to prod + test, then `prisma migrate resolve --applied` to reconcile history. **Never** run `migrate dev` against the test DB.

**Resolution precedence** (send path, `src/lib/decide.ts`):
```
effectiveDeeplink = agent.deeplinkOverride ?? variant.deeplink ?? null
```
- When an override is set, all variants collapse to one deeplink → fewer send-grouping keys / fewer Braze payload groups.
- The override must flow into `send-grouping.ts` so grouping reflects the effective link, not the per-variant link.

**Curated picker**
- Expand `YOUVERSION_DEEPLINKS` with the plans set: Find Plans, My Plans, Specific Plan, Plan Day, Plan Collection, Saved Plans, plus a VOTD **web** entry. Keep the existing "Custom URL…" option.

**UI**
- Agent wizard (`src/components/agents/agent-wizard.tsx`) and the edit sheet get a "Link all variants to…" field reusing `DeeplinkSelect`. The per-variant editor remains.
- Warn in the UI when a verse-quoting agent is given a generic override (content-mismatch hazard).

**Tests**
- Regression: precedence (`override ?? variant ?? null`); grouping collapse when override set; warning trigger.
- Carry over the VOTD "Broken on Android" warning string.

### Phase 2 — Full inventory + param-driven builder

**Ported modules (local, no runtime wayfinder dependency)**
- `src/lib/constants/deeplink-inventory.ts` — `DEEPLINK_INVENTORY` (all 54 entries) + types (`DeeplinkEntry`, `DeeplinkParam`, `ParamType`, `VerificationStatus`, `Channel`, `DEEPLINK_CATEGORIES`).
- `src/lib/deeplinks/url-builder.ts` — `normalizePlaceholderName`, `extractPlaceholders`, `substitutePlaceholders`, `appendQuery`, `appendQueryAny`, `buildResolvedUrl`. Pure functions only (no component logic, per CLAUDE.md). UTM optional/omittable.

**UI: DeeplinkBuilder**
- Flow: category → entry → typed param form (text / usfm / numeric / select) → **live resolved-URL preview** → writes to `variant.deeplink` or `agent.deeplinkOverride`.
- Surfaces `verification` status and `warning`/`notes`. `isReferenceOnly` entries are display-only (cannot be selected as a live link).
- Augments (not necessarily replaces) `DeeplinkSelect`; the curated quick-pick from Phase 1 stays for common cases.

**Tests**
- Port wayfinder's `url-builder` unit tests (placeholder extraction/substitution, `appendQueryAny`, `buildResolvedUrl` with `opt_` params).
- Inventory-integrity test: unique ids, every `urlTemplate` placeholder has a matching param, categories ⊆ `DEEPLINK_CATEGORIES`.

### Phase 3 — Plan/collection DB + Dropbox content import

**Prisma models**
- `ReadingPlan` — `planId` (PK), `title`, `languageTag`, `totalDays`, `publisher`, timestamps.
- `PlanCollection` — `setId` (PK), `slug`, `title`, `category`.
- `CollectionLanguageId` — (`setId`, `languageTag`) unique → `collectionId`, `url`.
- `CollectionPlan` — (`setId`, `languageTag`, `planId`) → `rank` (top-rated ordering).
- `CampaignPushCopy` — (`campaign`, `channel`, `languageTag`) unique → `title`, `message`, `sourcePath`. (Mirrors the existing `CampaignPushCopy` notion in memory; reconcile with any existing model before adding.)

**Import / seed scripts** (offline, direct Prisma — same exemption as cron/ingest; read-only against Dropbox; never against the test DB)
- `seed-collections.ts` — YV `collections/view.json` + `collections/items.json` (ported wayfinder seeding) + the 31 `COLLECTION_PRESETS`; also fetch plan metadata via `view.json?id={plan_id}`.
- `import-dropbox-campaigns.ts` — parse `plans/{slug}/` (`set_id.txt`, `collection_id_by_lang.txt`, `top_rated/*.html` JSON-fragment files) into `PlanCollection` / `CollectionLanguageId` / `CollectionPlan`; parse `{year}/{campaign}/push/*.json` into `CampaignPushCopy`. The `top_rated/*.html` parser must wrap fragment bodies in `{…}` before `JSON.parse`.

**UI**
- Collection picker sourced from the DB (per-language collection IDs → correct localized `reading-plans-collection/{id}` URL).
- When composing a plan/collection agent, surface matching `CampaignPushCopy` as copy suggestions.

**Tests**
- Integration: new tables CRUD + shape.
- Regression: import parser field names + exact SQL column names for any raw queries (per CLAUDE.md raw-SQL rule).

## Cross-cutting

- The bulk-override mutation is a **user-facing** change → goes through the app→`apps/api` HTTP proxy (preserve backend `ApiError` status/message; map timeouts to 504).
- Import/seed scripts stay **direct-Prisma** (offline jobs).
- Each phase is independently shippable and testable; ship in order 1 → 2 → 3.
- Solo repo: push/merge straight to `main` is fine; run `bun run check` before pushing non-trivial work.

## Out of scope

- Email/IAM channel link builders beyond what the inventory already encodes (push is the focus; inventory `channelVariants` are carried but not separately UI-driven in this pass).
- A shared cross-repo package (explicitly rejected in favor of local copy).
- Automated continuous re-sync from Dropbox (import is run on demand).
