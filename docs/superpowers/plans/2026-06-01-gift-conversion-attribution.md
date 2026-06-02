# Gift Conversion Attribution + Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Give a gift" a working conversion goal — attribute post-send gifts to the sending agent/variant, feed an amount-weighted reward into the bandit, persist USD-normalized gift revenue, and surface gift performance at the user, agent, and fleet level.

**Architecture:** A pure USD-normalization helper and an amount-weighted reward branch in the bandit engine; one new `UserDecision.conversionValue` column; ingest changes that normalize currency, store revenue, and dedup gifts; and three read surfaces (dashboard, agent performance, user inspector) that aggregate the new column.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon HTTP adapter), `unstable_cache`, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-06-01-gift-conversion-attribution-design.md`

**Branch:** `feat/gift-conversion-attribution` (already exists, spec committed)

**Conventions that bite if ignored:**
- Run tests with `bun test <path>` (loads `.env.test`), NEVER `bun run` a test file (loads `.env.local` = production).
- `npx prisma migrate dev` applies to the PRODUCTION DB (prisma.config.ts → .env.local). The TEST DB must be migrated separately via `ALTER TABLE` through the `neon()` HTTP client with the test `DATABASE_URL` — never `prisma db push` on the test DB.
- Engine functions in `src/lib/engine/` must stay pure (no DB/IO).
- Every new `$queryRaw` in a page/cache gets a regression test asserting exact SQL column names.

---

### Task 1: Unify the gift event name → `gift_given`

The preset emits `gift_completed` but ingest and the reward calculator key on `gift_given`, so a gift never matches a goal → reward 0 → the bandit never moves. Rename the preset to `gift_given` everywhere.

**Files:**
- Modify: `src/lib/constants/youversion.ts:14` and `:66`
- Modify (test): `tests/unit/youversion-goal-color.test.ts:6,14`
- Modify (test): `tests/regression/goals-editor-preset-only.test.tsx:54`

- [ ] **Step 1: Update the color unit test to expect `gift_given`**

In `tests/unit/youversion-goal-color.test.ts`, replace both `gift_completed` occurrences:

```ts
  it("colors gift + sower green", () => {
    expect(goalColorGroup({ eventName: "gift_given", weight: 10 })).toBe("green");
    expect(goalColorGroup({ eventName: "sower_subscribed", weight: 10 })).toBe("green");
  });
```

and:

```ts
    // Negative weight wins even for an otherwise-green event name.
    expect(goalColorGroup({ eventName: "gift_given", weight: -1 })).toBe("red");
```

- [ ] **Step 2: Update the goals-editor regression test to expect `gift_given`**

In `tests/regression/goals-editor-preset-only.test.tsx:54`, change the assertion:

```ts
    expect(container.textContent).toContain("gift_given");
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `bun test tests/unit/youversion-goal-color.test.ts tests/regression/goals-editor-preset-only.test.tsx`
Expected: FAIL — assertions expect `gift_given` but the preset still emits `gift_completed`.

- [ ] **Step 4: Rename the preset and the green-set entry**

In `src/lib/constants/youversion.ts:14`:

```ts
  { eventName: "gift_given", label: "Give a gift", tier: "best", weight: 10, description: "User completes a gift/donation" },
```

In `src/lib/constants/youversion.ts:66`:

```ts
const GREEN_GOAL_EVENTS = new Set(["gift_given", "sower_subscribed"]);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/unit/youversion-goal-color.test.ts tests/regression/goals-editor-preset-only.test.tsx`
Expected: PASS.

- [ ] **Step 6: Grep for any other `gift_completed` references**

Run: `grep -rn "gift_completed" src tests`
Expected: no output. If any remain, update them to `gift_given` (this is the canonical name).

- [ ] **Step 7: Commit**

```bash
git add src/lib/constants/youversion.ts tests/unit/youversion-goal-color.test.ts tests/regression/goals-editor-preset-only.test.tsx
git commit -m "feat(goals): unify gift preset event name to gift_given"
```

---

### Task 2: USD normalization helper `usdAmount()`

Add a pure helper that converts a gift amount in any known currency to USD, reusing the existing `CURRENCY_RATES` table (units of foreign currency per 1 USD). Round to cents.

**Files:**
- Modify: `src/lib/engine/giving-link.ts` (add export near `CURRENCY_RATES`)
- Modify (test): `tests/unit/giving-link.test.ts` (add a `describe` block)

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/giving-link.test.ts`. Add `usdAmount` to the existing import from `@/lib/engine/giving-link`, then add:

```ts
describe("usdAmount", () => {
  it("returns the amount unchanged for USD", () => {
    expect(usdAmount(50, "USD")).toBe(50);
  });

  it("defaults null/blank/unknown currency to USD (rate 1)", () => {
    expect(usdAmount(50, null)).toBe(50);
    expect(usdAmount(50, "")).toBe(50);
    expect(usdAmount(50, "ZZZ")).toBe(50);
  });

  it("normalizes a known foreign currency to USD using CURRENCY_RATES", () => {
    // GBP rate = 0.744 units per USD → 74.4 GBP / 0.744 = 100 USD
    expect(usdAmount(74.4, "GBP")).toBeCloseTo(100, 2);
  });

  it("is case-insensitive on the currency code", () => {
    expect(usdAmount(74.4, "gbp")).toBeCloseTo(100, 2);
  });

  it("rounds to cents", () => {
    // JPY rate = 159.24 → 1000 JPY / 159.24 = 6.2798... → 6.28
    expect(usdAmount(1000, "JPY")).toBe(6.28);
  });

  it("returns 0 for a non-finite or non-positive amount", () => {
    expect(usdAmount(0, "USD")).toBe(0);
    expect(usdAmount(NaN, "USD")).toBe(0);
    expect(usdAmount(-10, "USD")).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/giving-link.test.ts`
Expected: FAIL — `usdAmount` is not exported.

- [ ] **Step 3: Implement `usdAmount`**

Add to `src/lib/engine/giving-link.ts`, immediately after the `CURRENCY_RATES` declaration (after line 38):

```ts
/**
 * Convert a gift amount in `currency` to USD, rounded to cents.
 * Unknown/blank/null currency defaults to USD (rate 1).
 * Non-finite or non-positive amounts return 0.
 * CURRENCY_RATES holds units of foreign currency per 1 USD, so usd = amount / rate.
 */
export function usdAmount(amount: number, currency: string | null): number {
  if (!isFinite(amount) || amount <= 0) return 0;
  const code =
    typeof currency === "string" && currency.trim().length > 0
      ? currency.trim().toUpperCase()
      : "USD";
  const rate = CURRENCY_RATES[code] ?? 1;
  return Math.round((amount / rate) * 100) / 100;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/giving-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/giving-link.ts tests/unit/giving-link.test.ts
git commit -m "feat(engine): add usdAmount() currency-normalization helper"
```

---

### Task 3: Amount-weighted `gift_given` reward

Replace the flat-weight reward for `gift_given` with a log-scaled, amount-weighted reward so gift size is visible to the bandit without saturating. tierBase comes from the matched goal's tier (so a non-`best` tier still scales down). All other event paths are unchanged.

**Files:**
- Modify: `src/lib/engine/reward-calculator.ts`
- Modify (test): `tests/unit/reward-calculator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/reward-calculator.test.ts` (the file already imports `calculateReward` and defines a `goals` array; add a self-contained block with its own gift goal):

```ts
describe("gift_given amount-weighted reward", () => {
  const giftGoals: Goal[] = [
    { id: "gg", agentId: "a1", eventName: "gift_given", tier: "best", valueWeight: 10, weightMode: "fixed", weightDefault: 1.0 },
  ];

  // reward = clamp((tierBase/10) * log10(1+usd)/log10(1+1000), 0, 1); tierBase(best)=10
  it("$5 ≈ 0.26", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 5 })).toBeCloseTo(0.26, 2);
  });
  it("$50 ≈ 0.57", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 50 })).toBeCloseTo(0.57, 2);
  });
  it("$500 ≈ 0.90", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 500 })).toBeCloseTo(0.90, 2);
  });
  it("$1000 caps at 1.0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 1000 })).toBeCloseTo(1.0, 5);
  });
  it("above the cap still clamps to 1.0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 5000 })).toBe(1);
  });
  it("$0 or missing amount → 0", () => {
    expect(calculateReward("gift_given", giftGoals, { gift_amount_usd: 0 })).toBe(0);
    expect(calculateReward("gift_given", giftGoals, {})).toBe(0);
  });

  it("a non-best tier scales the reward down proportionally", () => {
    const goodGiftGoals: Goal[] = [
      { id: "gg2", agentId: "a1", eventName: "gift_given", tier: "good", valueWeight: 10, weightMode: "fixed", weightDefault: 1.0 },
    ];
    // tierBase(good)=5 → half of the best-tier reward for the same amount
    expect(calculateReward("gift_given", goodGiftGoals, { gift_amount_usd: 1000 })).toBeCloseTo(0.5, 5);
  });

  it("returns 0 when the agent has no gift_given goal", () => {
    expect(calculateReward("gift_given", [], { gift_amount_usd: 100 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/reward-calculator.test.ts`
Expected: FAIL — current code uses flat `(baseReward * valueWeight)/100 = (10*10)/100 = 1` for every gift, so $5/$50/$500 all return 1, not the log-scaled values.

- [ ] **Step 3: Implement the amount-weighted branch**

In `src/lib/engine/reward-calculator.ts`, add a constant after `RECOVERY_WEIGHT` (line 16):

```ts
const GIFT_REWARD_CAP_USD = 1000; // tunable: gift amount that maps to reward 1.0
```

Then, inside `calculateReward`, after `const baseReward = TIER_BASE_REWARDS[matchingGoal.tier] ?? 0;` (line 44) and BEFORE the `let weight` block, add:

```ts
  // Gift conversions are amount-weighted on a log scale so gift size is visible
  // to the bandit without saturating. frac = log10(1+usd)/log10(1+CAP).
  if (conversionEvent === "gift_given") {
    const usd = Number(eventProperties?.gift_amount_usd) || 0;
    if (usd <= 0) return 0;
    const frac = Math.log10(1 + usd) / Math.log10(1 + GIFT_REWARD_CAP_USD);
    return Math.max(0, Math.min(1, (baseReward / 10) * frac));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/reward-calculator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/reward-calculator.ts tests/unit/reward-calculator.test.ts
git commit -m "feat(engine): log-scaled amount-weighted gift_given reward"
```

---

### Task 4: Add `UserDecision.conversionValue` column

Persist the USD-normalized gift amount so SQL can `SUM` revenue. Reward stays in `reward` [-1,1]; `conversionValue` is the reporting number. Migration applies to BOTH databases.

**Files:**
- Modify: `prisma/schema.prisma` (model `UserDecision`, after `reward` on line 165)

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, inside `model UserDecision`, immediately after the `reward Float?` line:

```prisma
  reward                  Float?
  conversionValue         Float?    // USD-normalized gift amount for an attributed gift_given decision; null otherwise
```

- [ ] **Step 2: Generate the migration against the production DB**

Run: `npx prisma migrate dev --name add_userdecision_conversion_value`
Expected: a new migration directory under `prisma/migrations/` containing `ALTER TABLE "UserDecision" ADD COLUMN "conversionValue" DOUBLE PRECISION;`, and the Prisma client regenerates.

- [ ] **Step 3: Apply the same column to the TEST DB via the neon() HTTP client**

The test DB is NOT touched by `prisma migrate dev`. Apply the column explicitly. Run:

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.test | head -1 | cut -d'=' -f2- | tr -d '"')" \
bun -e 'import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
await sql`ALTER TABLE "UserDecision" ADD COLUMN IF NOT EXISTS "conversionValue" double precision`;
console.log("test DB: conversionValue added");'
```

Expected output: `test DB: conversionValue added`.

- [ ] **Step 4: Verify the column exists on the test DB**

Run:

```bash
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.test | head -1 | cut -d'=' -f2- | tr -d '"')" \
bun -e 'import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${"UserDecision"} AND column_name = ${"conversionValue"}`;
console.log(r.length === 1 ? "OK: column present" : "MISSING");'
```

Expected output: `OK: column present`.

- [ ] **Step 5: Verify typecheck picks up the new field**

Run: `bun run typecheck`
Expected: PASS (no errors about `conversionValue`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add UserDecision.conversionValue for gift revenue"
```

---

### Task 5: Ingest — USD normalize, store conversionValue, dedup guard

Wire the helper and reward into the giving-attribution block. Pass `gift_amount_usd` to the reward calculator, write `conversionValue`, and guard against double-attributing the same gift.

**Files:**
- Modify: `src/app/api/ingest/users/route.ts` (chunk pre-load ~677, giving block ~893-996)
- Modify (test): `tests/integration/giving-conversion.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Append two tests to `tests/integration/giving-conversion.test.ts` (inside the existing `describe`). The helpers `createAgent`, `createGoal`, `createMessage`, `createVariant`, `createDecision`, `buildRequest`, `ingestUsers`, `prisma` are already imported at the top of that file:

```ts
  it("persists USD-normalized conversionValue for a foreign-currency gift", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    const sentAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const decision = await createDecision({
      agentId: agent.id,
      userId: "user_gift_fx",
      messageVariantId: variant.id,
      channel: "push",
      sentAt,
      brazeSendId: "braze_fx_001",
    });

    const giftDate = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
    const req = buildRequest({
      users: [{
        external_user_id: "user_gift_fx",
        attributes: {
          gift_amount_most_recent_timestamp: giftDate.toISOString(),
          gift_amount_most_recent: 74.4,
          gift_currency_most_recent: "GBP",
        },
      }],
    });
    expect((await ingestUsers(req)).status).toBe(200);

    const updated = await prisma.userDecision.findUnique({ where: { id: decision.id } });
    expect(updated?.conversionEvent).toBe("gift_given");
    // 74.4 GBP / 0.744 = 100 USD
    expect(updated?.conversionValue).toBeCloseTo(100, 2);
    expect(updated?.reward).not.toBeNull();
  });

  it("does NOT attribute the same gift twice across two syncs (dedup by giftDate)", async () => {
    const agent = await createAgent({ status: "active" });
    await createGoal(agent.id, { eventName: "gift_given", tier: "best" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);

    // Two delivered sends to the same user, both inside the window.
    const olderSentAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const newerSentAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const older = await createDecision({
      agentId: agent.id, userId: "user_gift_dedup", messageVariantId: variant.id,
      channel: "push", sentAt: olderSentAt, brazeSendId: "braze_dedup_old",
    });
    const newer = await createDecision({
      agentId: agent.id, userId: "user_gift_dedup", messageVariantId: variant.id,
      channel: "push", sentAt: newerSentAt, brazeSendId: "braze_dedup_new",
    });

    const giftDate = new Date(newerSentAt.getTime() + 24 * 60 * 60 * 1000);
    const giftBody = {
      users: [{
        external_user_id: "user_gift_dedup",
        attributes: {
          gift_amount_most_recent_timestamp: giftDate.toISOString(),
          gift_amount_most_recent: 50,
          gift_currency_most_recent: "USD",
        },
      }],
    };

    // First sync attributes to the most-recent decision (newer).
    expect((await ingestUsers(buildRequest(giftBody))).status).toBe(200);
    const newerAfter1 = await prisma.userDecision.findUnique({ where: { id: newer.id } });
    expect(newerAfter1?.conversionEvent).toBe("gift_given");
    expect(newerAfter1?.conversionAt?.getTime()).toBe(giftDate.getTime());

    // Second sync with the SAME gift timestamp must NOT attribute to the older decision.
    expect((await ingestUsers(buildRequest(giftBody))).status).toBe(200);
    const olderAfter2 = await prisma.userDecision.findUnique({ where: { id: older.id } });
    expect(olderAfter2?.conversionAt).toBeNull();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/integration/giving-conversion.test.ts`
Expected: FAIL — `conversionValue` is never written (undefined/null), and the second sync double-attributes to the older decision.

- [ ] **Step 3: Pre-load already-attributed gift dates per chunk (dedup source)**

In `src/app/api/ingest/users/route.ts`, the chunk loop already builds `chunkGivingIds` (line 671-676) and queries `givingRows` (line 677-683). Immediately after the `givingDecisionsByUser` map is built (after line 689), add a second pre-load of existing gift attributions for those same users:

```ts
    // Pre-load already-attributed gift_given conversion timestamps per user so we
    // can skip re-attributing the same gift on a later sync (dedup by giftDate).
    const attributedGiftRows = chunkGivingIds.length > 0
      ? await prisma.userDecision.findMany({
          where: { userId: { in: chunkGivingIds }, conversionEvent: "gift_given", conversionAt: { not: null } },
          select: { userId: true, conversionAt: true },
        })
      : [];
    const attributedGiftDatesByUser = new Map<string, Set<number>>();
    for (const row of attributedGiftRows) {
      if (!row.conversionAt) continue;
      const set = attributedGiftDatesByUser.get(row.userId) ?? new Set<number>();
      set.add(row.conversionAt.getTime());
      attributedGiftDatesByUser.set(row.userId, set);
    }
```

- [ ] **Step 4: Apply the dedup guard, USD normalization, and conversionValue write**

In the giving block, replace the body from the `const decision = ...` line (909-910) through the `userDecision.update` call (924-933). The current code is:

```ts
          const decision = (givingDecisionsByUser.get(externalId) ?? [])
            .find((d) => d.sentAt >= windowStart && d.sentAt <= giftDate) ?? null;

          if (decision) {
            const giftAmount =
              typeof raw["gift_amount_most_recent"] === "number"
                ? raw["gift_amount_most_recent"]
                : null;

            const reward = calculateReward(
              "gift_given",
              decision.agent.goals as Parameters<typeof calculateReward>[1],
              giftAmount !== null ? { gift_amount_most_recent: giftAmount } : {},
            );

            await prisma.userDecision.update({
              where: { id: decision.id },
              data: {
                conversionEvent: "gift_given",
                conversionAt: giftDate,
                reward: reward !== 0 ? reward : null,
              },
            }).catch((err) => {
              console.error("[ingest/users] Failed to write giving conversion attribution:", err);
            });
```

Replace it with (note the new `usdAmount` import — see Step 5):

```ts
          // Dedup: if this exact gift (by timestamp) was already attributed for
          // this user on a prior sync, skip — never attribute one gift twice.
          const alreadyAttributed =
            attributedGiftDatesByUser.get(externalId)?.has(giftDate.getTime()) ?? false;

          const decision = alreadyAttributed
            ? null
            : (givingDecisionsByUser.get(externalId) ?? [])
                .find((d) => d.sentAt >= windowStart && d.sentAt <= giftDate) ?? null;

          if (decision) {
            const giftAmount =
              typeof raw["gift_amount_most_recent"] === "number"
                ? raw["gift_amount_most_recent"]
                : null;
            const giftCurrency =
              typeof raw["gift_currency_most_recent"] === "string"
                ? raw["gift_currency_most_recent"]
                : null;
            const usd = giftAmount !== null ? usdAmount(giftAmount, giftCurrency) : 0;

            const reward = calculateReward(
              "gift_given",
              decision.agent.goals as Parameters<typeof calculateReward>[1],
              { gift_amount_usd: usd, gift_amount_most_recent: giftAmount },
            );

            await prisma.userDecision.update({
              where: { id: decision.id },
              data: {
                conversionEvent: "gift_given",
                conversionAt: giftDate,
                conversionValue: usd > 0 ? usd : null,
                reward: reward !== 0 ? reward : null,
              },
            }).catch((err) => {
              console.error("[ingest/users] Failed to write giving conversion attribution:", err);
            });
```

(The closing of the `if (decision)` block and the downstream `reward !== 0` stats logic on lines 935-993 are unchanged.)

- [ ] **Step 5: Add the `usdAmount` import**

Confirm `calculateReward` is imported in the route, then add `usdAmount`. Find the existing import of `giving-link` (it imports `buildGivingDeeplink`). Run `grep -n "giving-link" src/app/api/ingest/users/route.ts` and add `usdAmount` to that import list. If `giving-link` is not imported, add:

```ts
import { usdAmount } from "@/lib/engine/giving-link";
```

- [ ] **Step 6: Run the integration tests to verify they pass**

Run: `bun test tests/integration/giving-conversion.test.ts`
Expected: PASS (existing tests + the two new ones).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/ingest/users/route.ts tests/integration/giving-conversion.test.ts
git commit -m "feat(ingest): USD-normalize gifts, store conversionValue, dedup guard"
```

---

### Task 6: Fleet gift insights (dashboard)

Add fleet-wide attributed gift count + revenue and an agent gift-revenue leaderboard, then render a gift metric card on the dashboard.

**Files:**
- Modify: `src/lib/cache/dashboard.ts` (add `getCachedFleetGiftStats`)
- Modify: `src/app/page.tsx` (export the cache fn from the barrel import, render a card in `MetricCardsSection`)
- Create (test): `tests/regression/dashboard-fleet-gift-stats-columns.test.ts`

- [ ] **Step 1: Write the failing regression test (exact SQL columns)**

Create `tests/regression/dashboard-fleet-gift-stats-columns.test.ts`:

```ts
// Regression: getCachedFleetGiftStats aggregates gift count + USD revenue.
// Locks the exact SQL column aliases the cache layer reads, so a column rename
// in the query can't silently zero out the dashboard gift metric.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision } from "../helpers/builders";
import { getCachedFleetGiftStats } from "@/lib/cache/dashboard";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("getCachedFleetGiftStats", () => {
  it("sums attributed gift count and USD revenue in the 30-day window", async () => {
    const agent = await createAgent({ status: "active" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // Two attributed gifts: $100 and $50.
    for (const [uid, value] of [["u_g1", 100], ["u_g2", 50]] as const) {
      const d = await createDecision({ agentId: agent.id, userId: uid, messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: `b_${uid}` });
      await prisma.userDecision.update({
        where: { id: d.id },
        data: { conversionEvent: "gift_given", conversionAt: new Date(), conversionValue: value, reward: 0.5 },
      });
    }
    // A non-gift conversion must be excluded from the sums.
    const other = await createDecision({ agentId: agent.id, userId: "u_o", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_o" });
    await prisma.userDecision.update({ where: { id: other.id }, data: { conversionEvent: "plan_started", conversionAt: new Date(), reward: 0.1 } });

    const stats = await getCachedFleetGiftStats();
    expect(stats.giftCount).toBe(2);
    expect(stats.giftRevenue).toBeCloseTo(150, 2);
    expect(stats.leaderboard[0]?.agentId).toBe(agent.id);
    expect(stats.leaderboard[0]?.revenue).toBeCloseTo(150, 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/regression/dashboard-fleet-gift-stats-columns.test.ts`
Expected: FAIL — `getCachedFleetGiftStats` is not exported.

- [ ] **Step 3: Implement `getCachedFleetGiftStats`**

Append to `src/lib/cache/dashboard.ts`:

```ts
/**
 * Fleet gift insight: attributed gift count + USD revenue (SUM of conversionValue)
 * for gift_given decisions in the 30-day window, plus an agent revenue leaderboard.
 * Tagged "dashboard-stats" so the hourly cron refreshes it.
 */
export const getCachedFleetGiftStats = cache(
  unstable_cache(
    async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [totals, leaderboardRows] = await Promise.all([
        prisma.$queryRaw<[{ gift_count: bigint; gift_revenue: number | null }]>`
          SELECT COUNT(*)::bigint                         AS gift_count,
                 COALESCE(SUM("conversionValue"), 0)::float AS gift_revenue
          FROM "UserDecision"
          WHERE "conversionEvent" = 'gift_given'
            AND "conversionAt" >= ${thirtyDaysAgo}
        `,
        prisma.$queryRaw<Array<{ agent_id: string; revenue: number | null; gifts: bigint }>>`
          SELECT "agentId"                                  AS agent_id,
                 COALESCE(SUM("conversionValue"), 0)::float AS revenue,
                 COUNT(*)::bigint                           AS gifts
          FROM "UserDecision"
          WHERE "conversionEvent" = 'gift_given'
            AND "conversionAt" >= ${thirtyDaysAgo}
          GROUP BY "agentId"
          ORDER BY revenue DESC
          LIMIT 5
        `,
      ]);
      const agentIds = leaderboardRows.map((r) => r.agent_id);
      const agents = agentIds.length > 0
        ? await prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, color: true } })
        : [];
      const byId = new Map(agents.map((a) => [a.id, a]));
      return {
        giftCount: Number(totals[0]?.gift_count ?? 0),
        giftRevenue: Number(totals[0]?.gift_revenue ?? 0),
        leaderboard: leaderboardRows.map((r) => ({
          agentId: r.agent_id,
          name: byId.get(r.agent_id)?.name ?? r.agent_id,
          color: byId.get(r.agent_id)?.color ?? "#888888",
          revenue: Number(r.revenue ?? 0),
          gifts: Number(r.gifts),
        })),
      };
    },
    ["fleet-gift-stats"],
    { tags: ["dashboard-stats", "agents"], revalidate: TTL.STANDARD }
  )
);
```

- [ ] **Step 4: Run the regression test to verify it passes**

Run: `bun test tests/regression/dashboard-fleet-gift-stats-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the fleet gift metric card on the dashboard**

In `src/app/page.tsx`, add `getCachedFleetGiftStats` to the existing barrel import from `@/lib/cache` (the block on lines 14-24 that already imports `getCachedFleetRecoveryStats`).

Then in `MetricCardsSection` (line 95-97), add it to the `Promise.all` and destructure it:

```ts
  const [{ sentLast24h, totalConversions, totalDecisions, totalPushSends }, agents, trackedUsers, hiddenStats, recovery, giftStats] =
    await Promise.all([getCachedDashboardCounts(), getCachedAgentList(), getCachedTrackedUserCount(), getHiddenStatsForCurrentUser(), getCachedFleetRecoveryStats(), getCachedFleetGiftStats()]);
```

Add a gift card after the recovery card (after line 115, before the closing `</>`):

```tsx
      {giftStats.giftCount > 0 && !isStatHidden(hiddenStats, "dashboard.gifts") && (
        <MetricCard
          title="Gifts Driven (30d)"
          value={formatNumber(giftStats.giftCount)}
          description={`$${formatNumber(Math.round(giftStats.giftRevenue))} attributed revenue`}
          icon={TrendingUp}
        />
      )}
```

- [ ] **Step 6: Verify the dashboard typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Verify the dashboard renders in the browser**

Run `bun run dev`, open `http://localhost:3000`. Confirm the page renders without error. (The gift card only appears when there is attributed gift data; absence of the card on an empty dev DB is expected — the goal here is no render regression.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/cache/dashboard.ts src/app/page.tsx tests/regression/dashboard-fleet-gift-stats-columns.test.ts
git commit -m "feat(dashboard): fleet gift count + revenue insight"
```

---

### Task 7: Per-agent gift insights (performance page)

Add per-agent gift count, revenue, conversion rate (gifts ÷ sends), and avg time-to-gift, rendered as a section on the agent performance page. The performance page already runs raw aggregates inline (see the `fleetAgg` query at line 124 and the recovery block at 132), so follow that inline pattern.

**Files:**
- Modify: `src/app/agents/[id]/performance/page.tsx`
- Create (test): `tests/regression/agent-gift-metrics-columns.test.ts`

- [ ] **Step 1: Write the failing regression test (exact SQL columns)**

Create `tests/regression/agent-gift-metrics-columns.test.ts`. It imports the new pure helper `agentGiftMetrics` (extracted so the SQL shape is testable without rendering the page):

```ts
// Regression: per-agent gift metrics query. Locks the exact SQL column aliases
// and the derived metrics (count, revenue, conversion rate, avg time-to-gift).
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision } from "../helpers/builders";
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("agentGiftMetrics", () => {
  it("computes count, revenue, conversion rate, and avg time-to-gift", async () => {
    const agent = await createAgent({ status: "active" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

    // 4 sends; 1 becomes an attributed gift 2 days after the send.
    for (const uid of ["a", "b", "c"]) {
      await createDecision({ agentId: agent.id, userId: `u_${uid}`, messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: `b_${uid}` });
    }
    const gift = await createDecision({ agentId: agent.id, userId: "u_gift", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_gift" });
    const conversionAt = new Date(sentAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    await prisma.userDecision.update({
      where: { id: gift.id },
      data: { conversionEvent: "gift_given", conversionAt, conversionValue: 80, reward: 0.6 },
    });

    const m = await agentGiftMetrics(agent.id);
    expect(m.giftCount).toBe(1);
    expect(m.giftRevenue).toBeCloseTo(80, 2);
    // 1 gift ÷ 4 sends = 25%
    expect(m.giftConversionRate).toBeCloseTo(25, 1);
    // avg time-to-gift ≈ 2 days, expressed in hours
    expect(m.avgTimeToGiftHours).toBeCloseTo(48, 0);
  });

  it("returns zeros for an agent with no gifts", async () => {
    const agent = await createAgent({ status: "active" });
    const m = await agentGiftMetrics(agent.id);
    expect(m).toEqual({ giftCount: 0, giftRevenue: 0, giftConversionRate: 0, avgTimeToGiftHours: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/regression/agent-gift-metrics-columns.test.ts`
Expected: FAIL — `@/lib/cache/agent-gift-metrics` does not exist.

- [ ] **Step 3: Implement the `agentGiftMetrics` query helper**

Create `src/lib/cache/agent-gift-metrics.ts`:

```ts
import { prisma } from "@/lib/db";

export type AgentGiftMetrics = {
  giftCount: number;
  giftRevenue: number;
  giftConversionRate: number; // gifts ÷ sends, percent
  avgTimeToGiftHours: number;
};

/**
 * Per-agent gift metrics over the last 30 days: attributed gift count,
 * USD revenue (SUM of conversionValue), conversion rate (gifts ÷ sends), and
 * average time-to-gift in hours (AVG(conversionAt - sentAt) for gift_given).
 */
export async function agentGiftMetrics(agentId: string): Promise<AgentGiftMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<[{
    sends: bigint;
    gift_count: bigint;
    gift_revenue: number | null;
    avg_time_to_gift_seconds: number | null;
  }]>`
    SELECT
      COUNT(*)::bigint                                                                            AS sends,
      COUNT(*) FILTER (WHERE "conversionEvent" = 'gift_given')::bigint                            AS gift_count,
      COALESCE(SUM("conversionValue") FILTER (WHERE "conversionEvent" = 'gift_given'), 0)::float  AS gift_revenue,
      AVG(EXTRACT(EPOCH FROM ("conversionAt" - "sentAt"))) FILTER (WHERE "conversionEvent" = 'gift_given') AS avg_time_to_gift_seconds
    FROM "UserDecision"
    WHERE "agentId" = ${agentId}
      AND "sentAt" >= ${thirtyDaysAgo}
  `;
  const r = rows[0];
  const sends = Number(r?.sends ?? 0);
  const giftCount = Number(r?.gift_count ?? 0);
  return {
    giftCount,
    giftRevenue: Number(r?.gift_revenue ?? 0),
    giftConversionRate: sends > 0 ? (giftCount / sends) * 100 : 0,
    avgTimeToGiftHours: r?.avg_time_to_gift_seconds ? Number(r.avg_time_to_gift_seconds) / 3600 : 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/regression/agent-gift-metrics-columns.test.ts`
Expected: PASS.

- [ ] **Step 5: Call the helper from the performance page and render a gift section**

In `src/app/agents/[id]/performance/page.tsx`, add the import near the other imports (after line 17):

```ts
import { agentGiftMetrics } from "@/lib/cache/agent-gift-metrics";
```

Add the fetch to the re-engagement `Promise.all` region. After the recovery `Promise.all` (ends line 145), add:

```ts
  const giftMetrics = await agentGiftMetrics(id);
```

Render a gift section immediately after the closing of the Re-engagement block (after line 485, before the Per-Persona block at 487):

```tsx
      {giftMetrics.giftCount > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Gifts driven</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gifts</p>
              <p className="text-2xl font-bold mt-1">{formatNumber(giftMetrics.giftCount)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">last 30 days</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gift Revenue</p>
              <p className="text-2xl font-bold mt-1 text-primary">${formatNumber(Math.round(giftMetrics.giftRevenue))}</p>
              <p className="text-xs text-muted-foreground mt-0.5">USD attributed</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Gift Conversion Rate</p>
              <p className="text-2xl font-bold mt-1">{giftMetrics.giftConversionRate.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">gifts ÷ sends</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Avg Time to Gift</p>
              <p className="text-2xl font-bold mt-1">{giftMetrics.avgTimeToGiftHours.toFixed(1)}h</p>
            </CardContent></Card>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Verify typecheck and browser render**

Run: `bun run typecheck` (Expected: PASS).
Run `bun run dev`, open an agent's performance page `http://localhost:3000/agents/<id>/performance`, confirm it renders without error.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cache/agent-gift-metrics.ts src/app/agents/[id]/performance/page.tsx tests/regression/agent-gift-metrics-columns.test.ts
git commit -m "feat(performance): per-agent gift metrics section"
```

---

### Task 8: Per-user gift insight (user inspector)

Add per-user gift attribution to the user API response and render it in the inspector: gifts driven via Nexus (count), total attributed USD, and the most-recent attributed gift's time-to-gift + attributing agent name.

**Files:**
- Modify: `src/app/api/users/[externalId]/route.ts`
- Modify: `src/components/control-tower/user-inspector.tsx`
- Create (test): `tests/integration/user-gift-attribution.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/user-gift-attribution.test.ts`:

```ts
// Integration: GET /api/users/[externalId] returns per-user gift attribution.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createDecision, createTrackedUser } from "../helpers/builders";
import { GET as getUser } from "@/app/api/users/[externalId]/route";
import { NextRequest } from "next/server";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

function call(externalId: string) {
  const req = new NextRequest(`http://localhost:3000/api/users/${externalId}`);
  return getUser(req, { params: Promise.resolve({ externalId }) });
}

describe("GET /api/users/[externalId] gift attribution", () => {
  it("returns gift count, total USD, and most-recent gift detail", async () => {
    await createTrackedUser({ externalId: "u_gift_user" });
    const agent = await createAgent({ status: "active", name: "Giving Agent" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const gift = await createDecision({ agentId: agent.id, userId: "u_gift_user", messageVariantId: variant.id, channel: "push", sentAt, brazeSendId: "b_gu" });
    const conversionAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
    await prisma.userDecision.update({
      where: { id: gift.id },
      data: { conversionEvent: "gift_given", conversionAt, conversionValue: 120, reward: 0.7 },
    });

    const res = await call("u_gift_user");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.gifts.count).toBe(1);
    expect(body.data.gifts.totalUsd).toBeCloseTo(120, 2);
    expect(body.data.gifts.mostRecent.agentName).toBe("Giving Agent");
    expect(body.data.gifts.mostRecent.timeToGiftHours).toBeCloseTo(24, 0);
  });

  it("returns a null gifts.mostRecent when the user has no attributed gifts", async () => {
    await createTrackedUser({ externalId: "u_no_gift" });
    const res = await call("u_no_gift");
    const body = await res.json();
    expect(body.data.gifts.count).toBe(0);
    expect(body.data.gifts.totalUsd).toBe(0);
    expect(body.data.gifts.mostRecent).toBeNull();
  });
});
```

> Before writing this test, confirm `createTrackedUser` exists in `tests/helpers/builders.ts` (`grep -n "createTrackedUser" tests/helpers/builders.ts`). If it does not, use the builder that creates a `TrackedUser` row (check the exports) or insert via `prisma.trackedUser.create` with the minimum required fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/integration/user-gift-attribution.test.ts`
Expected: FAIL — the response has no `gifts` field (currently returns `{ data: { user, recentDecisions, armStats } }`).

- [ ] **Step 3: Add gift aggregation to the user route**

In `src/app/api/users/[externalId]/route.ts`, add two queries to the existing `Promise.all` (lines 21-48). Add after the `armStats` entry:

```ts
      prisma.userDecision.aggregate({
        where: { userId: externalId, conversionEvent: "gift_given" },
        _count: { _all: true },
        _sum: { conversionValue: true },
      }),
      prisma.userDecision.findFirst({
        where: { userId: externalId, conversionEvent: "gift_given", conversionAt: { not: null } },
        orderBy: { conversionAt: "desc" },
        select: {
          sentAt: true,
          conversionAt: true,
          conversionValue: true,
          agent: { select: { name: true } },
        },
      }),
```

and widen the destructure on line 21:

```ts
    const [recentDecisions, totalDecisions, totalConversions, rewardAgg, armStats, giftAgg, mostRecentGift] = await Promise.all([
```

Then build the gift block and add it to the `ok({ ... })` response (after `armStats: enrichedArmStats,` on line 84):

```ts
    const mostRecent = mostRecentGift && mostRecentGift.conversionAt
      ? {
          usd: mostRecentGift.conversionValue ?? 0,
          agentName: mostRecentGift.agent?.name ?? null,
          timeToGiftHours: (mostRecentGift.conversionAt.getTime() - mostRecentGift.sentAt.getTime()) / 3_600_000,
          conversionAt: mostRecentGift.conversionAt.toISOString(),
        }
      : null;
```

```ts
      gifts: {
        count: giftAgg._count._all,
        totalUsd: giftAgg._sum.conversionValue ?? 0,
        mostRecent,
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/integration/user-gift-attribution.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the gift insight in the inspector**

In `src/components/control-tower/user-inspector.tsx`, extend the `UserData` interface (after `armStats: ArmStat[];` on line 53):

```ts
  gifts: {
    count: number;
    totalUsd: number;
    mostRecent: {
      usd: number;
      agentName: string | null;
      timeToGiftHours: number;
      conversionAt: string;
    } | null;
  };
```

Then render a gift summary block. Place it near the user header/stats section (find where `totalConversions` / `totalReward` are rendered and add alongside). Add a conditional block:

```tsx
      {data.gifts.count > 0 && (
        <div className="rounded-lg border p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Gifts via Nexus</p>
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold">{data.gifts.count}</span>
            <span className="text-sm text-muted-foreground">${Math.round(data.gifts.totalUsd)} attributed</span>
          </div>
          {data.gifts.mostRecent && (
            <p className="text-xs text-muted-foreground mt-1">
              Most recent: ${Math.round(data.gifts.mostRecent.usd)}
              {data.gifts.mostRecent.agentName ? ` via ${data.gifts.mostRecent.agentName}` : ""}
              {` · ${data.gifts.mostRecent.timeToGiftHours.toFixed(1)}h to gift`}
            </p>
          )}
        </div>
      )}
```

> The exact placement depends on the inspector's JSX. Read the component to find the user-summary region and insert the block there. If the component is fed `UserData` from a fetch, no other wiring is needed; the new `gifts` field arrives automatically.

- [ ] **Step 6: Verify typecheck and browser render**

Run: `bun run typecheck` (Expected: PASS).
Run `bun run dev`, open the control tower, inspect a user, confirm it renders without error. (Gift block only appears for users with attributed gifts.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/users/[externalId]/route.ts src/components/control-tower/user-inspector.tsx tests/integration/user-gift-attribution.test.ts
git commit -m "feat(user): per-user gift attribution in inspector"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the fast check**

Run: `bun run check:quick`
Expected: typecheck + lint + unit/contract tests all PASS.

- [ ] **Step 2: Run the full check**

Run: `bun run check`
Expected: full integration + regression suite PASS. (The harness auto-backgrounds this; wait for the completion notification — do not poll.)

- [ ] **Step 3: Push and open the MR**

```bash
git push -u origin feat/gift-conversion-attribution
glab mr create --fill --yes
```

Then set auto-merge on green per the standing "push and merge" convention:

```bash
glab mr merge <mr-number> --auto-merge --yes --remove-source-branch
```

---

## Self-Review

**1. Spec coverage:**
- (A) Unify event name → Task 1 ✓ (preset + green set + grep sweep + both tests updated).
- (B) Persist USD-normalized value + migration to both DBs → Task 4 ✓ (schema + prisma migrate dev + neon ALTER on test DB + verify).
- (C) `usdAmount()` helper → Task 2 ✓ (pure, currency table + unknown/blank default, rounds to cents, unit-tested).
- (D) Amount-weighted reward → Task 3 ✓ (log-scaled, tierBase scaling, sanity points $5/$50/$500/$1000, $0→0, clamp).
- (E) Ingest changes → Task 5 ✓ (usd normalize, gift_amount_usd to reward, conversionValue write, dedup guard with per-chunk pre-load).
- (F) Insights at fleet/agent/user → Tasks 6/7/8 ✓ (each with a regression/integration test asserting exact SQL columns or response shape).

**2. Placeholder scan:** No "TBD"/"implement later". The two "depends on the component's JSX" notes in Task 8 Step 5 and the `createTrackedUser` confirmation in Task 8 Step 1 are explicit verification instructions with concrete fallbacks, not deferred work.

**3. Type consistency:**
- `usdAmount(amount: number, currency: string | null)` — defined in Task 2, called identically in Task 5.
- `gift_amount_usd` property key — produced in Task 5 ingest, consumed in Task 3 reward calc and asserted in Task 3 tests.
- `conversionValue` — added in Task 4, written in Task 5, summed in Tasks 6/7/8.
- `getCachedFleetGiftStats` returns `{ giftCount, giftRevenue, leaderboard[] }` — Task 6 test and page render agree.
- `agentGiftMetrics` returns `{ giftCount, giftRevenue, giftConversionRate, avgTimeToGiftHours }` — Task 7 test and page render agree.
- User route `gifts: { count, totalUsd, mostRecent }` — Task 8 test, response, and inspector interface agree.
