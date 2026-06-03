# Dynamic Giving Handles — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Branch:** TBD (`feat/dynamic-giving-handles`)

## Goal

Let giving pushes carry a **per-user dynamic ask amount** that drives three coupled outputs from a single resolved amount:

1. **Body/title copy** — e.g. *"A gift of $25 a month will distribute over 600 Bible apps this year."*
2. **Impact number** — `bibles = askAmount × multiplier`, where the multiplier is an admin-configurable global setting (default **24**, i.e. `dollars × 24 = Bibles distributed`).
3. **Give deeplink** — `amount=<askAmount>` injected into the canonical give URL.

The multi-armed bandit "experiments with asking for different amounts" by treating each amount strategy as its own variant (= its own arm). No engine changes.

## Background / current state

- **Giving copy is fully static.** `MessageVariant.body`/`title` are plain strings (seeded from `docs/giving-push-library.json`). Existing copy hard-codes amounts and impact (e.g. *"When you give US$40, you help 200 people…"*).
- **No templating layer.** `PayloadFactory` (`src/lib/braze/payload-factory.ts`) sends `body`/`title`/`deeplink` to Braze as static strings.
- **Established per-user substitution pattern.** Verse pushes (`src/lib/verse-content.ts`) use a sentinel body + a strategy stored in `MessageVariant.subcategory`; the cron route (`src/app/api/cron/select-and-send/route.ts`) resolves real content per-user at send time, **upstream of `PayloadFactory`**. Dynamic giving handles follow this exact mold.
- **Settings** is a key/value store: `AppSetting` rows via `GET`/`POST /api/settings`. The POST upserts arbitrary keys (no whitelist), so a new key needs no route change.
- **Bandit arms = variants.** Thompson/Epsilon/LinUCB all key on `variantId`. Separate variants → separate arms/priors automatically.

## Approved decisions

- **Amount mechanism:** Separate `MessageVariant` per amount strategy (each is its own bandit arm). Mirrors the verse-strategy pattern; no engine changes.
- **Placeholder data source (now):** Stub resolver — read per-user giving attributes from `User.attributes` if present, else fall back to a default. Real Hightouch wiring lands later.
- **Category:** New `dynamic-handle` **subcategory under the existing `giving` category** (not a new top-level category).
- **Deeplink params:** `currency=usd`, `fund=YouVersion`, `frequency=monthly` are **hardcoded now** but exposed as optional builder parameters with defaults, so they can be made configurable later without a refactor. `utm_campaign=nexus-giving`.

## Architecture

A `dynamic-handle` variant declares an **amount strategy** (`avg-gift` | `recent-gift` | `max-gift` | `fixed`) stored in `MessageVariant.actionFeatures.givingHandleStrategy`. Its body/title contain placeholder tokens (`{{ask}}`, `{{bibles}}`).

Flow:

1. Wizard/edit creates one `dynamic-handle` variant per strategy under a giving message (each = its own arm).
2. Bandit selects a variant per user (existing machinery — unchanged).
3. **Cron send-time resolution** (new), in the per-user loop alongside the existing verse-push block:
   - If `variant.subcategory === "dynamic-handle"`:
     - read `strategy` from `actionFeatures.givingHandleStrategy` (default `"fixed"` when absent/invalid)
     - `ask = resolveAskAmount(user.attributes, strategy, DEFAULT_ASK_AMOUNT)`
     - `bibles = computeBibles(ask, multiplier)` where `multiplier` is read once per run from `AppSetting`
     - `body = substituteGivingPlaceholders(body, { ask, bibles })`; same for `title`
     - `deeplink = buildGivingDeeplink(ask)` (overrides any stored deeplink)
4. The filled copy + deeplink flow into the static `PayloadFactory` unchanged.

Because the multiplier and resolver fall back gracefully, a `dynamic-handle` variant with no placeholders/attrs/strategy still sends valid copy.

## Components / files

### NEW — `src/lib/giving-handles.ts` (pure, no I/O)

Engine-purity contract applies (no DB/IO). Exports:

```ts
export type GivingHandleStrategy = "avg-gift" | "recent-gift" | "max-gift" | "fixed";

export const DEFAULT_ASK_AMOUNT = 25;          // USD, integer
export const DEFAULT_DOLLARS_TO_BIBLES = 24;   // multiplier fallback

export function isGivingHandleStrategy(s: string | null | undefined): s is GivingHandleStrategy;

// Reads giving_avg_gift / giving_recent_gift / giving_max_gift from attributes.
// PLACEHOLDER keys — real Hightouch attribute names TBD. Returns a positive
// integer USD amount; falls back to `fallback` when the attr is missing,
// non-numeric, <= 0, or strategy === "fixed".
export function resolveAskAmount(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
  fallback: number,
): number;

// Math.round(ask * multiplier); guards non-finite/<=0 multiplier -> DEFAULT_DOLLARS_TO_BIBLES.
export function computeBibles(ask: number, multiplier: number): number;

// Replaces {{ask}} -> "$25" (formatted, with $ and thousands separators) and
// {{bibles}} -> "600" (formatted, thousands separators). Unknown tokens untouched.
export function substituteGivingPlaceholders(
  text: string,
  vals: { ask: number; bibles: number },
): string;

export type GivingDeeplinkOptions = {
  currency?: string;     // default "usd"
  fund?: string;         // default "YouVersion"
  frequency?: string;    // default "monthly"
  utmCampaign?: string;  // default "nexus-giving"
};

// https://www.bible.com/give?currency=usd&fund=YouVersion&frequency=monthly&amount=<ask>&utm_medium=push&utm_source=Push&utm_campaign=nexus-giving
// `amount` is the raw integer ask (no "$"). Params come from opts with the
// defaults above (hardcoded-but-overridable for future configurability).
export function buildGivingDeeplink(amountUsd: number, opts?: GivingDeeplinkOptions): string;

// Parse the AppSetting string -> finite positive number, else DEFAULT_DOLLARS_TO_BIBLES.
export function parseMultiplier(raw: string | null | undefined): number;
```

Placeholder attribute keys (stub — document as TBD):
- `avg-gift` → `giving_avg_gift`
- `recent-gift` → `giving_recent_gift`
- `max-gift` → `giving_max_gift`
- `fixed` → no attr; always returns `fallback`

### MODIFY — `src/lib/push-categories.ts`

Add a `dynamic-handle` subcategory to the `giving` category (canonical catalogue). It must flow through the derived exports (`PUSH_SUBCATEGORIES`, etc.) so it appears in the wizard/edit subcategory selectors and passes API validation.

### MODIFY — `src/app/settings/page.tsx`

New **"Agent Defaults"** card (placed near the other global-defaults cards). One numeric input: **"Dollars-to-Bibles multiplier"**, default shown as `24`, helper text e.g. *"$1 given = N Bible apps distributed. Applied to all dynamic giving pushes."*
- On mount, load `giving_dollars_to_bibles_multiplier` from `GET /api/settings`.
- Save via `POST /api/settings` with key `giving_dollars_to_bibles_multiplier`.
- Reuse the existing save/saved button pattern.

### MODIFY — `src/app/api/cron/select-and-send/route.ts`

- Read the multiplier once per run: `parseMultiplier(settingsMap["giving_dollars_to_bibles_multiplier"])`. (The route already loads settings / has access to `prisma.appSetting`; fetch alongside existing config reads.)
- In the per-user assembly loop, **after** the verse-push resolution block, add the `dynamic-handle` branch described in Architecture step 3. Per-user `attributes` are already available in this loop (used for quiet hours/timezone).

No change to `PayloadFactory` or the engine.

## Data model

No schema migration. Strategy lives in the existing `MessageVariant.actionFeatures` JSON (`givingHandleStrategy`). Multiplier lives in `AppSetting`.

## Error handling

- Blank/non-numeric multiplier → `DEFAULT_DOLLARS_TO_BIBLES` (24).
- Missing/invalid/≤0 giving attribute, or `strategy === "fixed"` → `DEFAULT_ASK_AMOUNT` (25).
- Unknown/invalid `givingHandleStrategy` → treat as `"fixed"`.
- `dynamic-handle` body with no placeholder tokens → passes through unchanged.
- Deeplink always built from the resolved integer amount (never `$`-formatted).

## Testing

- **Unit — `tests/unit/giving-handles.test.ts`:**
  - `resolveAskAmount` per strategy: reads each attr; falls back on missing/non-numeric/≤0; `fixed` always returns fallback.
  - `computeBibles`: `25 × 24 = 600`; guards bad multiplier.
  - `substituteGivingPlaceholders`: `{{ask}}` → `$25`, `{{bibles}}` → `600`; leaves unknown tokens; formats thousands.
  - `buildGivingDeeplink`: exact param string, `amount` injected raw, `utm_campaign=nexus-giving`; option overrides work.
  - `parseMultiplier`: numeric strings, blank, garbage, ≤0.
- **Regression — `tests/regression/giving-multiplier-setting.test.ts`:** `POST /api/settings` then `GET` round-trips `giving_dollars_to_bibles_multiplier`; assert the `ask × multiplier` math against the persisted value.
- **Integration — cron `dynamic-handle` substitution:** seed a user with a giving attribute + a `dynamic-handle` variant (strategy `avg-gift`); assert the resolved body contains the per-user `$amount`/`bibles` and the deeplink `amount=` matches the resolved ask. (If full cron exercise is impractical, cover the resolution via the extracted pure helpers + a focused route-level test.)

## Out of scope (future)

- Real Hightouch giving attributes (`giving_avg_gift`, etc.) — keys are placeholders now.
- Per-agent / per-variant override of `currency`/`fund`/`frequency` — builder params exist but no UI/setting yet.
- Wizard UI for picking the per-variant strategy beyond the existing `actionFeatures` mechanism — strategy defaults to `fixed` when unset.
