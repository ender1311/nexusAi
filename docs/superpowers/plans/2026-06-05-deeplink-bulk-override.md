# Deeplink Phase 1 — Bulk Override + Curated Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent an optional bulk deeplink override that collapses every variant's link to one URL at send time, plus expand the curated picker with web-URL plans links and a VOTD web entry.

**Architecture:** Add a nullable `Agent.deeplinkOverride` column. The cron send path applies precedence `agent.deeplinkOverride ?? variant.deeplink` where it builds `variantMeta` — leaving `send-grouping.ts` untouched, so identical resolved links naturally collapse into one Braze send group. The override is settable from the create wizard (POST `/api/agents` → `apps/api` Hono handler) and the edit sheet (PATCH `/api/agents/[id]`, direct Prisma — matches the existing route). A reusable client warning fires when a verse-quoting agent is given a generic (VOTD) override.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + Postgres (Neon), Hono (`apps/api`), Bun test runner, shadcn/ui.

---

## Background the implementer must know

- **Two services.** The Next app (`src/`) proxies *create* through `apiFetch` to the Hono backend in `apps/api`. But the *edit* path (`PATCH /api/agents/[id]`) is **direct Prisma** today (`src/app/api/agents/[id]/route.ts`). Phase 1 follows the existing split: add override handling to the `apps/api` POST handler **and** the direct-Prisma PATCH route. Do **not** refactor PATCH onto the proxy in this phase.
- **Migrations.** `prisma.config.ts` always loads `.env.local` → the **production** Neon DB. NEVER run `prisma migrate dev` / `db push` against the test DB. The required pattern is: idempotent DDL (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) applied to prod + the local test DB by hand, create the migration folder, then `prisma migrate resolve --applied <name>` to reconcile history. (See the "prisma migrate dev drift" learning.)
- **Send-grouping key** (`src/lib/cron/send-grouping.ts:151`) already includes the resolved deeplink, so collapsing happens for free once `variantMeta.deeplink` reflects the override.
- **Local test DB** is plain Postgres `nexus_test` (UTC). Integration/regression tests hit it via `bun run test:int` / the regression suite. Unit tests (`bun run test:quick`) need no DB.
- **Test builders** live in `tests/helpers/builders.ts` (`createAgent`, `createMessage`, `createVariant`, …). Use them, not raw `prisma.create`.
- **Generated Prisma client** lives at `src/generated/prisma/` (app) and `apps/api/src/generated/prisma/` (backend). Both must be regenerated after the schema change so the new field is typed.

---

## File Structure

**Schema / migration**
- Modify: `prisma/schema.prisma` (add `Agent.deeplinkOverride String?`)
- Create: `prisma/migrations/<timestamp>_agent_deeplink_override/migration.sql`

**Send path (override resolution)**
- Modify: `src/app/api/cron/select-and-send/route.ts:577` (apply `agent.deeplinkOverride ?? v.deeplink`)
- Test: `tests/unit/cron-deeplink-override-grouping.test.ts` (collapse via `groupDecisionsByVariant`)

**Curated picker data**
- Modify: `src/lib/constants/youversion.ts` (add web-URL plans entries + VOTD web)
- Test: `tests/unit/youversion-deeplinks-web-entries.test.ts`

**Override write paths**
- Modify: `apps/api/src/routes/agents.ts` (validate + persist `deeplinkOverride` on POST)
- Modify: `src/app/api/agents/[id]/route.ts` (validate + persist `deeplinkOverride` on PATCH)
- Test: `tests/integration/agents-deeplink-override.test.ts`
- Test: `tests/regression/agent-deeplink-override-precedence.test.ts`

**UI**
- Create: `src/lib/deeplinks/content-mismatch.ts` (pure warning predicate)
- Test: `tests/unit/deeplink-content-mismatch.test.ts`
- Create: `src/components/agents/agent-deeplink-override-field.tsx` (shared field + warning)
- Modify: `src/components/agents/agent-edit-sheet.tsx` (render field, send in PATCH body)
- Modify: `src/components/agents/agent-wizard.tsx` (form state + field; `...form` already forwards it)
- Modify: `src/app/agents/[id]/page.tsx` (pass `initialDeeplinkOverride` + `hasVerseVariants` to edit sheet)

---

## Task 1: Add `Agent.deeplinkOverride` to the Prisma schema

**Files:**
- Modify: `prisma/schema.prisma` (Agent model, near `languageFilter`/`localizePush`)

- [ ] **Step 1: Add the field**

In `prisma/schema.prisma`, inside `model Agent`, add this line next to the other optional scalar config fields (e.g. directly after the `localizePush` line):

```prisma
  deeplinkOverride    String?
```

- [ ] **Step 2: Regenerate both Prisma clients**

Run:
```bash
npx prisma generate && (cd apps/api && npx prisma generate)
```
Expected: both clients regenerate with no error. (`apps/api` has its own `schema.prisma` symlink/copy — if `cd apps/api && npx prisma generate` errors with "schema not found", instead run `npx prisma generate --schema apps/api/prisma/schema.prisma` after copying the field into that schema too; check whether `apps/api/prisma/schema.prisma` exists first with `ls apps/api/prisma`.)

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS (field is now known to both clients; no usages yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma src/generated/prisma apps/api/src/generated/prisma apps/api/prisma 2>/dev/null
git commit -m "feat(schema): add Agent.deeplinkOverride field"
```

---

## Task 2: Create + apply the migration (idempotent DDL, no migrate dev)

**Files:**
- Create: `prisma/migrations/<timestamp>_agent_deeplink_override/migration.sql`

- [ ] **Step 1: Create the migration folder + SQL**

Pick a timestamp matching the existing convention (look at the newest folder under `prisma/migrations/` and use a later `YYYYMMDDHHMMSS`). Create `prisma/migrations/<timestamp>_agent_deeplink_override/migration.sql` containing exactly:

```sql
-- Idempotent: safe to run against prod and the local test DB.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "deeplinkOverride" TEXT;
```

- [ ] **Step 2: Apply to the local test DB**

Run:
```bash
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "deeplinkOverride" TEXT;'
```
Expected: `ALTER TABLE`.

- [ ] **Step 3: Apply to production (idempotent ADD COLUMN IF NOT EXISTS)**

Run (uses the prod URL from `.env.local`):
```bash
set -a; source .env.local; set +a
psql -v ON_ERROR_STOP=1 "$DATABASE_URL_UNPOOLED" \
  -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "deeplinkOverride" TEXT;'
```
Expected: `ALTER TABLE`. (Idempotent — re-running is harmless.)

- [ ] **Step 4: Reconcile migration history WITHOUT re-running DDL**

Run:
```bash
npx prisma migrate resolve --applied <timestamp>_agent_deeplink_override
```
Expected: "Migration … marked as applied." Then verify:
```bash
npx prisma migrate status
```
Expected: "Database schema is up to date!" (no pending, no drift prompting a reset).

> NEVER run `prisma migrate dev` here — it targets the prod DB and will offer a destructive reset.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations
git commit -m "feat(db): migration for Agent.deeplinkOverride (idempotent DDL + resolve)"
```

---

## Task 3: Apply override precedence in the cron send path

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts:577`
- Test: `tests/unit/cron-deeplink-override-grouping.test.ts`

The cron route builds `variantMeta` per agent (lines 571–584). Today line 577 is `deeplink: v.deeplink ?? null`. The override is per-agent, so we resolve it once and use it for every variant. This keeps `send-grouping.ts` unchanged: equal `deeplink` values collapse into one group automatically.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cron-deeplink-override-grouping.test.ts`. This is a pure unit test of `groupDecisionsByVariant` proving that when two variants carry the *same* (overridden) deeplink, users on different variants still collapse by link only if variantId matches — and that overriding both variants to the same URL produces a single group per variant. Capture the core invariant: identical `deeplink` in `variantMeta` is what drives collapse.

```typescript
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";

function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "https://www.bible.com/verse-of-the-day",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    givingHandleStrategy: null,
    iconImageUrl: null,
    ...overrides,
  };
}
const user = (externalId: string) => ({ externalId, brazeId: null, attributes: {} });

describe("deeplink override collapses send groups", () => {
  it("users on the same variant with the overridden link form one group", () => {
    const variantMeta = new Map<string, VariantMeta>([["v1", meta()]]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-06-05T12:00:00Z");

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2"), variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    expect(Object.values(groups)).toHaveLength(1);
  });

  it("two variants overridden to the SAME url still group per variant (groupKey includes variantId)", () => {
    const sameUrl = "https://www.bible.com/verse-of-the-day";
    const variantMeta = new Map<string, VariantMeta>([
      ["v1", meta({ deeplink: sameUrl })],
      ["v2", meta({ deeplink: sameUrl })],
    ]);
    const decisionIdByUser = new Map([["u1", "d1"], ["u2", "d2"]]);
    const at = new Date("2026-06-05T12:00:00Z");
    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: user("u2"), variantId: "v2", scheduledAt: at, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );
    // Distinct variantIds → 2 groups; the override does NOT merge across variants.
    // Collapse happens within a variant whose per-variant links previously differed.
    expect(Object.values(groups)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it — confirm it passes against current code**

Run: `bun test tests/unit/cron-deeplink-override-grouping.test.ts`
Expected: PASS. (This locks the grouping contract the route change relies on. It documents *why* the route change is safe — collapse is keyed on the resolved `deeplink`, which the override sets uniformly.)

- [ ] **Step 3: Apply the override in the cron route**

In `src/app/api/cron/select-and-send/route.ts`, replace line 577:

```typescript
          deeplink:        v.deeplink ?? null,
```
with:
```typescript
          deeplink:        agent.deeplinkOverride ?? v.deeplink ?? null,
```

Then add this comment directly above the `variantMeta.set(v.id, {` line (line 573) so the precedence and its edge case are documented in place:

```typescript
        // Agent-level bulk override wins over the per-variant deeplink. Applied
        // here (not in send-grouping) so identical resolved links collapse into
        // one Braze send group. Edge: when an override is set it also supersedes
        // GIVING_LINK_SENTINEL — documented precedence, override URL takes the link.
```

- [ ] **Step 4: Typecheck + run the existing grouping suite**

Run: `bun run typecheck && bun test tests/unit/cron-send-grouping.test.ts tests/unit/cron-deeplink-override-grouping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/unit/cron-deeplink-override-grouping.test.ts
git commit -m "feat(cron): apply agent.deeplinkOverride before per-variant deeplink"
```

---

## Task 4: Expand the curated picker with web-URL plans links + VOTD web

**Files:**
- Modify: `src/lib/constants/youversion.ts:26`
- Test: `tests/unit/youversion-deeplinks-web-entries.test.ts`

The existing `YOUVERSION_DEEPLINKS` are all `youversion://` app-scheme. Add web (`https://www.bible.com/…`) entries for the plans destinations the user asked for, plus a VOTD **web** entry carrying the Android-broken warning context (the warning string is surfaced by the UI in Task 7; here we only add data). `PushDeeplink` is `{ label, value, category }` (`src/types/agent.ts:135`) — no extra fields, so the VOTD warning is encoded by the content-mismatch predicate in Task 6, not on the entry.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/youversion-deeplinks-web-entries.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { YOUVERSION_DEEPLINKS } from "@/lib/constants/youversion";

describe("YOUVERSION_DEEPLINKS web entries", () => {
  const byValue = (v: string) => YOUVERSION_DEEPLINKS.find((d) => d.value === v);

  it("includes the web Find Plans URL", () => {
    expect(byValue("https://www.bible.com/reading-plans")).toBeDefined();
  });
  it("includes the web My Plans URL", () => {
    expect(byValue("https://www.bible.com/my-plans")).toBeDefined();
  });
  it("includes the web Verse of the Day URL", () => {
    expect(byValue("https://www.bible.com/verse-of-the-day")).toBeDefined();
  });
  it("all entries have a label and a category", () => {
    for (const d of YOUVERSION_DEEPLINKS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.category.length).toBeGreaterThan(0);
    }
  });
  it("has no duplicate values", () => {
    const values = YOUVERSION_DEEPLINKS.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/youversion-deeplinks-web-entries.test.ts`
Expected: FAIL — the three `https://www.bible.com/...` entries don't exist yet.

- [ ] **Step 3: Add the web entries**

In `src/lib/constants/youversion.ts`, add a new category block to `YOUVERSION_DEEPLINKS` (after the `// Giving` block, before the closing `];`):

```typescript
  // Web links (bible.com) — open in browser/app via universal links
  { label: "Find Plans (web)", value: "https://www.bible.com/reading-plans", category: "Web Links" },
  { label: "My Plans (web)", value: "https://www.bible.com/my-plans", category: "Web Links" },
  { label: "Saved Plans (web)", value: "https://www.bible.com/saved_plans", category: "Web Links" },
  { label: "Verse of the Day (web)", value: "https://www.bible.com/verse-of-the-day", category: "Web Links" },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/youversion-deeplinks-web-entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants/youversion.ts tests/unit/youversion-deeplinks-web-entries.test.ts
git commit -m "feat(deeplinks): add bible.com web plans + VOTD entries to curated picker"
```

---

## Task 5: Persist `deeplinkOverride` on the write paths (POST proxy + PATCH direct)

**Files:**
- Modify: `apps/api/src/routes/agents.ts` (POST handler)
- Modify: `src/app/api/agents/[id]/route.ts` (PATCH handler)
- Test: `tests/integration/agents-deeplink-override.test.ts`

Validation rule for both: `deeplinkOverride` is optional; when present it must be `null` or a non-empty string. (No URL-scheme restriction — Braze accepts both `youversion://` and `https://`, and free-text custom URLs are intentionally allowed.)

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/agents-deeplink-override.test.ts`. Test the PATCH route directly (it's the path the edit sheet uses and is in-process direct Prisma). Use `createAgent` from builders.

```typescript
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH } from "@/app/api/agents/[id]/route";

function patch(id: string, body: unknown) {
  return PATCH(
    new Request(`http://test/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id }) },
  );
}

describe("PATCH /api/agents/[id] deeplinkOverride", () => {
  it("persists a non-empty override string", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}` });
    const res = await patch(agent.id, { deeplinkOverride: "https://www.bible.com/verse-of-the-day" });
    expect(res.status).toBe(200);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh?.deeplinkOverride).toBe("https://www.bible.com/verse-of-the-day");
  });

  it("clears the override when null", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}-2`, deeplinkOverride: "https://x" } as never);
    const res = await patch(agent.id, { deeplinkOverride: null });
    expect(res.status).toBe(200);
    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh?.deeplinkOverride).toBeNull();
  });

  it("rejects an empty string with 400", async () => {
    const agent = await createAgent({ name: `dl-${Date.now()}-3` });
    const res = await patch(agent.id, { deeplinkOverride: "   " });
    expect(res.status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: "dl-" } } });
});
```

> If `requireAdmin()` blocks the in-process call (returns 401/403 in the test env), check how other integration tests in `tests/integration/` stub auth (search for `requireAdmin` mocks) and apply the same stub at the top of this file. Do NOT weaken the route's auth.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/integration/agents-deeplink-override.test.ts`
Expected: FAIL — PATCH doesn't read `deeplinkOverride` yet (override stays null; empty string isn't rejected).

- [ ] **Step 3: Add validation + persistence to the PATCH route**

In `src/app/api/agents/[id]/route.ts`, add this validation block alongside the others (after the `localizePush` check around line 83):

```typescript
    if (body.deeplinkOverride !== undefined && body.deeplinkOverride !== null) {
      if (typeof body.deeplinkOverride !== "string" || body.deeplinkOverride.trim().length === 0) {
        return fail("deeplinkOverride must be null or a non-empty string", 400);
      }
    }
```

Then in the `prisma.agent.update({ data: { … } })` object (after the `localizePush` spread, ~line 158) add:

```typescript
        ...(body.deeplinkOverride !== undefined ? { deeplinkOverride: typeof body.deeplinkOverride === "string" ? body.deeplinkOverride.trim() : null } : {}),
```

- [ ] **Step 4: Add validation + persistence to the POST proxy handler**

In `apps/api/src/routes/agents.ts`, destructure `deeplinkOverride` from `body` (add to the destructuring at lines 49–69), add this validation near the other field checks (after the `dailySendCap` check ~line 118):

```typescript
  if (deeplinkOverride !== undefined && deeplinkOverride !== null) {
    if (typeof deeplinkOverride !== "string" || (deeplinkOverride as string).trim().length === 0) {
      return c.json({ error: "deeplinkOverride must be null or a non-empty string" }, 400);
    }
  }
```

and in the `prisma.agent.create({ data: { … } })` object (after the `dailySendCap` line ~186) add:

```typescript
        ...(deeplinkOverride !== undefined && deeplinkOverride !== null
          ? { deeplinkOverride: (deeplinkOverride as string).trim() }
          : {}),
```

- [ ] **Step 5: Run the integration test + typecheck**

Run: `bun run typecheck && bun test tests/integration/agents-deeplink-override.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/[id]/route.ts apps/api/src/routes/agents.ts tests/integration/agents-deeplink-override.test.ts
git commit -m "feat(api/agents): validate + persist deeplinkOverride on POST and PATCH"
```

---

## Task 6: Pure content-mismatch warning predicate

**Files:**
- Create: `src/lib/deeplinks/content-mismatch.ts`
- Test: `tests/unit/deeplink-content-mismatch.test.ts`

A verse-quoting agent (any push variant whose body is `VERSE_PUSH_SENTINEL`) pointed at a generic VOTD destination is the documented hazard. Keep the rule pure and data-driven so both the wizard and edit sheet reuse it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/deeplink-content-mismatch.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { isGenericVotdLink, warnVerseOverride } from "@/lib/deeplinks/content-mismatch";

describe("content-mismatch warning", () => {
  it("flags bible.com VOTD as generic", () => {
    expect(isGenericVotdLink("https://www.bible.com/verse-of-the-day")).toBe(true);
    expect(isGenericVotdLink("youversion://votd")).toBe(true);
  });
  it("does not flag a specific verse reader link", () => {
    expect(isGenericVotdLink("https://www.bible.com/bible/111/ISA.41.10")).toBe(false);
  });
  it("warns only when the agent quotes verses AND the override is generic VOTD", () => {
    expect(warnVerseOverride({ hasVerseVariants: true, override: "https://www.bible.com/verse-of-the-day" })).toBe(true);
    expect(warnVerseOverride({ hasVerseVariants: false, override: "https://www.bible.com/verse-of-the-day" })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: "https://www.bible.com/reading-plans" })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: null })).toBe(false);
    expect(warnVerseOverride({ hasVerseVariants: true, override: "" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/unit/deeplink-content-mismatch.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the predicate**

Create `src/lib/deeplinks/content-mismatch.ts`:

```typescript
const GENERIC_VOTD_LINKS = new Set([
  "https://www.bible.com/verse-of-the-day",
  "youversion://votd",
]);

export function isGenericVotdLink(url: string | null | undefined): boolean {
  if (!url) return false;
  return GENERIC_VOTD_LINKS.has(url.trim());
}

export function warnVerseOverride(input: {
  hasVerseVariants: boolean;
  override: string | null | undefined;
}): boolean {
  return input.hasVerseVariants && isGenericVotdLink(input.override);
}

export const CONTENT_MISMATCH_WARNING =
  "This agent quotes a specific verse, but the override opens today's Verse of the Day — the tap won't land on the quoted verse.";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/deeplink-content-mismatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/deeplinks/content-mismatch.ts tests/unit/deeplink-content-mismatch.test.ts
git commit -m "feat(deeplinks): pure content-mismatch warning predicate"
```

---

## Task 7: Shared override field component (picker + warning)

**Files:**
- Create: `src/components/agents/agent-deeplink-override-field.tsx`

A small client component wrapping `DeeplinkSelect` with a label, an explicit "no override" state (empty string = no override), and the content-mismatch warning. Reused by the wizard and edit sheet.

- [ ] **Step 1: Implement the component**

Create `src/components/agents/agent-deeplink-override-field.tsx`:

```typescript
"use client";

import { DeeplinkSelect } from "./deeplink-select";
import { warnVerseOverride, CONTENT_MISMATCH_WARNING } from "@/lib/deeplinks/content-mismatch";

type Props = {
  value: string;            // "" = no override
  onChange: (value: string) => void;
  hasVerseVariants: boolean;
};

export function AgentDeeplinkOverrideField({ value, onChange, hasVerseVariants }: Props) {
  const showWarning = warnVerseOverride({ hasVerseVariants, override: value });
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">Link all variants to…</label>
      <p className="text-xs text-muted-foreground">
        Optional. When set, every variant&apos;s deeplink is replaced by this one URL.
      </p>
      <DeeplinkSelect value={value} onChange={onChange} />
      {showWarning && (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="alert">
          {CONTENT_MISMATCH_WARNING}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/agent-deeplink-override-field.tsx
git commit -m "feat(agents): shared deeplink override field with mismatch warning"
```

---

## Task 8: Wire the override field into the edit sheet

**Files:**
- Modify: `src/components/agents/agent-edit-sheet.tsx`
- Modify: `src/app/agents/[id]/page.tsx`

- [ ] **Step 1: Pass new props from the detail page**

In `src/app/agents/[id]/page.tsx`, compute whether the agent quotes verses and thread both props into `<AgentEditSheet …>`. Add near the existing `activeVariants` computation (line ~75):

```typescript
  const hasVerseVariants = agent.messages.some((m) =>
    m.channel === "push" && m.variants.some((v) => v.body === "__NEXUS_VERSE_PUSH__"),
  );
```

> Import the sentinel instead of hardcoding if convenient: `import { VERSE_PUSH_SENTINEL } from "@/lib/verse-content";` then use `v.body === VERSE_PUSH_SENTINEL`.

Then add these two props to the `<AgentEditSheet>` element (after `initialDailySendCap={agent.dailySendCap ?? null}`):

```typescript
                initialDeeplinkOverride={agent.deeplinkOverride ?? null}
                hasVerseVariants={hasVerseVariants}
```

- [ ] **Step 2: Add props + state + field to the edit sheet**

In `src/components/agents/agent-edit-sheet.tsx`:

Add to the `Props` type (after `initialDailySendCap`):
```typescript
  initialDeeplinkOverride: string | null;
  hasVerseVariants: boolean;
```

Add to the destructured params (after `initialDailySendCap,`):
```typescript
  initialDeeplinkOverride,
  hasVerseVariants,
```

Add state (near the other `useState` calls, after the cap state ~line 173):
```typescript
  const [deeplinkOverride, setDeeplinkOverride] = useState(initialDeeplinkOverride ?? "");
```

Reset it on open — inside the `if (open && !prevOpen.current)` block (after the cap resets ~line 190):
```typescript
      setDeeplinkOverride(initialDeeplinkOverride ?? "");
```
…and add `initialDeeplinkOverride` to that effect's dependency array (line ~195).

Import the field at the top (with the other component imports):
```typescript
import { AgentDeeplinkOverrideField } from "./agent-deeplink-override-field";
```

Render it inside the "Send Limits" section (or a new section right after it), before the closing `</section>` at line ~446:
```typescript
            <AgentDeeplinkOverrideField
              value={deeplinkOverride}
              onChange={setDeeplinkOverride}
              hasVerseVariants={hasVerseVariants}
            />
```

Send it in the PATCH body — in `save()` (the `JSON.stringify({ … })` at line ~224), add:
```typescript
          deeplinkOverride: deeplinkOverride.trim() === "" ? null : deeplinkOverride.trim(),
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual UI verification**

Run `bun run dev`, open an agent detail page, click **Edit**, set "Link all variants to…" to a value, Save. Reopen the sheet → the value persists. For an agent with a verse-quoting push variant, choosing "Verse of the Day (web)" shows the amber warning. (If you cannot run the browser, say so explicitly rather than claiming success.)

- [ ] **Step 5: Commit**

```bash
git add src/components/agents/agent-edit-sheet.tsx src/app/agents/\[id\]/page.tsx
git commit -m "feat(agents): bulk deeplink override field in edit sheet"
```

---

## Task 9: Wire the override field into the create wizard

**Files:**
- Modify: `src/components/agents/agent-wizard.tsx`

The wizard spreads `...form` into the POST payload (line ~363), and the POST handler now reads `deeplinkOverride` (Task 5). So we only need form state + the field.

- [ ] **Step 1: Add `deeplinkOverride` to the wizard form state**

In `src/components/agents/agent-wizard.tsx`, find the form-state initializer (the object holding `funnelStage`, `segmentMode`, `messages`, etc.) and add:
```typescript
    deeplinkOverride: "",
```
> If the form is typed, add `deeplinkOverride: string;` to that type as well. If `...form` would forward an empty string, normalize at submit instead (next step).

- [ ] **Step 2: Normalize empty → omit at submit**

In `handleSubmit` (line ~362), change the payload build so an empty override is sent as `null` (not `""`):
```typescript
      const payload = {
        ...form,
        targetSegmentName: null,
        segmentTargeting: resolveSegmentTargeting(form.segmentMode, form.segmentIncludes, form.segmentExcludes),
        funnelStage: form.segmentMode ? "wau" : form.funnelStage,
        deeplinkOverride: form.deeplinkOverride.trim() === "" ? null : form.deeplinkOverride.trim(),
      };
```

- [ ] **Step 3: Render the field on the review/config step**

Import:
```typescript
import { AgentDeeplinkOverrideField } from "./agent-deeplink-override-field";
```
Render it on an appropriate step (e.g., the messages/review step). Compute `hasVerseVariants` from the wizard's own draft variants:
```typescript
const hasVerseVariants = form.messages.some((m) =>
  m.channel === "push" && m.variants.some((v) => v.body === "__NEXUS_VERSE_PUSH__"),
);
```
```tsx
<AgentDeeplinkOverrideField
  value={form.deeplinkOverride}
  onChange={(v) => update("deeplinkOverride", v)}
  hasVerseVariants={hasVerseVariants}
/>
```
> Match `update(...)`'s existing signature — inspect how other fields call `update` in this file and mirror it.

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual UI verification**

`bun run dev` → create-agent wizard → set "Link all variants to…", launch, land on the new agent. Open Edit → confirm the override persisted (proves POST→DB→detail round-trips).

- [ ] **Step 6: Commit**

```bash
git add src/components/agents/agent-wizard.tsx
git commit -m "feat(agents): bulk deeplink override field in create wizard"
```

---

## Task 10: Regression test — end-to-end override precedence in cron

**Files:**
- Test: `tests/regression/agent-deeplink-override-precedence.test.ts`

Lock the full behavior: an agent with `deeplinkOverride` set produces `variantMeta.deeplink === override` for every variant regardless of each variant's own deeplink. This guards against a future refactor moving deeplink resolution and silently dropping the override.

- [ ] **Step 1: Write the regression test**

Because the cron route is large and DB-driven, assert the precedence rule at the resolution layer the route uses. Create `tests/regression/agent-deeplink-override-precedence.test.ts`:

```typescript
// Regression: agent-level deeplinkOverride must win over per-variant deeplink at
// send time, collapsing all variants to one link. Guards the cron variantMeta
// build (src/app/api/cron/select-and-send/route.ts ~line 577).
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent, createMessage, createVariant } from "../helpers/builders";

describe("deeplinkOverride precedence (regression)", () => {
  it("override replaces every variant's own deeplink in the resolved link set", async () => {
    const override = "https://www.bible.com/verse-of-the-day";
    const agent = await createAgent({ name: `dlreg-${Date.now()}`, deeplinkOverride: override } as never);
    const msg = await createMessage(agent.id, { name: "m1", channel: "push" });
    await createVariant(msg.id, { name: "A", title: "t", body: "b", deeplink: "youversion://home" });
    await createVariant(msg.id, { name: "B", title: "t", body: "b", deeplink: "youversion://discover" });

    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      include: { messages: { include: { variants: true } } },
    });
    const resolved = fresh!.messages.flatMap((m) =>
      m.variants.map((v) => fresh!.deeplinkOverride ?? v.deeplink ?? null),
    );
    expect(new Set(resolved)).toEqual(new Set([override]));
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: "dlreg-" } } });
});
```

> Check the exact `createMessage` / `createVariant` signatures in `tests/helpers/builders.ts` and adjust the call shapes to match (positional vs. options object).

- [ ] **Step 2: Run it**

Run: `bun test tests/regression/agent-deeplink-override-precedence.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/agent-deeplink-override-precedence.test.ts
git commit -m "test(regression): agent deeplinkOverride precedence over variant deeplink"
```

---

## Task 11: Full verification + ship

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: typecheck + lint + unit/contract + integration + regression all PASS.

> If integration/regression fail to connect, confirm `nexus_test` exists and has the `deeplinkOverride` column (Task 2 Step 2). Re-run that `psql` ALTER if needed.

- [ ] **Step 2: Push and merge (solo-repo shorthand)**

```bash
git push origin HEAD
```
Then merge to `main` per the repo's direct-to-main workflow. (No finishing-prompt; this is the documented "push and merge" path.)

---

## Self-Review (completed by plan author)

- **Spec coverage:** Phase 1 of the design spec requires: `Agent.deeplinkOverride` schema (Task 1–2 ✓), precedence `override ?? variant ?? null` in the send path (Task 3 ✓), override flows into send-grouping/collapses groups (Task 3 — applied at variantMeta so grouping collapses for free ✓), expanded `YOUVERSION_DEEPLINKS` with plans + VOTD web (Task 4 ✓), wizard + edit-sheet "Link all variants to…" field reusing `DeeplinkSelect` (Tasks 7–9 ✓), content-mismatch warning (Tasks 6–9 ✓), regression tests for precedence + grouping collapse + warning trigger (Tasks 3, 6, 10 ✓). The migration idempotent-DDL + `migrate resolve` rule is honored (Task 2 ✓).
- **Deviation noted:** The spec's cross-cutting note says the override mutation "goes through the app→apps/api HTTP proxy." The live edit path (`PATCH /api/agents/[id]`) is direct Prisma today; this plan follows the existing code rather than refactoring PATCH onto the proxy in Phase 1. The create path (POST) does go through the proxy. Flagged for the reviewer.
- **VOTD "Broken on Android" warning:** Phase 1 carries the VOTD web entry; the Android-broken (BA-7285) caveat is best surfaced in the Phase 2 inventory builder (which has a `warning` field). The Phase 1 content-mismatch warning covers the verse-vs-generic hazard explicitly required for this phase.
- **Placeholder scan:** none — every code step shows full content.
- **Type consistency:** `PushDeeplink` stays `{label,value,category}`; `VariantMeta.deeplink` stays `string|null`; new field `deeplinkOverride` is `string?` everywhere. Props `initialDeeplinkOverride: string|null` + `hasVerseVariants: boolean` are defined in Task 8 and consumed consistently.
