# Dynamic Giving Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bandit experiment across per-user giving ask amounts and render a personalized impact statement ("A gift of $25 a month will distribute over 600 Bible apps this year") whose amount matches the per-user give-link.

**Architecture:** Build on the existing pure `giving-link.ts` (per-user amount + deeplink already live). Add strategy-aware amount selection (`avg-gift` / `recent-gift` / `max-gift` / `blend`), a new pure `giving-copy.ts` for placeholder substitution + bibles math, a `dynamic-handle` subcategory, and a send-time branch in `send-grouping.ts` that resolves copy + deeplink per user. A global `AppSetting` (`giving_dollars_to_bibles_multiplier`, default 24) is read once per cron run and threaded into grouping. Each amount strategy is a distinct `MessageVariant` = a distinct bandit arm, so no engine change.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma v7 + Postgres, bun:test, shadcn/ui, Tailwind v4.

---

## File Structure

- `src/lib/engine/giving-link.ts` (MODIFY, pure) — strategy types, `selectGiftAmountUSDByStrategy`, shared ask pipeline, `resolveLocalGiftAmount`, `formatGiftAmount`, strategy-aware `buildGivingDeeplink`, `utm_campaign` → `nexus-giving`.
- `src/lib/engine/giving-copy.ts` (NEW, pure) — `DEFAULT_DOLLARS_TO_BIBLES`, `parseMultiplier`, `computeBibles`, `substituteGivingCopy`.
- `src/lib/cron/send-grouping.ts` (MODIFY) — `givingHandleStrategy` on `VariantMeta`, `givingMultiplier` param, dynamic-handle branch.
- `src/app/api/cron/select-and-send/route.ts` (MODIFY) — read multiplier once per run, populate `givingHandleStrategy` into `variantMeta`, pass multiplier into both `groupDecisionsByVariant` call sites.
- `src/lib/push-categories.ts` (MODIFY) — add `dynamic-handle` subcategory under `giving`.
- `src/app/settings/page.tsx` (MODIFY) — "Agent Defaults" card with the multiplier.
- Tests: `tests/unit/giving-link.test.ts` (MODIFY), `tests/unit/giving-copy.test.ts` (NEW), `tests/unit/cron-send-grouping.test.ts` (MODIFY), `tests/regression/giving-multiplier-setting.test.ts` (NEW).

---

## Task 1: Strategy-aware amounts + currency resolver in giving-link.ts

Refactors `selectGiftAmountUSD` onto a shared pipeline (regression-safe — `blend` keeps identical behavior), adds strategy selection, a shared local-amount/currency resolver used by both copy and deeplink, an Intl currency formatter, and changes `utm_campaign`.

**Files:**
- Modify: `src/lib/engine/giving-link.ts`
- Test: `tests/unit/giving-link.test.ts`

- [ ] **Step 1: Write failing tests for the new exports**

Add this block to `tests/unit/giving-link.test.ts` (append inside the file, after existing imports add the new names):

```ts
import {
  selectGiftAmountUSDByStrategy,
  resolveLocalGiftAmount,
  formatGiftAmount,
  isGivingHandleStrategy,
  buildGivingDeeplink,
  selectGiftAmountUSD,
} from "@/lib/engine/giving-link";

describe("isGivingHandleStrategy", () => {
  it("accepts the four known strategies", () => {
    for (const s of ["avg-gift", "recent-gift", "max-gift", "blend"]) {
      expect(isGivingHandleStrategy(s)).toBe(true);
    }
  });
  it("rejects unknown values", () => {
    expect(isGivingHandleStrategy("fixed")).toBe(false);
    expect(isGivingHandleStrategy(null)).toBe(false);
    expect(isGivingHandleStrategy(42)).toBe(false);
  });
});

describe("selectGiftAmountUSDByStrategy", () => {
  const histories = {
    gift_count_lifetime: 8,
    gift_count_past_3_to_36_months: 4,
    gift_amount_average: 40,
    gift_amount_most_recent: 100,
    gift_amount_maximum: 200,
  };

  it("blend equals selectGiftAmountUSD", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "blend")).toBe(selectGiftAmountUSD(histories));
  });

  it("recent-gift differs from blend when recent is far from the blend", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "recent-gift"))
      .not.toBe(selectGiftAmountUSDByStrategy(histories, "avg-gift"));
  });

  it("avg-gift anchors on gift_amount_average (40 * 1.1 → snaps to 50)", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "avg-gift")).toBe(50);
  });

  it("max-gift halves the max anchor (200 * 0.5 * 1.1 = 110 → snaps to 150)", () => {
    expect(selectGiftAmountUSDByStrategy(histories, "max-gift")).toBe(150);
  });

  it("falls back to blend when the strategy anchor attr is absent", () => {
    const noRecent = { gift_count_lifetime: 3, gift_count_past_3_to_36_months: 2, gift_amount_average: 30 };
    expect(selectGiftAmountUSDByStrategy(noRecent, "recent-gift")).toBe(selectGiftAmountUSD(noRecent));
  });
});

describe("resolveLocalGiftAmount", () => {
  it("USD: amountLocal equals amountUsd", () => {
    const r = resolveLocalGiftAmount({ gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_average: 40 }, "avg-gift");
    expect(r.currencyCode).toBe("USD");
    expect(r.amountLocal).toBe(r.amountUsd);
  });

  it("foreign currency: amountLocal is the converted snapped value", () => {
    const r = resolveLocalGiftAmount(
      { gift_currency_most_recent: "EUR", gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_average: 40 },
      "avg-gift",
    );
    expect(r.currencyCode).toBe("EUR");
    expect(r.amountLocal).toBeGreaterThan(0);
  });

  it("unknown currency falls back to USD", () => {
    const r = resolveLocalGiftAmount({ gift_currency_most_recent: "XYZ" }, "blend");
    expect(r.currencyCode).toBe("USD");
  });
});

describe("formatGiftAmount", () => {
  it("formats USD with no fraction digits", () => {
    expect(formatGiftAmount(25, "USD")).toBe("$25");
  });
  it("formats EUR", () => {
    expect(formatGiftAmount(20, "EUR")).toBe("€20");
  });
  it("unknown currency falls back to USD formatting", () => {
    expect(formatGiftAmount(25, "XYZ")).toBe("$25");
  });
});

describe("buildGivingDeeplink with strategy", () => {
  it("recent-gift amount can differ from blend when histories diverge", () => {
    const attrs = {
      gift_count_lifetime: 8,
      gift_count_past_3_to_36_months: 4,
      gift_amount_average: 40,
      gift_amount_most_recent: 200,
      gift_amount_maximum: 250,
    };
    const blend = buildGivingDeeplink(attrs);
    const recent = buildGivingDeeplink(attrs, "recent-gift");
    expect(recent).not.toBe(blend);
  });
});
```

Also change the existing utm assertion at line ~214 from `optimize_handle` to `nexus-giving`:

```ts
    expect(url).toContain("utm_campaign=nexus-giving");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/giving-link.test.ts`
Expected: FAIL — `selectGiftAmountUSDByStrategy`/`resolveLocalGiftAmount`/`formatGiftAmount`/`isGivingHandleStrategy` are not exported; utm assertion fails on `optimize_handle`.

- [ ] **Step 3: Refactor `selectGiftAmountUSD` onto a shared pipeline and add the new exports**

In `src/lib/engine/giving-link.ts`, replace the existing `selectGiftAmountUSD` function (lines ~126-183) with the following, and add the strategy + resolver + formatter exports. Keep all existing helpers (`extractPositiveNumber`, `snapDownToLadder`, `snapToLadder`, `buildCurrencyLadder`, `CURRENCY_RATES`) unchanged.

```ts
export type GivingHandleStrategy = "avg-gift" | "recent-gift" | "max-gift" | "blend";

export function isGivingHandleStrategy(s: unknown): s is GivingHandleStrategy {
  return s === "avg-gift" || s === "recent-gift" || s === "max-gift" || s === "blend";
}

/**
 * Shared ask pipeline: upsell ×1.1, lapsed ×0.75, cap at 1.5× historical max,
 * snap to USD ladder with a floor of 5. Used by every amount strategy so they
 * cannot drift. `anchor` is the pre-upsell USD anchor for the strategy.
 */
function applyAskPipeline(anchor: number, attrs: Record<string, unknown>): number {
  const max = extractPositiveNumber(attrs, "gift_amount_maximum");
  const lifetimeCount = extractPositiveNumber(attrs, "gift_count_lifetime");
  const recentCount = extractPositiveNumber(attrs, "gift_count_past_3_to_36_months");

  // lifetimeCount present but recentCount absent → lapsed giver
  const isLapsed = lifetimeCount !== null && recentCount === null;

  let amount = anchor * 1.1;
  if (isLapsed) amount = amount * 0.75;

  if (max !== null) {
    const cap = max * 1.5;
    if (amount > cap) {
      if (cap < USD_AMOUNT_LADDER[0]) return USD_AMOUNT_LADDER[0];
      return snapDownToLadder(cap, USD_AMOUNT_LADDER);
    }
  }
  return snapToLadder(Math.max(amount, USD_AMOUNT_LADDER[0]), USD_AMOUNT_LADDER);
}

/**
 * Compute a personalized ask amount in USD based on user gift history.
 * Anchor blend formula: 0.6 * avg + 0.3 * recent + 0.1 * max (when all three present).
 * First-time givers (no lifetime count) get a fixed $10.
 */
export function selectGiftAmountUSD(attrs: Record<string, unknown>): number {
  const lifetimeCount = extractPositiveNumber(attrs, "gift_count_lifetime");

  // First-time givers: no gift history at all
  if (lifetimeCount === null) {
    return snapToLadder(10, USD_AMOUNT_LADDER);
  }

  const avg = extractPositiveNumber(attrs, "gift_amount_average");
  const recent = extractPositiveNumber(attrs, "gift_amount_most_recent");
  const max = extractPositiveNumber(attrs, "gift_amount_maximum");

  let anchor: number;
  if (avg !== null && recent !== null && max !== null) {
    anchor = 0.6 * avg + 0.3 * recent + 0.1 * max;
  } else if (avg !== null) {
    anchor = avg;
  } else if (recent !== null) {
    anchor = recent;
  } else if (max !== null) {
    // Max is a ceiling signal; use 50% to avoid over-asking
    anchor = max * 0.5;
  } else {
    anchor = 10;
  }

  return applyAskPipeline(anchor, attrs);
}

/**
 * Strategy-aware USD ask. "blend" === selectGiftAmountUSD (unchanged behavior).
 * Single-anchor strategies anchor on their attribute (max-gift halves it) through
 * the shared pipeline; if the strategy's anchor attr is absent, fall back to blend
 * so an amount is always produced.
 */
export function selectGiftAmountUSDByStrategy(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
): number {
  if (strategy === "blend") return selectGiftAmountUSD(attrs);

  const anchorKey =
    strategy === "avg-gift" ? "gift_amount_average"
    : strategy === "recent-gift" ? "gift_amount_most_recent"
    : "gift_amount_maximum";

  const anchor = extractPositiveNumber(attrs, anchorKey);
  if (anchor === null) return selectGiftAmountUSD(attrs);

  // max-gift halves its anchor (a ceiling signal), mirroring blend's max-only branch
  const rawAnchor = strategy === "max-gift" ? anchor * 0.5 : anchor;
  return applyAskPipeline(rawAnchor, attrs);
}

/** Resolve gift_currency_most_recent to a known currency code, defaulting to USD. */
function resolveCurrencyCode(attrs: Record<string, unknown>): string {
  const raw = attrs["gift_currency_most_recent"];
  const code =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim().toUpperCase() : "USD";
  return CURRENCY_RATES[code] !== undefined ? code : "USD";
}

/**
 * Shared by copy + deeplink so they always match. USD ask → local currency via
 * ladder snap. Returns the local ask, the resolved currency, and the USD ask
 * (USD is what the bibles math uses).
 */
export function resolveLocalGiftAmount(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy,
): { amountLocal: number; currencyCode: string; amountUsd: number } {
  const currencyCode = resolveCurrencyCode(attrs);
  const amountUsd = selectGiftAmountUSDByStrategy(attrs, strategy);

  let amountLocal: number;
  if (currencyCode === "USD") {
    amountLocal = amountUsd;
  } else {
    const localLadder = buildCurrencyLadder(currencyCode);
    const rate = CURRENCY_RATES[currencyCode];
    amountLocal = snapToLadder(amountUsd * rate, localLadder);
  }
  return { amountLocal, currencyCode, amountUsd };
}

/**
 * Intl currency format, 0 fraction digits: (25,"USD")→"$25", (20,"EUR")→"€20".
 * Unknown currency codes fall back to USD (Intl throws on bad ISO codes).
 */
export function formatGiftAmount(amountLocal: number, currencyCode: string): string {
  const code = CURRENCY_RATES[currencyCode] !== undefined ? currencyCode : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(amountLocal);
}
```

- [ ] **Step 4: Rewrite `buildGivingDeeplink` to take a strategy and share the resolver**

Replace the existing `buildGivingDeeplink` (lines ~185-225) with:

```ts
/**
 * Build a personalized giving deeplink. strategy defaults to "blend" so existing
 * call sites are unchanged. Shares currency/amount resolution with
 * resolveLocalGiftAmount so copy and link can never drift.
 */
export function buildGivingDeeplink(
  attrs: Record<string, unknown>,
  strategy: GivingHandleStrategy = "blend",
): string {
  const { amountLocal, currencyCode } = resolveLocalGiftAmount(attrs, strategy);

  const params = new URLSearchParams({
    currency: currencyCode.toLowerCase(),
    fund: "YouVersion",
    frequency: "monthly",
    amount: String(amountLocal),
    utm_medium: "push",
    utm_source: "Nexus",
    utm_campaign: "nexus-giving",
  });

  return `https://www.bible.com/give?${params.toString()}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/giving-link.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/giving-link.ts tests/unit/giving-link.test.ts
git commit -m "feat(giving): strategy-aware ask amounts + shared currency resolver"
```

---

## Task 2: Pure giving-copy.ts (multiplier + bibles + substitution)

**Files:**
- Create: `src/lib/engine/giving-copy.ts`
- Test: `tests/unit/giving-copy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/giving-copy.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import {
  DEFAULT_DOLLARS_TO_BIBLES,
  parseMultiplier,
  computeBibles,
  substituteGivingCopy,
} from "@/lib/engine/giving-copy";

describe("parseMultiplier", () => {
  it("parses a positive numeric string", () => {
    expect(parseMultiplier("30")).toBe(30);
  });
  it("falls back to default on blank", () => {
    expect(parseMultiplier("")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier(null)).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier(undefined)).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("falls back to default on garbage", () => {
    expect(parseMultiplier("abc")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("falls back to default on zero or negative", () => {
    expect(parseMultiplier("0")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
    expect(parseMultiplier("-5")).toBe(DEFAULT_DOLLARS_TO_BIBLES);
  });
  it("accepts a fractional multiplier", () => {
    expect(parseMultiplier("24.5")).toBe(24.5);
  });
});

describe("computeBibles", () => {
  it("multiplies USD amount by the multiplier and rounds", () => {
    expect(computeBibles(25, 24)).toBe(600);
  });
  it("rounds to the nearest integer", () => {
    expect(computeBibles(25, 24.4)).toBe(610);
  });
  it("guards non-finite or non-positive amounts to 0", () => {
    expect(computeBibles(0, 24)).toBe(0);
    expect(computeBibles(-5, 24)).toBe(0);
    expect(computeBibles(Number.NaN, 24)).toBe(0);
  });
});

describe("substituteGivingCopy", () => {
  it("replaces {{ask}} and {{bibles}} (bibles with thousands separators)", () => {
    const out = substituteGivingCopy(
      "A gift of {{ask}} a month will distribute over {{bibles}} Bible apps this year",
      { amountDisplay: "$25", bibles: 600 },
    );
    expect(out).toBe("A gift of $25 a month will distribute over 600 Bible apps this year");
  });
  it("formats large bibles counts with separators", () => {
    const out = substituteGivingCopy("{{bibles}}", { amountDisplay: "$100", bibles: 2400 });
    expect(out).toBe("2,400");
  });
  it("replaces all occurrences of a token", () => {
    expect(substituteGivingCopy("{{ask}} {{ask}}", { amountDisplay: "$10", bibles: 240 })).toBe("$10 $10");
  });
  it("leaves unknown tokens untouched", () => {
    expect(substituteGivingCopy("{{ask}} {{unknown}}", { amountDisplay: "$10", bibles: 240 }))
      .toBe("$10 {{unknown}}");
  });
  it("passes text with no placeholders through unchanged", () => {
    expect(substituteGivingCopy("plain text", { amountDisplay: "$10", bibles: 240 })).toBe("plain text");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/giving-copy.test.ts`
Expected: FAIL — module `@/lib/engine/giving-copy` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/engine/giving-copy.ts`:

```ts
// Pure copy helpers for dynamic giving handles. No DB / IO.

/** Default dollars→Bibles ratio: $1/month ≈ 24 Bible apps distributed per year. */
export const DEFAULT_DOLLARS_TO_BIBLES = 24;

/**
 * Parse the giving_dollars_to_bibles_multiplier AppSetting value.
 * Falls back to DEFAULT_DOLLARS_TO_BIBLES when blank, non-numeric, or ≤ 0 —
 * a misconfigured setting still produces a valid (default) impact figure.
 */
export function parseMultiplier(raw: string | null | undefined): number {
  const n = Number(raw ?? "");
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DOLLARS_TO_BIBLES;
}

/**
 * Bibles distributed = round(amountUsd × multiplier). USD-based because the
 * relationship is dollars × multiplier. Non-finite/≤0 amounts yield 0.
 */
export function computeBibles(amountUsd: number, multiplier: number): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  return Math.round(amountUsd * multiplier);
}

/**
 * Replace {{ask}} (already-formatted currency string) and {{bibles}} (integer,
 * rendered with locale thousands separators) in copy. Unknown tokens are left
 * untouched; text with no placeholders passes through unchanged.
 */
export function substituteGivingCopy(
  text: string,
  vals: { amountDisplay: string; bibles: number },
): string {
  return text
    .replaceAll("{{ask}}", vals.amountDisplay)
    .replaceAll("{{bibles}}", vals.bibles.toLocaleString("en-US"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/giving-copy.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/giving-copy.ts tests/unit/giving-copy.test.ts
git commit -m "feat(giving): pure giving-copy lib (multiplier, bibles, substitution)"
```

---

## Task 3: Dynamic-handle branch in send-grouping.ts

Adds `givingHandleStrategy` to `VariantMeta`, a `givingMultiplier` parameter, and a branch that resolves per-user copy + strategy-aware deeplink at send time.

**Files:**
- Modify: `src/lib/cron/send-grouping.ts`
- Test: `tests/unit/cron-send-grouping.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/cron-send-grouping.test.ts` (inside the `describe("groupDecisionsByVariant", ...)` block). Note `meta()` must supply `givingHandleStrategy: null` by default — update the helper too:

Update the `meta()` helper (top of file) to include the new field default:

```ts
function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "app://home",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    givingHandleStrategy: null,
    ...overrides,
  };
}
```

Add the test:

```ts
  it("dynamic-handle variant substitutes per-user copy, sets strategy deeplink, splits by copy", () => {
    const variantMeta = new Map<string, VariantMeta>([
      ["v1", meta({
        body: "A gift of {{ask}} a month will distribute over {{bibles}} Bible apps this year",
        title: "Give {{ask}}",
        deeplink: null,
        givingHandleStrategy: "recent-gift",
      })],
    ]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-05-30T12:00:00Z");

    // u1: recent gift 25 → ask resolves to a per-user amount; u2: recent gift 200 → different amount
    const attrs1 = { gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_most_recent: 25 };
    const attrs2 = { gift_count_lifetime: 9, gift_count_past_3_to_36_months: 4, gift_amount_most_recent: 200 };

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1", null, attrs1), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2", null, attrs2), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
      undefined,
      24,
    );

    const vals = Object.values(groups);
    // Different per-user amounts → different copy → two groups
    expect(vals).toHaveLength(2);
    for (const g of vals) {
      expect(g.body).not.toContain("{{ask}}");
      expect(g.body).not.toContain("{{bibles}}");
      expect(g.title).not.toContain("{{ask}}");
      // Deeplink overridden with strategy-aware giving URL
      expect(g.deeplink).toContain("https://www.bible.com/give?");
      expect(g.deeplink).toContain("utm_campaign=nexus-giving");
    }
  });

  it("dynamic-handle uses default multiplier (24) when givingMultiplier omitted", () => {
    const variantMeta = new Map<string, VariantMeta>([
      ["v1", meta({ body: "{{bibles}} apps", deeplink: null, givingHandleStrategy: "avg-gift", title: null })],
    ]);
    const decisionIdByUser = new Map([["u1", "d1"]]);
    const at = new Date("2026-05-30T12:00:00Z");
    // avg 40 → 40*1.1=44 → snaps to 50 USD → 50*24 = 1,200
    const attrs = { gift_count_lifetime: 5, gift_count_past_3_to_36_months: 3, gift_amount_average: 40 };

    const groups = groupDecisionsByVariant(
      [{ user: user("u1", null, attrs), variantId: "v1", scheduledAt: at, inLocalTime: false }],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)[0].body).toBe("1,200 apps");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cron-send-grouping.test.ts`
Expected: FAIL — `givingHandleStrategy` is not a property of `VariantMeta`; `groupDecisionsByVariant` does not accept a 5th arg / does not substitute copy.

- [ ] **Step 3: Add the field, param, and branch**

In `src/lib/cron/send-grouping.ts`:

(a) Update the import line 5-7 region to add the new helpers:

```ts
import {
  GIVING_LINK_SENTINEL,
  buildGivingDeeplink,
  resolveLocalGiftAmount,
  formatGiftAmount,
  type GivingHandleStrategy,
} from "@/lib/engine/giving-link";
import { computeBibles, substituteGivingCopy, DEFAULT_DOLLARS_TO_BIBLES } from "@/lib/engine/giving-copy";
import { resolvePushLocaleStrict, type LocalizedCopy } from "@/lib/push-locale";
import { VERSE_PUSH_SENTINEL, pickVerse, resolveVerseCopy, type VersePool, type VerseStrategy } from "@/lib/verse-content";
```

(b) Add `givingHandleStrategy` to `VariantMeta` (after `brazeVariantId`):

```ts
export type VariantMeta = {
  channel: string;
  body: string;
  title: string | null;
  deeplink: string | null;
  brazeCampaignId: string | null;
  brazeVariantId: string | null;
  /** Non-null marks a dynamic-handle variant; selects the per-user ask strategy. */
  givingHandleStrategy: GivingHandleStrategy | null;
};
```

(c) Add the `givingMultiplier` parameter to `groupDecisionsByVariant` (after `localization`):

```ts
export function groupDecisionsByVariant(
  inputs: Array<{ user: GroupUser; variantId: string; scheduledAt: Date; inLocalTime: boolean }>,
  variantMeta: Map<string, VariantMeta>,
  decisionIdByUser: Map<string, string>,
  localization?: {
    enabled: boolean;
    translationsByVariant: Map<string, Map<string, LocalizedCopy>>;
    versePool?: VersePool;
    strategyByVariant?: Map<string, VerseStrategy>;
  },
  givingMultiplier?: number,
): Record<string, VariantSendGroup> {
```

(d) Replace the deeplink/copy resolution block (current lines ~66-105, from `const resolvedDeeplink = ...` through the `groupKey` assignment) with a dynamic-handle-first version:

```ts
    const attrs = (user.attributes as Record<string, unknown>) ?? {};
    const tag = attrs.language_tag as string | undefined;

    let copy: LocalizedCopy = { title: meta.title, body: meta.body };
    let resolvedDeeplink: string | null;
    let copyKeyed: boolean;

    if (meta.givingHandleStrategy != null) {
      // Dynamic giving handle: resolve a per-user ask amount + impact figure, then
      // substitute into copy and override the deeplink with the matching give-URL.
      const strategy = meta.givingHandleStrategy;
      const { amountLocal, currencyCode, amountUsd } = resolveLocalGiftAmount(attrs, strategy);
      const amountDisplay = formatGiftAmount(amountLocal, currencyCode);
      const bibles = computeBibles(amountUsd, givingMultiplier ?? DEFAULT_DOLLARS_TO_BIBLES);
      copy = {
        title: meta.title != null ? substituteGivingCopy(meta.title, { amountDisplay, bibles }) : null,
        body: substituteGivingCopy(meta.body, { amountDisplay, bibles }),
      };
      resolvedDeeplink = buildGivingDeeplink(attrs, strategy);
      // Per-user copy → batch only users sharing identical resolved copy.
      copyKeyed = meta.channel === "push";
    } else {
      resolvedDeeplink = meta.deeplink === GIVING_LINK_SENTINEL
        ? buildGivingDeeplink(attrs)
        : meta.deeplink;

      // Verse-push arms (body sentinel) resolve a rotated, localized verse at send
      // time; otherwise fall back to the standard translation path.
      const verseStrategy = localization?.strategyByVariant?.get(variantId);
      const isVerse =
        meta.body === VERSE_PUSH_SENTINEL && verseStrategy != null && localization?.versePool != null;
      if (isVerse) {
        const dateBucket = scheduledAt.toISOString().slice(0, 10);
        const verse = pickVerse(localization!.versePool!, user.externalId, dateBucket);
        // Empty pool → skip rather than deliver the raw sentinel as a push body.
        if (!verse) continue;
        copy = resolveVerseCopy(verse, tag, verseStrategy!);
      } else if (localization?.enabled && meta.channel === "push") {
        // Strict localization: skip recipients we cannot serve in their own language
        // rather than falling back to the English copy.
        const localized = resolvePushLocaleStrict(
          tag,
          localization.translationsByVariant.get(variantId) ?? new Map(),
          { title: meta.title, body: meta.body },
        );
        if (!localized) continue;
        copy = localized;
      }
      copyKeyed = meta.channel === "push" && (isVerse || (localization?.enabled ?? false));
    }

    const groupInLocalTime = isFallback;
    const baseKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:${resolvedDeeplink ?? ""}`;
    // When copy is resolved per-user (giving handle, verse arm, or localized push),
    // users sharing the same resolved copy must batch together; the copy fully
    // determines the payload, so key by it.   is a NUL field separator (cannot
    // appear in title/body) preventing title|body ambiguity.
    const groupKey = copyKeyed
      ? `${baseKey}:${copy.title ?? ""} ${copy.body}`
      : baseKey;
```

Note: the old block declared `const attrs` further down; this rewrite hoists it. Remove the now-duplicate `const attrs = (user.attributes as Record<string, unknown>) ?? {};` and `const tag = ...` lines that previously sat after the verse-strategy lookup. The body of the `if (!byVariant[groupKey])` block below stays unchanged (it already reads `copy.body`, `copy.title`, `resolvedDeeplink`, `groupInLocalTime`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/cron-send-grouping.test.ts`
Expected: PASS (all existing + new tests; existing tests rely on `meta()` now defaulting `givingHandleStrategy: null`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/unit/cron-send-grouping.test.ts
git commit -m "feat(giving): dynamic-handle copy+deeplink resolution in send-grouping"
```

---

## Task 4: Add dynamic-handle subcategory

**Files:**
- Modify: `src/lib/push-categories.ts`

- [ ] **Step 1: Add the subcategory**

In `src/lib/push-categories.ts`, add `dynamic-handle` to the `giving` category's `subcategories` array (append after `thank-you-followup`):

```ts
      { value: "thank-you-followup", label: "Thank You Follow-up" },
      { value: "dynamic-handle", label: "Dynamic Handle" },
```

- [ ] **Step 2: Run the quick check to confirm derived exports still typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors; `PUSH_SUBCATEGORIES.giving` now includes `dynamic-handle`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/push-categories.ts
git commit -m "feat(giving): add dynamic-handle subcategory under giving"
```

---

## Task 5: Wire multiplier + strategy through the cron route

Reads the multiplier once per run, derives each variant's strategy into `variantMeta`, and passes the multiplier into both `groupDecisionsByVariant` call sites.

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`

- [ ] **Step 1: Add imports**

Near the existing giving-link / verse-content imports (around line 29-34), add:

```ts
import { isGivingHandleStrategy, type GivingHandleStrategy } from "@/lib/engine/giving-link";
import { parseMultiplier } from "@/lib/engine/giving-copy";
```

(If `groupDecisionsByVariant` is imported from `@/lib/cron/send-grouping` at line 29, leave that import as-is.)

- [ ] **Step 2: Read the multiplier once per run**

In the `const [, cooldownSetting] = await Promise.all([...])` block (lines ~177-309), add a third element to the array — the multiplier lookup — and destructure it:

Change the destructure line:

```ts
  const [, cooldownSetting, multiplierSetting] = await Promise.all([
```

And add, immediately after the existing `prisma.appSetting.findUnique({ where: { key: "exploration_window_cooldown_days" } }),` line (still inside the array, before the closing `]);`):

```ts
    prisma.appSetting.findUnique({ where: { key: "giving_dollars_to_bibles_multiplier" } }),
```

Then after `const cooldownMs = ...` / `const windowMs = ...` (around line 318-320), add:

```ts
  // Global dollars→Bibles multiplier for dynamic-handle impact copy (default 24).
  const givingMultiplier = parseMultiplier(multiplierSetting?.value);
```

- [ ] **Step 3: Add a strategy deriver and populate `variantMeta`**

Add this helper near the top of the module (after imports, before `export async function`):

```ts
// A dynamic-handle variant carries its amount strategy in actionFeatures.givingHandleStrategy.
// Returns the strategy (defaulting to "blend") for dynamic-handle variants, else null.
function deriveGivingStrategy(subcategory: string | null, actionFeatures: unknown): GivingHandleStrategy | null {
  if (subcategory !== "dynamic-handle") return null;
  const raw =
    actionFeatures && typeof actionFeatures === "object"
      ? (actionFeatures as Record<string, unknown>)["givingHandleStrategy"]
      : undefined;
  return isGivingHandleStrategy(raw) ? raw : "blend";
}
```

Update the `variantMeta` builder (lines ~464-482) so the inline type and the `.set(...)` include `givingHandleStrategy`:

```ts
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      deeplink: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
      givingHandleStrategy: GivingHandleStrategy | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        variantMeta.set(v.id, {
          channel:         msg.channel,
          body:            v.body,
          title:           v.title ?? null,
          deeplink:        v.deeplink ?? null,
          brazeCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId:  v.brazeVariantId ?? null,
          givingHandleStrategy: deriveGivingStrategy(v.subcategory ?? null, v.actionFeatures),
        });
      }
    }
```

- [ ] **Step 4: Pass the multiplier into both call sites**

At line ~958:

```ts
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser, localization, givingMultiplier);
```

At line ~1345:

```ts
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser, localization, givingMultiplier);
```

- [ ] **Step 5: Run typecheck + the affected unit tests**

Run: `bun run typecheck && bun test tests/unit/cron-send-grouping.test.ts`
Expected: PASS — the route's `variantMeta` now structurally matches the imported `VariantMeta` type (including `givingHandleStrategy`).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat(giving): thread multiplier + handle strategy through cron send"
```

---

## Task 6: Settings "Agent Defaults" card + round-trip regression test

**Files:**
- Modify: `src/app/settings/page.tsx`
- Test: `tests/regression/giving-multiplier-setting.test.ts`

- [ ] **Step 1: Write the failing regression test**

Create `tests/regression/giving-multiplier-setting.test.ts`:

```ts
/**
 * Regression / contract: Settings API must round-trip the dynamic-handle
 * dollars→Bibles multiplier, and the persisted value must drive the bibles math.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { POST, GET } from "@/app/api/settings/route";
import { parseMultiplier, computeBibles } from "@/lib/engine/giving-copy";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("settings API: giving_dollars_to_bibles_multiplier", () => {
  it("saves and retrieves the multiplier", async () => {
    const postReq = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giving_dollars_to_bibles_multiplier: "30" }),
    });
    expect((await POST(postReq)).status).toBe(200);

    const body = (await (await GET()).json()) as Record<string, string>;
    expect(body["giving_dollars_to_bibles_multiplier"]).toBe("30");
  });

  it("persisted multiplier drives amountUsd × multiplier bibles math", async () => {
    const postReq = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giving_dollars_to_bibles_multiplier: "24" }),
    });
    await POST(postReq);

    const body = (await (await GET()).json()) as Record<string, string>;
    const multiplier = parseMultiplier(body["giving_dollars_to_bibles_multiplier"]);
    expect(computeBibles(25, multiplier)).toBe(600);
  });

  it("absent key falls back to the default multiplier", async () => {
    const body = (await (await GET()).json()) as Record<string, string>;
    expect(body["giving_dollars_to_bibles_multiplier"]).toBeUndefined();
    expect(parseMultiplier(body["giving_dollars_to_bibles_multiplier"])).toBe(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/giving-multiplier-setting.test.ts`
Expected: PASS on the first two assertions logic-wise but this test will FAIL only if the API can't persist arbitrary keys. Since `/api/settings` already upserts arbitrary keys, this test should PASS immediately — it locks the contract. (If it fails, the settings route regressed.) Proceed regardless; the UI card is the remaining deliverable.

> Note: this test guards the API contract the card depends on. It does not require a UI change to pass.

- [ ] **Step 3: Add multiplier state + load + save to the settings page**

In `src/app/settings/page.tsx`:

(a) Add state near the other lift state (after line ~33):

```ts
  // Agent defaults
  const [givingMultiplier, setGivingMultiplier] = useState("24");
  const [agentDefaultsSaved, setAgentDefaultsSaved] = useState(false);
  const [agentDefaultsSaving, setAgentDefaultsSaving] = useState(false);
```

(b) Extend the on-mount loader (the `useEffect` at ~54-63) to read the key:

```ts
        if (data["lift_since_date"]) setLiftSinceDate(data["lift_since_date"]);
        if (data["giving_dollars_to_bibles_multiplier"]) setGivingMultiplier(data["giving_dollars_to_bibles_multiplier"]);
```

(c) Add a save handler (after `handleSaveLift`):

```ts
  const handleSaveAgentDefaults = async () => {
    setAgentDefaultsSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giving_dollars_to_bibles_multiplier: givingMultiplier }),
      });
      setAgentDefaultsSaved(true);
      setTimeout(() => setAgentDefaultsSaved(false), 3000);
    } finally {
      setAgentDefaultsSaving(false);
    }
  };
```

(d) Add the card JSX after the AI Lift Measurement `</Card>` (before `<DisplayPreferences />`):

```tsx
        {/* Agent Defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Agent Defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Dynamic giving handles render &ldquo;A gift of $X a month will distribute over Y Bible apps this year&rdquo;,
              where Y = the USD ask × this multiplier. Applies to all dynamic-handle pushes.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[12rem]">
                <label className="text-xs font-medium text-muted-foreground">Dollars to Bibles multiplier</label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="24"
                  value={givingMultiplier}
                  onChange={(e) => setGivingMultiplier(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
                <p className="text-xs text-muted-foreground mt-1">Default 24 ($25/mo → 600 Bibles).</p>
              </div>
              <Button onClick={handleSaveAgentDefaults} disabled={agentDefaultsSaving} size="sm">
                {agentDefaultsSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : "Save Agent Defaults"}
              </Button>
              {agentDefaultsSaved && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </div>
              )}
            </div>
          </CardContent>
        </Card>
```

- [ ] **Step 4: Verify the page typechecks and the regression test passes**

Run: `bun run typecheck && bun test tests/regression/giving-multiplier-setting.test.ts`
Expected: PASS.

- [ ] **Step 5: Manually verify the settings UI**

Run: `bun run dev`, open `http://localhost:3000/settings`, confirm the "Agent Defaults" card renders, change the multiplier, click Save, reload, and confirm the value persists. (If the dev server / browser is unavailable in this environment, state that explicitly rather than claiming success.)

- [ ] **Step 6: Commit**

```bash
git add src/app/settings/page.tsx tests/regression/giving-multiplier-setting.test.ts
git commit -m "feat(giving): settings card for dollars-to-bibles multiplier"
```

---

## Final Verification

- [ ] **Run the full quick check**

Run: `bun run check:quick`
Expected: typecheck + lint + unit/contract tests all pass.

- [ ] **Run the full suite before opening the MR**

Run: `bun run check`
Expected: all green (unit + integration + regression).

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Amount experimentation as separate variant/arm per strategy → Task 1 (`selectGiftAmountUSDByStrategy`) + Task 5 (`deriveGivingStrategy` from `actionFeatures.givingHandleStrategy`). Arms are keyed on `variantId`; no engine change. ✓
- Body amount matches link → Task 1 `resolveLocalGiftAmount` shared by copy + `buildGivingDeeplink`. ✓
- `utm_campaign` → `nexus-giving` → Task 1 Step 4 + test update Step 1. ✓
- Multiplier AppSetting (default 24) + Settings card → Task 2 (`parseMultiplier`) + Task 5 (read once per run) + Task 6 (card). ✓
- `dynamic-handle` subcategory under giving → Task 4. ✓
- Send-time substitution upstream of payload factory → Task 3 (resolved inside pure `groupDecisionsByVariant`, before `sendVariantGroup`). ✓
- Error handling (blank/garbage multiplier→24, missing anchor→blend, unknown currency→USD, no placeholders→passthrough) → Tasks 1 & 2 with explicit tests. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code.

**Type consistency:** `GivingHandleStrategy` defined in Task 1, imported into `VariantMeta` (Task 3) and the route (Task 5). `VariantMeta.givingHandleStrategy` is `GivingHandleStrategy | null` everywhere (send-grouping type, route inline type, `meta()` test helper default). `resolveLocalGiftAmount` returns `{ amountLocal, currencyCode, amountUsd }` consumed identically in Task 3. `parseMultiplier`/`computeBibles`/`substituteGivingCopy` signatures match across Tasks 2, 3, 5, 6.
