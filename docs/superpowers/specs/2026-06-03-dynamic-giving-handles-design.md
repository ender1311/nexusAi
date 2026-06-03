# Dynamic Giving Handles — Design Spec

**Date:** 2026-06-03 (revised after codebase reconciliation)
**Status:** Approved — revised
**Branch:** `feat/dynamic-giving-handles`

## Goal

Let the bandit **experiment across different per-user ask amounts** on giving pushes, and render a personalized **impact statement** in the copy — *"A gift of $25 a month will distribute over 600 Bible apps this year"* — where the amount matches the give-link the user is sent to, and `bibles = amountUSD × multiplier` (multiplier is an admin-configurable global setting, default **24**).

## What already exists (reconciliation)

A per-user giving amount + deeplink are **already built, tested, and wired**:

- **`src/lib/engine/giving-link.ts`** (pure):
  - Real Hightouch attributes: `gift_amount_average`, `gift_amount_most_recent`, `gift_amount_maximum`, `gift_count_lifetime`, `gift_count_past_3_to_36_months`, `gift_currency_most_recent`.
  - `selectGiftAmountUSD(attrs)` — deterministic anchor blend (`0.6·avg + 0.3·recent + 0.1·max`, ×1.1 upsell, lapsed ×0.75, capped at 1.5×max, snapped to `USD_AMOUNT_LADDER`, min 5). First-time giver (no `gift_count_lifetime`) → 10.
  - Currency machinery: `CURRENCY_RATES`, `usdAmount`, `buildCurrencyLadder`, `snapToLadder`.
  - `buildGivingDeeplink(attrs)` — give URL (`currency`, `fund=YouVersion`, `frequency=monthly`, `amount`, `utm_medium=push`, `utm_source=Nexus`, `utm_campaign=optimize_handle`). Currency-aware amount.
- **`src/lib/cron/send-grouping.ts:66`** — a variant whose **deeplink** is `GIVING_LINK_SENTINEL` (`{{giving_link}}`) gets `buildGivingDeeplink(attrs)` resolved per-user (and groups split by resolved URL).
- Tests: `tests/unit/giving-link.test.ts` (incl. `utm_campaign=optimize_handle` assertion at line 214), `tests/integration/giving-conversion.test.ts`.

**Gap vs. the request:** only the *deeplink* is personalized today. The message *body* is static, there is no impact ("Bibles distributed") number, no configurable multiplier, no amount **experimentation** (the amount is one deterministic blend), and no `dynamic-handle` category.

## Approved decisions (this session)

1. **Amount experimentation = separate variant per strategy** (each amount strategy is its own bandit arm — arms are keyed on `variantId`, so no engine change). Strategies: `avg-gift`, `recent-gift`, `max-gift`, `blend` (blend = existing `selectGiftAmountUSD`, preserving current behavior).
2. **Body amount matches the link** — copy shows the same localized currency/amount the give-link uses ("handles correspond to the links").
3. **`utm_campaign` → `nexus-giving`** (replaces `optimize_handle`; update `buildGivingDeeplink` + its unit test). Applies to all giving-link sends.
4. **Multiplier** is a global `AppSetting` (`giving_dollars_to_bibles_multiplier`, default `24`), edited in a new Settings card; `bibles = round(amountUSD × multiplier)` (USD-based, since the relationship is dollars×24).
5. **`dynamic-handle`** = new subcategory under the `giving` category.

## Architecture

A **dynamic-handle variant** is a `MessageVariant` with `subcategory = "dynamic-handle"` and an amount strategy in `actionFeatures.givingHandleStrategy`. Its `body`/`title` carry `{{ask}}` / `{{bibles}}` placeholders; its `deeplink` is `{{giving_link}}` (or empty — dynamic-handle overrides it). Each strategy is a distinct variant = a distinct arm, so the existing Thompson/Epsilon/LinUCB selection "experiments with asking for different amounts" with no engine change.

At send time, inside the existing pure `groupDecisionsByVariant` (`send-grouping.ts`):
- If the variant is a dynamic-handle (strategy present):
  1. `{ amountLocal, currencyCode, amountUsd } = resolveLocalGiftAmount(attrs, strategy)`
  2. `amountDisplay = formatGiftAmount(amountLocal, currencyCode)`
  3. `bibles = computeBibles(amountUsd, multiplier)`
  4. `body = substituteGivingCopy(meta.body, { amountDisplay, bibles })`; same for `title`
  5. `deeplink = buildGivingDeeplink(attrs, strategy)` (overrides)
  6. group is copy-keyed (per-user copy), like verse arms
- Else: existing verse / `GIVING_LINK_SENTINEL` / localized / static branches unchanged.

The multiplier is read once per cron run from `AppSetting` and threaded into `groupDecisionsByVariant`.

## File structure

- **`src/lib/engine/giving-link.ts`** (MODIFY, pure) — strategy-aware amount + shared local-amount/currency resolver; `utm_campaign` change.
- **`src/lib/engine/giving-copy.ts`** (NEW, pure) — multiplier parse, bibles math, placeholder substitution. Imports nothing DB.
- **`src/lib/cron/send-grouping.ts`** (MODIFY) — dynamic-handle branch; `VariantMeta` + context additions.
- **`src/app/api/cron/select-and-send/route.ts`** (MODIFY) — read multiplier; populate `givingHandleStrategy` into `variantMeta`; pass multiplier into both `groupDecisionsByVariant` call sites.
- **`src/lib/push-categories.ts`** (MODIFY) — add `dynamic-handle` subcategory to `giving`.
- **`src/app/settings/page.tsx`** (MODIFY) — "Agent Defaults" card with the multiplier.
- Tests: `tests/unit/giving-link.test.ts` (MODIFY), `tests/unit/giving-copy.test.ts` (NEW), `tests/unit/cron-send-grouping.test.ts` (MODIFY), `tests/regression/giving-multiplier-setting.test.ts` (NEW).

## Interfaces

```ts
// giving-link.ts (additions)
export type GivingHandleStrategy = "avg-gift" | "recent-gift" | "max-gift" | "blend";
export function isGivingHandleStrategy(s: unknown): s is GivingHandleStrategy;

// Strategy-aware USD ask. "blend" === selectGiftAmountUSD (unchanged). Single-anchor
// strategies use that anchor (max-gift halves it) through the shared pipeline; if the
// strategy's anchor attr is absent, fall back to selectGiftAmountUSD.
export function selectGiftAmountUSDByStrategy(attrs: Record<string, unknown>, strategy: GivingHandleStrategy): number;

// Shared by copy + deeplink so they always match. Mirrors buildGivingDeeplink's
// currency resolution: USD ask → local currency via ladder snap.
export function resolveLocalGiftAmount(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
): { amountLocal: number; currencyCode: string; amountUsd: number };

// Intl currency format, 0 fraction digits: (25,"USD")->"$25", (20,"EUR")->"€20".
export function formatGiftAmount(amountLocal: number, currencyCode: string): string;

// strategy defaults to "blend" so existing call sites are unchanged.
export function buildGivingDeeplink(attrs: Record<string, unknown>, strategy?: GivingHandleStrategy): string;

// giving-copy.ts
export const DEFAULT_DOLLARS_TO_BIBLES = 24;
export function parseMultiplier(raw: string | null | undefined): number;        // finite >0 else 24
export function computeBibles(amountUsd: number, multiplier: number): number;     // round(usd*mult), guarded
export function substituteGivingCopy(text: string, vals: { amountDisplay: string; bibles: number }): string; // {{ask}},{{bibles}}
```

`buildGivingDeeplink` and `resolveLocalGiftAmount` share the existing currency-resolution logic (extract a private helper so they cannot drift).

## Error handling

- Blank/non-numeric multiplier → `DEFAULT_DOLLARS_TO_BIBLES` (24).
- Strategy anchor attr missing → fall back to `selectGiftAmountUSD` (never fails to produce an amount).
- Invalid `givingHandleStrategy` → treat as `"blend"`.
- `formatGiftAmount` with unknown currency → Intl throws on bad codes; pre-validate against `CURRENCY_RATES` and fall back to `"USD"` (the give-link already does this).
- Body with no placeholders → passes through unchanged.

## Testing

- **`giving-link.test.ts`** (modify): change `optimize_handle`→`nexus-giving`; `selectGiftAmountUSDByStrategy` per strategy (avg/recent/max/blend, + anchor-missing fallback); `resolveLocalGiftAmount` (USD + one foreign); `formatGiftAmount` ($/€); `buildGivingDeeplink(attrs,"recent-gift")` amount differs from blend when histories differ.
- **`giving-copy.test.ts`** (new): `computeBibles` (`25×24=600`, guards); `parseMultiplier` (numeric/blank/garbage/≤0); `substituteGivingCopy` (`{{ask}}`/`{{bibles}}`, thousands formatting, unknown tokens untouched).
- **`cron-send-grouping.test.ts`** (modify): a `dynamic-handle` variant (strategy `recent-gift`) substitutes per-user `amountDisplay`/`bibles` into body+title, sets a strategy-aware deeplink, and splits groups by resolved copy.
- **`giving-multiplier-setting.test.ts`** (new regression): `POST`/`GET /api/settings` round-trips `giving_dollars_to_bibles_multiplier`; assert `amountUsd × persisted multiplier` math.

## Out of scope (future)

- Wizard UI for assigning a per-variant strategy (stored in `actionFeatures` now; strategy variants created via existing variant flows; defaults to `blend`).
- Per-agent / per-variant override of `currency`/`fund`/`frequency`.
- Real attributes are already live — no placeholder keys remain.
