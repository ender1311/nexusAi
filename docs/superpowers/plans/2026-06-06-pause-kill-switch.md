# Temporary Pause + Kill Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully reversible per-agent "pause sending" flag plus a global "kill switch", surfaced as synced toggles on agent cards, the agent detail page, and the Control Tower, without disrupting any cohort, assignment, or bandit state.

**Architecture:** New orthogonal `Agent.sendingPaused` boolean gates the cron send loop per agent; a global `AppSetting` key `global_sending_paused` short-circuits the whole cron. Neither path touches the cohort-release logic, so learning is preserved and resume is exact. All UI toggles read the same server-rendered source of truth and `router.refresh()` after mutating, so they stay in sync.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon), sonner toasts, shadcn/ui, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-06-06-pause-kill-switch-design.md`

---

## File Structure

- `prisma/schema.prisma` — add `sendingPaused` to `Agent` model.
- `prisma/migrations/<ts>_agent_sending_paused/migration.sql` — idempotent DDL.
- `src/types/agent.ts` — add `sendingPaused: boolean` to `Agent` interface.
- `tests/helpers/builders.ts` — `createAgent` accepts `sendingPaused?: boolean`.
- `src/app/api/agents/[id]/route.ts` — validate + persist `sendingPaused`; must NOT enter `releasesCohort`.
- `src/app/api/cron/select-and-send/route.ts` — kill-switch short-circuit + per-agent filter.
- `src/components/agents/agent-pause-toggle.tsx` — NEW shared per-agent pause button.
- `src/components/agents/agent-card.tsx` — render pause toggle (admin-only).
- `src/components/agents/agent-grid.tsx` — thread `isAdmin` prop.
- `src/app/agents/page.tsx` — pass `isAdmin` to grid; render `KillSwitchToggle`; read global flag.
- `src/app/agents/[id]/page.tsx` — render pause toggle beside status toggle.
- `src/components/control-tower/kill-switch-toggle.tsx` — NEW shared global kill switch.
- `src/components/control-tower/agent-toggle-grid.tsx` — repoint to `sendingPaused`.
- `src/lib/cache/agents.ts` — add `sendingPaused` to `getCachedControlTowerAgents` select.
- `src/app/control-tower/page.tsx` — render `KillSwitchToggle`; read global flag.
- Tests in `tests/regression/`, `tests/integration/`.

**Branch:** all work on `feat/pause-kill-switch` (already created, spec committed).

---

## Task 1: Schema + prod-safe migration

**Files:**
- Modify: `prisma/schema.prisma` (Agent model, after `deeplinkOverride` ~line 30)
- Create: `prisma/migrations/<timestamp>_agent_sending_paused/migration.sql`

> **IMPORTANT (prod safety):** NEVER run `npx prisma migrate dev` — `prisma.config.ts`
> loads `.env.local` (prod Neon) and `migrate dev` would attempt a destructive reset
> on drift. Use idempotent DDL applied to BOTH databases + `migrate resolve --applied`.

- [ ] **Step 1: Add the field to the schema**

In `prisma/schema.prisma`, in `model Agent`, immediately after the `deeplinkOverride String?` line, add:

```prisma
  sendingPaused       Boolean   @default(false) // temporary pause-sending gate; orthogonal to status, never resets cohort
```

- [ ] **Step 2: Create the migration folder + SQL**

```bash
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_agent_sending_paused
```
Then create `migration.sql` in that folder with:

```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sendingPaused" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Apply idempotent DDL to prod + test DBs**

```bash
psql -v ON_ERROR_STOP=1 "$DATABASE_URL_UNPOOLED" \
  -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sendingPaused" BOOLEAN NOT NULL DEFAULT false;'
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -c 'ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sendingPaused" BOOLEAN NOT NULL DEFAULT false;'
```
Expected: `ALTER TABLE` printed twice (or `NOTICE: column already exists, skipping`).

- [ ] **Step 4: Reconcile migration history + regenerate client**

```bash
npx prisma migrate resolve --applied <timestamp>_agent_sending_paused
npx prisma generate
```
Expected: "Migration marked as applied" + "Generated Prisma Client".

- [ ] **Step 5: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: no errors (the generated client now has `sendingPaused`).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): add Agent.sendingPaused flag (orthogonal to status)"
```

---

## Task 2: Add `sendingPaused` to the Agent TS type + test builder

**Files:**
- Modify: `src/types/agent.ts` (Agent interface, line 65)
- Modify: `tests/helpers/builders.ts` (createAgent overrides)

- [ ] **Step 1: Add to the Agent interface**

In `src/types/agent.ts`, inside `export interface Agent {`, add (next to `status`):

```ts
  sendingPaused: boolean;
```

- [ ] **Step 2: Add the builder override**

In `tests/helpers/builders.ts`, find the `createAgent` overrides type and add `sendingPaused?: boolean;`. Ensure the field is passed through to `prisma.agent.create` data (Prisma defaults it to `false` when omitted, so only thread it if the overrides object already spreads through; if the builder uses an explicit field list, add `sendingPaused: overrides.sendingPaused ?? false`).

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/agent.ts tests/helpers/builders.ts
git commit -m "feat(types): thread sendingPaused through Agent type + test builder"
```

---

## Task 3: PATCH API — persist `sendingPaused` without releasing cohort

**Files:**
- Modify: `src/app/api/agents/[id]/route.ts` (validation block ~line 85; releasesCohort ~134-139; update data ~151-175)
- Test: `tests/regression/agent-pause-preserves-cohort.test.ts` (NEW)
- Test: `tests/integration/agent-patch-sending-paused.test.ts` (NEW)

- [ ] **Step 1: Write the regression test (core guarantee)**

Create `tests/regression/agent-pause-preserves-cohort.test.ts`:

```ts
// Regression: pausing an agent (sendingPaused=true) must NOT release the cohort.
// Guards src/app/api/agents/[id]/route.ts — sendingPaused must stay OUT of the
// releasesCohort predicate (lines ~134-139). Spec:
// docs/superpowers/specs/2026-06-06-pause-kill-switch-design.md
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";

const PREFIX = "pausereg-";

describe("pause preserves cohort (regression)", () => {
  it("PATCH sendingPaused=true leaves locks, assignment, cohortAssignedAt, arm stats intact", async () => {
    const agent = await createAgent({ name: `${PREFIX}${Date.now()}`, status: "active" });
    const ext = `${PREFIX}user-${Date.now()}`;
    const cohortAt = new Date("2026-06-01T00:00:00Z");
    await prisma.agent.update({ where: { id: agent.id }, data: { cohortAssignedAt: cohortAt } });
    await prisma.trackedUser.create({
      data: { externalId: ext, brazeId: ext, funnelStage: "wau", lockedByAgentId: agent.id },
    });
    await prisma.userAgentAssignment.create({
      data: { externalUserId: ext, agentId: agent.id },
    });
    await prisma.personaArmStats.create({
      data: { agentId: agent.id, personaId: "p1", variantId: "v1", alpha: 5, beta: 3 },
    });

    const req = new NextRequest("http://localhost/api/agents/x", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendingPaused: true }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(200);

    const fresh = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect(fresh!.sendingPaused).toBe(true);
    expect(fresh!.cohortAssignedAt?.toISOString()).toBe(cohortAt.toISOString());

    const tu = await prisma.trackedUser.findUnique({ where: { externalId: ext } });
    expect(tu!.lockedByAgentId).toBe(agent.id);

    const asg = await prisma.userAgentAssignment.findUnique({ where: { externalUserId: ext } });
    expect(asg!.releasedAt).toBeNull();

    const arm = await prisma.personaArmStats.findFirst({ where: { agentId: agent.id } });
    expect(arm!.alpha).toBe(5);
    expect(arm!.beta).toBe(3);
  });
});

afterAll(async () => {
  await prisma.userAgentAssignment.deleteMany({ where: { externalUserId: { startsWith: PREFIX } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });
  await prisma.personaArmStats.deleteMany({ where: { agentId: { in: (await prisma.agent.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } })).map((a) => a.id) } } });
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
```

> Note: `requireAdmin()` runs inside PATCH. Check how other integration/regression
> tests calling route handlers directly satisfy auth (e.g. grep
> `tests/regression` for existing PATCH/route-handler tests and mirror their auth
> setup — likely a mocked session helper). Mirror that exact pattern here and in Step's
> integration test before running.

- [ ] **Step 2: Run the test, expect FAIL**

Run: `bun test tests/regression/agent-pause-preserves-cohort.test.ts`
Expected: FAIL — `sendingPaused` not yet accepted/persisted (or 400 invalid field), so `fresh.sendingPaused` is `false`.

- [ ] **Step 3: Add validation**

In `src/app/api/agents/[id]/route.ts`, after the `deeplinkOverride` validation block (~line 89), add:

```ts
    if (body.sendingPaused !== undefined && typeof body.sendingPaused !== "boolean") {
      return fail("Invalid sendingPaused", 400);
    }
```

- [ ] **Step 4: Persist it (NOT in releasesCohort)**

In the same file, in the `prisma.agent.update` `data` object (after the `deeplinkOverride` spread, ~line 172), add:

```ts
        ...(body.sendingPaused !== undefined ? { sendingPaused: body.sendingPaused } : {}),
```

Do NOT add `sendingPaused` to the `releasesCohort` predicate at lines ~134-139. Leave that predicate exactly as-is.

- [ ] **Step 5: Run regression test, expect PASS**

Run: `bun test tests/regression/agent-pause-preserves-cohort.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the integration test**

Create `tests/integration/agent-patch-sending-paused.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";
import { PATCH } from "@/app/api/agents/[id]/route";
import { NextRequest } from "next/server";

const PREFIX = "pauseint-";

function patch(id: string, body: unknown) {
  const req = new NextRequest("http://localhost/api/agents/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe("PATCH sendingPaused (integration)", () => {
  it("round-trips true then false", async () => {
    const agent = await createAgent({ name: `${PREFIX}${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { sendingPaused: true })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.sendingPaused).toBe(true);
    expect((await patch(agent.id, { sendingPaused: false })).status).toBe(200);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }))!.sendingPaused).toBe(false);
  });

  it("rejects non-boolean with 400", async () => {
    const agent = await createAgent({ name: `${PREFIX}b-${Date.now()}`, status: "active" });
    expect((await patch(agent.id, { sendingPaused: "yes" })).status).toBe(400);
  });
});

afterAll(async () => {
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
```

(Mirror the same auth setup used in Step 1.)

- [ ] **Step 7: Run integration test, expect PASS**

Run: `bun test tests/integration/agent-patch-sending-paused.test.ts`
Expected: PASS (both cases).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/agents/[id]/route.ts tests/regression/agent-pause-preserves-cohort.test.ts tests/integration/agent-patch-sending-paused.test.ts
git commit -m "feat(api/agents): accept sendingPaused without releasing cohort"
```

---

## Task 4: Cron — per-agent filter + global kill-switch short-circuit

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts` (~line 95-111)
- Test: `tests/integration/cron-pause-and-kill-switch.test.ts` (NEW)

- [ ] **Step 1: Write the integration test**

Create `tests/integration/cron-pause-and-kill-switch.test.ts`. First grep the existing
cron integration tests (`grep -rl "select-and-send" tests/integration`) and reuse their
exact invocation + Braze-mock + CRON_SECRET auth setup. The test must assert:

```ts
// 1. An active, unpaused agent is included in the loaded send set.
// 2. An active agent with sendingPaused=true is excluded.
// 3. With AppSetting global_sending_paused="true", the route returns { paused: true }
//    and sends nothing, and does NOT release any locks/assignments.
```

Structure (adapt invocation to the existing harness):

```ts
import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import { prisma } from "@/lib/db";
import { createAgent } from "../helpers/builders";

const PREFIX = "cronpause-";

async function setGlobal(v: "true" | "false") {
  await prisma.appSetting.upsert({
    where: { key: "global_sending_paused" },
    update: { value: v },
    create: { key: "global_sending_paused", value: v },
  });
}

describe("cron pause + kill switch (integration)", () => {
  beforeEach(async () => { await setGlobal("false"); });

  it("excludes paused agents from the active send set", async () => {
    await createAgent({ name: `${PREFIX}on-${Date.now()}`, status: "active", sendingPaused: false });
    await createAgent({ name: `${PREFIX}off-${Date.now()}`, status: "active", sendingPaused: true });
    const loaded = await prisma.agent.findMany({
      where: { status: "active", sendingPaused: false, name: { startsWith: PREFIX } },
      select: { name: true },
    });
    expect(loaded.some((a) => a.name.includes("-on-"))).toBe(true);
    expect(loaded.some((a) => a.name.includes("-off-"))).toBe(false);
  });

  it("kill switch on → route returns paused, sends nothing", async () => {
    await setGlobal("true");
    // Invoke the cron GET handler with the harness's authorized request.
    // Expect res.json() => { paused: true } (or { paused: true, sent: 0 }) and 200.
    // Assert no userAgentAssignment rows were released as a side effect.
  });
});

afterAll(async () => {
  await setGlobal("false");
  await prisma.agent.deleteMany({ where: { name: { startsWith: PREFIX } } });
});
```

- [ ] **Step 2: Run the test, expect FAIL on the kill-switch case**

Run: `bun test tests/integration/cron-pause-and-kill-switch.test.ts`
Expected: the filter case passes (filter is just a query), the kill-switch case FAILS because the route does not yet short-circuit.

- [ ] **Step 3: Add the per-agent filter**

In `src/app/api/cron/select-and-send/route.ts`, change the active-agent query (~line 110-111) from:

```ts
  const agents = await prisma.agent.findMany({
    where: { status: "active" },
```
to:
```ts
  const agents = await prisma.agent.findMany({
    where: { status: "active", sendingPaused: false },
```

- [ ] **Step 4: Add the kill-switch short-circuit**

In the same file, after the Braze-config check (the block that returns "Braze not configured", ~line 102) and before the agent `findMany` (~line 110), insert:

```ts
  const killSwitch = await prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } });
  if (killSwitch?.value === "true") {
    await prisma.cronRun.update({
      where: { id: cronRunId },
      data: { status: "completed", finishedAt: new Date(), errorMsg: "skipped — global kill switch on" },
    });
    return NextResponse.json({ paused: true, sent: 0 });
  }
```

(Confirm the cronRun row variable is named `cronRunId` and `status`/`finishedAt`/`errorMsg`
are the actual columns — they are used identically at ~line 99-100. Match exactly.)

- [ ] **Step 5: Run the test, expect PASS**

Run: `bun test tests/integration/cron-pause-and-kill-switch.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-pause-and-kill-switch.test.ts
git commit -m "feat(cron): exclude paused agents + global kill-switch short-circuit"
```

---

## Task 5: Shared `AgentPauseToggle` component

**Files:**
- Create: `src/components/agents/agent-pause-toggle.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/agents/agent-pause-toggle.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentPauseToggle({
  agentId,
  agentName,
  sendingPaused,
  killSwitchOn = false,
}: {
  agentId: string;
  agentName: string;
  sendingPaused: boolean;
  killSwitchOn?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !sendingPaused;
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingPaused: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update sending state" }));
        throw new Error(body.error ?? "Failed to update sending state");
      }
      router.refresh();
      toast.success(next ? `"${agentName}" paused` : `"${agentName}" resumed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sending state");
    } finally {
      setLoading(false);
    }
  }

  if (sendingPaused) {
    return (
      <Button size="sm" variant="outline" disabled={loading} onClick={toggle}>
        <Play className="h-3.5 w-3.5 mr-1.5" />
        {loading ? "Resuming…" : "Resume"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={toggle}
      title={killSwitchOn ? "Kill switch is on — global send is paused" : undefined}
      className="hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30"
    >
      <Pause className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Pausing…" : "Pause"}
    </Button>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no type/lint errors. (No standalone test — this is a thin client component exercised via the pages that consume it.)

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/agent-pause-toggle.tsx
git commit -m "feat(agents): shared AgentPauseToggle pause/resume button"
```

---

## Task 6: Wire pause toggle into the agent card + thread `isAdmin`

**Files:**
- Modify: `src/components/agents/agent-card.tsx`
- Modify: `src/components/agents/agent-grid.tsx`
- Modify: `src/app/agents/page.tsx`

- [ ] **Step 1: Add props to AgentCard**

In `src/components/agents/agent-card.tsx`, extend `AgentCardProps`:

```ts
interface AgentCardProps {
  agent: Agent;
  conversionRate?: number;
  convergenceState?: ConvergenceState;
  hiddenStats?: StatKey[];
  isAdmin?: boolean;
  killSwitchOn?: boolean;
  onDelete?: (id: string) => void;
}
```
Update the destructure: `export function AgentCard({ agent, conversionRate, convergenceState, hiddenStats = [], isAdmin = false, killSwitchOn = false, onDelete }: AgentCardProps) {`

- [ ] **Step 2: Import and render the pause toggle**

Add import near the other imports in `agent-card.tsx`:

```ts
import { AgentPauseToggle } from "./agent-pause-toggle";
```
In the header actions `<div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">` (the block containing `<AgentStatusBadge>` and the delete button, ~line 123-145), add — wrapped so the card's `<Link>` doesn't intercept the click — immediately before the delete `<button>`:

```tsx
                  {isAdmin && (
                    <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                      <AgentPauseToggle
                        agentId={agent.id}
                        agentName={agent.name}
                        sendingPaused={agent.sendingPaused}
                        killSwitchOn={killSwitchOn}
                      />
                    </span>
                  )}
```

- [ ] **Step 3: Thread props through AgentGrid**

In `src/components/agents/agent-grid.tsx`:
- Add to `AgentGridProps`: `isAdmin?: boolean;` and `killSwitchOn?: boolean;`.
- Destructure them in the `AgentGrid` component signature with defaults `false`.
- Find where `<AgentCard ... />` is rendered (inside `SortableAgent` and/or the grid map) and pass `isAdmin={isAdmin}` and `killSwitchOn={killSwitchOn}` down. If `SortableAgent` wraps `AgentCard`, add the two props to `SortableAgent`'s prop type + signature and forward them.

- [ ] **Step 4: Pass from the page + read global flag**

In `src/app/agents/page.tsx`:
- In the `Promise.all` (~line 57), add a read of the kill-switch flag. Add this entry to the array:
  ```ts
      prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } }),
  ```
  and add `killSwitchSetting` to the destructure. Then:
  ```ts
  const killSwitchOn = killSwitchSetting?.value === "true";
  ```
- Update the grid render (~line 178):
  ```tsx
  <AgentGrid agents={agents} convergenceStates={convergenceStates} hiddenStats={hiddenStats} isAdmin={isAdmin} killSwitchOn={killSwitchOn} />
  ```

- [ ] **Step 5: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no errors. (`agent.sendingPaused` is now on the `Agent` type from Task 2 and present on the serialized list rows because the list query uses `include` which returns all scalar fields.)

- [ ] **Step 6: Commit**

```bash
git add src/components/agents/agent-card.tsx src/components/agents/agent-grid.tsx src/app/agents/page.tsx
git commit -m "feat(agents): per-agent pause toggle on agent cards"
```

---

## Task 7: Pause toggle on the agent detail page

**Files:**
- Modify: `src/app/agents/[id]/page.tsx` (~line 123)

- [ ] **Step 1: Import + render beside the status toggle**

In `src/app/agents/[id]/page.tsx`, add import:

```ts
import { AgentPauseToggle } from "@/components/agents/agent-pause-toggle";
```
Immediately after the `{isAdmin && <AgentStatusToggle agentId={agent.id} status={agent.status} />}` line (~line 123), add:

```tsx
            {isAdmin && (
              <AgentPauseToggle
                agentId={agent.id}
                agentName={agent.name}
                sendingPaused={agent.sendingPaused}
              />
            )}
```

(`getCachedAgent` returns the full agent row, so `agent.sendingPaused` is available. If the detail-page cache uses an explicit `select`, add `sendingPaused: true` to it — grep `getCachedAgent` in `src/lib/cache/agents.ts` to confirm; the list note says it uses `include`.)

- [ ] **Step 2: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/agents/[id]/page.tsx
git commit -m "feat(agents): pause toggle on agent detail page"
```

---

## Task 8: Control Tower — repoint per-agent toggles to `sendingPaused`

**Files:**
- Modify: `src/lib/cache/agents.ts` (`getCachedControlTowerAgents` select ~line 125)
- Modify: `src/components/control-tower/agent-toggle-grid.tsx`

- [ ] **Step 1: Add `sendingPaused` to the cached select**

In `src/lib/cache/agents.ts`, in `getCachedControlTowerAgents` (~line 125), change the `select` to include `sendingPaused`:

```ts
      select: { id: true, name: true, description: true, status: true, funnelStage: true, color: true, sendingPaused: true },
```

- [ ] **Step 2: Update SerializedAgent + projection**

In `src/components/control-tower/agent-toggle-grid.tsx`:
- Add `sendingPaused: boolean;` to the `SerializedAgent` type (~line 20).
- In `mapDbAgents` (~line 34), change `defaultEnabled` to mean "actively sending":
  ```ts
    defaultEnabled: a.status === "active" && !a.sendingPaused,
  ```

- [ ] **Step 3: Repoint the mutation to sendingPaused + drop confirm dialog**

In the same file:
- Replace `updateAgentStatus` with a pause-based mutation:
  ```ts
  const updateSending = async (agentId: string, sendingPaused: boolean): Promise<boolean> => {
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingPaused }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };
  ```
- Rewrite `handleToggle` so OFF pauses immediately (no confirmation dialog — pause is reversible and non-destructive):
  ```ts
  const handleToggle = (agentId: string, on: boolean) => {
    setEnabledAgents((prev) => ({ ...prev, [agentId]: on }));
    const name = agentPool.find((a) => a.id === agentId)?.name ?? "Agent";
    void updateSending(agentId, !on).then((ok) => {
      if (!ok) {
        setEnabledAgents((prev) => ({ ...prev, [agentId]: !on }));
        showNotification(`Failed to ${on ? "resume" : "pause"} agent — please try again`);
        return;
      }
      showNotification(on ? `${name} resumed` : `${name} paused`);
    });
  };
  ```
- Remove the `pendingOff` state, `confirmTurnOff`, and the entire deactivation `<AlertDialog>` block (~line 146-162). Remove the now-unused `AlertDialog*` imports.

- [ ] **Step 4: Update the InfoTip copy**

In the AI Agents `<InfoTip>` (~line 124-129), replace the "Toggling an agent off (draft)…" paragraph with:

```tsx
            <p className="mt-1">Toggling an agent <strong>off</strong> pauses its sends immediately and <strong>freezes</strong> its cohort, user assignments, and learning. Turn it back on to resume exactly where it left off.</p>
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no errors, no unused-import warnings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cache/agents.ts src/components/control-tower/agent-toggle-grid.tsx
git commit -m "feat(control-tower): repoint per-agent toggles to non-disruptive pause"
```

---

## Task 9: Shared `KillSwitchToggle` component + settings contract test

**Files:**
- Create: `src/components/control-tower/kill-switch-toggle.tsx`
- Test: `tests/integration/settings-kill-switch.test.ts` (NEW)

- [ ] **Step 1: Write the settings round-trip test**

Create `tests/integration/settings-kill-switch.test.ts`:

```ts
import { describe, it, expect, afterAll } from "bun:test";
import { prisma } from "@/lib/db";
import { POST, GET } from "@/app/api/settings/route";
import { NextRequest } from "next/server";

describe("settings kill switch (integration)", () => {
  it("POST then GET round-trips global_sending_paused", async () => {
    const req = new NextRequest("http://localhost/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ global_sending_paused: "true" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const getRes = await GET();
    const map = await getRes.json();
    expect(map.global_sending_paused).toBe("true");
  });
});

afterAll(async () => {
  await prisma.appSetting.deleteMany({ where: { key: "global_sending_paused" } });
});
```

(Mirror the admin-auth setup used by other `tests/integration` settings tests — grep
`tests/integration` for `api/settings`.)

- [ ] **Step 2: Run, expect PASS**

Run: `bun test tests/integration/settings-kill-switch.test.ts`
Expected: PASS (the settings route already upserts arbitrary keys; this confirms the contract).

- [ ] **Step 3: Create the KillSwitchToggle component**

Create `src/components/control-tower/kill-switch-toggle.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function KillSwitchToggle({ initialOn }: { initialOn: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setKill(on: boolean) {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ global_sending_paused: on ? "true" : "false" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update kill switch" }));
        throw new Error(body.error ?? "Failed to update kill switch");
      }
      router.refresh();
      toast.success(on ? "Kill switch ON — all sending paused" : "Kill switch OFF — sending resumed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update kill switch");
    } finally {
      setLoading(false);
    }
  }

  if (initialOn) {
    return (
      <Button size="sm" variant="destructive" disabled={loading} onClick={() => setKill(false)}>
        <Power className="h-3.5 w-3.5 mr-1.5" />
        {loading ? "Resuming…" : "Kill switch ON — Resume all"}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={loading} className="border-destructive/40 text-destructive hover:bg-destructive/10">
          <Power className="h-3.5 w-3.5 mr-1.5" />
          Kill switch
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Activate kill switch?</AlertDialogTitle>
          <AlertDialogDescription>
            This immediately pauses ALL sending across every agent. Cohorts, assignments,
            and learning are preserved. You can turn it back off at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => setKill(true)}>
            Activate kill switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

(Verify `AlertDialogAction`/`Button` accept a `variant="destructive"` prop in this
codebase — `agent-toggle-grid.tsx` already uses `<AlertDialogAction variant="destructive">`,
so the pattern is established.)

- [ ] **Step 4: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/control-tower/kill-switch-toggle.tsx tests/integration/settings-kill-switch.test.ts
git commit -m "feat(control-tower): shared KillSwitchToggle + settings round-trip test"
```

---

## Task 10: Place both kill switches

**Files:**
- Modify: `src/app/agents/page.tsx` (header actions)
- Modify: `src/app/control-tower/page.tsx`

- [ ] **Step 1: Agents page kill switch**

In `src/app/agents/page.tsx`, add import:

```ts
import { KillSwitchToggle } from "@/components/control-tower/kill-switch-toggle";
```
`killSwitchOn` is already computed in Task 6 Step 4. Render the toggle in the page header
action area (near the "New Agent" button — find the `<Link>`/`<Button>` with `Plus`/"New Agent"
and place it adjacent), admin-only:

```tsx
{isAdmin && <KillSwitchToggle initialOn={killSwitchOn} />}
```

- [ ] **Step 2: Control Tower kill switch**

In `src/app/control-tower/page.tsx`:
- Add imports:
  ```ts
  import { KillSwitchToggle } from "@/components/control-tower/kill-switch-toggle";
  import { prisma } from "@/lib/db";
  import { getAuth } from "@/lib/auth";
  ```
  (Check which are already imported; only add missing ones.)
- The page is a synchronous Server Component with Suspense sections. Render the kill switch
  in the `Header` area or just above the `AgentTogglesSection`. To read the flag + admin
  without blocking other sections, add a small async section component:
  ```tsx
  async function KillSwitchSection() {
    const [{ isAdmin }, setting] = await Promise.all([
      getAuth(),
      prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } }),
    ]);
    if (!isAdmin) return null;
    return (
      <div className="px-4 sm:px-6 py-2 flex justify-end">
        <KillSwitchToggle initialOn={setting?.value === "true"} />
      </div>
    );
  }
  ```
  Then render `<Suspense fallback={null}><KillSwitchSection /></Suspense>` near the top of
  the page body (above the agent grid section). Match the existing Suspense/section pattern
  already used in this file.

- [ ] **Step 3: Verify typecheck + lint**

Run: `bun run check:quick`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/agents/page.tsx src/app/control-tower/page.tsx
git commit -m "feat: place kill switch on agents page + control tower"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: typecheck + lint + unit/contract + integration + regression all green. If the
pre-push hook later runs the suite, this must already pass.

- [ ] **Step 2: Manual smoke (dev server)**

Run `bun run dev`, then as an admin:
- Pause an agent from its card → toast "…paused", badge/button flips to Resume; refresh page → still paused (synced).
- Open that agent's detail page → pause toggle shows Resume (synced from same field).
- Open Control Tower → that agent's switch is OFF (synced).
- Toggle the agent back on from Control Tower → toast "…resumed"; agents list shows Pause again.
- Flip the kill switch on the Agents page → confirm dialog → toast "Kill switch ON…"; Control Tower kill switch shows ON state (synced); per-agent pause states unchanged underneath.
- Flip kill switch off → toast "…resumed"; agents return to their individual pause states.

State explicitly in the report whether the UI smoke was actually performed or only the
automated suite ran.

- [ ] **Step 3: Final commit (if any smoke fixes)**

```bash
git add -A
git commit -m "test: verify pause + kill switch end to end"
```

---

## Self-Review

**Spec coverage:** sendingPaused field (T1-2), cron filter + kill-switch short-circuit (T4), PATCH API non-disruptive persist (T3), cohort-preservation regression (T3), card toggle (T6), detail toggle (T7), control-tower repoint (T8), two kill switches (T9-10), toasts (T5/T9/T8), sync via shared source + router.refresh (T5/T6/T9), admin-gating (T6 isAdmin, route requireAdmin). All spec sections mapped.

**Type consistency:** `sendingPaused: boolean` used identically in schema (T1), Agent type (T2), SerializedAgent (T8), all components (T5-8). PATCH body key `sendingPaused`; AppSetting key `global_sending_paused` ("true"/"false" strings) used identically in cron (T4), settings test (T9), page reads (T6/T10), KillSwitchToggle (T9). `AgentPauseToggle` props (agentId, agentName, sendingPaused, killSwitchOn) consistent across card (T6) and detail (T7).

**Open verification flags for implementers (must confirm before coding, not placeholders):** (a) the auth setup pattern for calling route handlers directly in tests — mirror existing tests; (b) `getCachedAgent` uses `include` not a narrow `select` (else add `sendingPaused`); (c) exact cronRun variable/column names match lines 99-100.
