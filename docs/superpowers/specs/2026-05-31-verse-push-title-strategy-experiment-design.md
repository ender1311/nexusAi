# Verse-Push Title-Strategy Experiment

**Date:** 2026-05-31
**Status:** Draft — awaiting review
**Depends on:** push-localization pipeline (`feat/push-localization`, MR #260) — reuses `resolvePushLocale` and the cron localization path.

## Overview

Run a bandit experiment that converges to the best **title strategy** for a scripture push, not to a single best verse. The push body carries localized verse text and the title carries the verse reference (and variations on that theme); the specific verse rotates per recipient. The bandit's arms are the four title strategies, so it learns which *style* of verse push converts best while every user keeps receiving fresh, localized scripture.

This reuses the existing MessageVariant-based send pipeline (bandit selection, reward attribution, grouping, batching, Braze send, analytics) with **no changes to any of those systems**. Verse content is resolved at send time from the `CampaignContent` library — arms reference the pool, they never duplicate it (consistent with the 2026-05-13 decision to keep `CampaignContent` separate from `MessageVariant`).

## The Four Arms

One push `Message` under a new agent, with four `MessageVariant` arms. Each arm is a `(title-source, body-source)` pair over a rotating verse:

| Arm (`subcategory`) | Title source | Body source | Notes |
|---|---|---|---|
| `reference` | bare reference ("John 3:16") | verse text | |
| `headline-a` | `a-title` (clickbait) | verse text | e.g. "🌱 God is about to do something new…" |
| `headline-b` | `b-title` (reference sentence) | verse text | e.g. "Reflect on John 3:16 today." |
| `inverted` | verse text | bare reference | Title truncates on most devices (~30–50 chars); the bandit may learn it underperforms — that is a valid result to measure. |

The bandit converges to whichever `subcategory` wins per persona. The verse shown is presentation fill, rotated per user (below).

## Verse Pool & Rotation

**Pool:** the verses that have all required English content so any arm can render them. From production today: 93 distinct refs, **87 with `a-title` + `b-title` + `verse-text`** in English. The pool is the set of refs whose required content types all exist in English (`reference`, `a-title`, `b-title`, `verse-text` — see "Localized references" for how `reference` is sourced).

**Rotation (per user, deterministic, pure):**

```
index = hash(userId + runDateBucket) % pool.length
verse = pool[index]
```

- `runDateBucket` = the send's date (UTC `YYYY-MM-DD`, derived from the per-user `scheduledAt` already passed into grouping). Salting by date gives each user a different verse over time (avoids fatigue) while staying deterministic within a run.
- No shared state, no persisted cursor → the grouping function stays pure and batches cleanly.
- `hash` = a small stable string hash (FNV-1a) in the new `verse-content` lib.

## Send-Time Resolution

The per-user resolution hook is `groupDecisionsByVariant` in `src/lib/cron/send-grouping.ts`, which already resolves per-user content at send time (the `GIVING_LINK_SENTINEL` deeplink at line 63). Verse resolution follows the same pattern.

**Marking a verse variant (no schema migration):**
- `MessageVariant.body` = `VERSE_PUSH_SENTINEL` (a constant, e.g. `"__NEXUS_VERSE_PUSH__"`) flags "resolve verse content at send time."
- `MessageVariant.subcategory` holds the strategy code: `"reference" | "headline-a" | "headline-b" | "inverted"`.
- `MessageVariant.category` = `"verse-experiment"` (reporting label; the existing `[status, category, subcategory]` index already supports this).

**Strategy → sources map** (in `verse-content.ts`):

```ts
const VERSE_STRATEGY: Record<string, { title: VerseField; body: VerseField }> = {
  "reference":  { title: "reference",  body: "verse-text" },
  "headline-a": { title: "a-title",    body: "verse-text" },
  "headline-b": { title: "b-title",    body: "verse-text" },
  "inverted":   { title: "verse-text", body: "reference"  },
};
// VerseField = "reference" | "a-title" | "b-title" | "verse-text"
```

**Cron preload (once per run, batched — no N+1):** load the verse pool from `CampaignContent` (campaign `resurrection-push`, `status="active"`) and shape it as:

```ts
type VerseEntry = { usfm: string; byLang: Map<string, Partial<Record<VerseField, string>>> };
type VersePool = VerseEntry[]; // canonical order
```

Pass `{ pool, strategyByVariant: Map<variantId, strategy> }` into `groupDecisionsByVariant` alongside the existing `localization` context.

**Per-user resolution in grouping:** for a variant whose `body === VERSE_PUSH_SENTINEL`:
1. `verse = pool[hash(userId + dateBucket) % pool.length]`
2. `lang = normalizePushLocaleTag(user.attributes.language_tag)` → look up `verse.byLang.get(full) ?? get(primary) ?? get("en")` (reuse `resolvePushLocale`'s fallback rules).
3. `strat = VERSE_STRATEGY[strategy]`
4. `title = langEntry[strat.title] ?? enEntry[strat.title]`, `body = langEntry[strat.body] ?? enEntry[strat.body]` (English fallback per field — matches existing localization behavior).

The existing localized-copy grouping key already includes the resolved `title`/`body`, so users who land on the same verse + language + strategy batch together; different verses form separate Braze sends. No change to the grouping-key logic is required beyond feeding it the resolved verse copy.

## Localized References

The `reference` and `inverted` arms need the localized verse reference ("Juan 3:16", "ヨハネ 3:16"). Today only the **English** `usfmHuman` is stored. The YouVersion API returns a localized `response.data.verses[].reference.human` per version — see `src/lib/youversion/verse-api.ts`.

**Plan:**
- Extend `parseVerseText` (or add `parseVerseRef`) to also return `reference.human`.
- Re-run `scripts/fetch-localized-verses.ts` to upsert a **new `reference` contentType** row per verse per language into `CampaignContent` (no schema change — `contentType` is free-form text). `verse-text` covers 61 languages, so `reference` will cover the same set.
- Where a language has no `reference` row, the resolver falls back to the English reference.

`src/app/api/campaign-content/route.ts` `VALID_CONTENT_TYPES` must add `"reference"`.

## Coverage Caveat (flagged, not blocking)

- `verse-text`: 61 languages. `a-title` / `b-title`: 20 languages. `reference` (after re-fetch): up to 61.
- Users in the 41 languages with localized verse text but no localized `a-title`/`b-title` will see an English headline over a localized verse body on the `headline-a`/`headline-b` arms (standard English fallback). The `reference`/`inverted` arms cover all 61.
- Acceptable for a v1 experiment; revisit only if those arms win and we want fuller coverage.

## Agent / Message / Variant Creation

A generator script (`scripts/create-verse-experiment.ts`, dry-run by default like the other scripts) creates:
- One `Agent` "Resurrection Verse Push" — `status="draft"`, `localizePush=true`, `algorithm` default (thompson). Targeting/funnel-stage left at defaults for the user to set in the UI before activating.
- One push `Message` "Resurrection Verse" (`channel="push"`).
- Four `MessageVariant` arms as specified above (`body=VERSE_PUSH_SENTINEL`, `title` is a human label only — never sent for verse variants, since title is resolved from the pool; `category="verse-experiment"`, `subcategory=strategy`, `status="active"`). Optional `brazeVariantId` per arm if the user wants per-arm Braze attribution (can be set later).

The user activates the agent and sets targeting through the existing UI. No new UI is built in this iteration.

## Files

- **Create** `src/lib/verse-content.ts` — `VERSE_PUSH_SENTINEL`, `VerseField`, `VERSE_STRATEGY`, `hashToIndex(userId, dateBucket, len)`, `resolveVersePush(pool, lang, strategy)`. Pure, no I/O.
- **Create** `tests/unit/verse-content.test.ts` — strategy mapping, English fallback per field, deterministic rotation (same input → same index; date salt changes it), empty-pool guard.
- **Modify** `src/lib/cron/send-grouping.ts` — extend the content context with `{ versePool, strategyByVariant }`; in `groupDecisionsByVariant`, branch on `body === VERSE_PUSH_SENTINEL` to resolve verse copy before the existing grouping-key logic.
- **Modify** `src/app/api/cron/select-and-send/route.ts` — preload the verse pool + strategy map when the agent has verse variants; pass into both `groupDecisionsByVariant` call sites (lines ~879, ~1227).
- **Modify** `src/lib/youversion/verse-api.ts` + `tests/unit/youversion-verse-api.test.ts` — parse `reference.human`.
- **Modify** `scripts/fetch-localized-verses.ts` — upsert `reference` contentType rows.
- **Modify** `src/app/api/campaign-content/route.ts` — add `"reference"` to `VALID_CONTENT_TYPES`.
- **Create** `scripts/create-verse-experiment.ts` — generator (dry-run default, `--commit`).
- **Create** `tests/regression/verse-push-send-grouping.test.ts` — end-to-end grouping: a verse variant resolves localized copy per language/strategy and batches correctly.

## Out of Scope

- New UI for managing the experiment (use existing agent/message/push-library pages).
- Per-verse convergence or a verse-level sub-bandit (explicitly not wanted).
- Fuller `a-title`/`b-title` localization beyond the current 20 languages.
- Backwards-compat shims — `feat/push-localization` is unmerged; this builds on it directly.

## Testing

- Unit: `verse-content.ts` (rotation determinism, strategy mapping, fallback), `verse-api.ts` ref parsing.
- Regression: send-grouping resolves and batches verse variants across languages/strategies (links to this spec).
- `bun run check` before MR.
