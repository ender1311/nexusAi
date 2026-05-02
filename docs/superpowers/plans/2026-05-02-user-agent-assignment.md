# User-Agent Assignment: 8-Day Exploration Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assign lapsed and connected users to a single agent for an 8-day exploration window (4 sends timed to behavioral peak), then release them back to the standard lottery.

**Architecture:** A new `UserAgentAssignment` DB record locks each eligible user to one agent for 8 days; a Phase 0 pre-pass in the cron creates/classifies assignments before the lottery runs; in-window users bypass the lottery and are sent to their assigned agent with timing derived from `hourlyStats`/`dailyStats`. A new pure function `computeSendTime` translates those stats into a target hour + day-of-week. After 4 sends (or 8 days), `windowCompletedAt` is set and the user re-enters the lottery; a configurable cooldown (default 90 days, `AppSetting`) controls when a new window may start.

**Tech Stack:** Bun, Next.js App Router, Prisma v7 + PostgreSQL (Neon), TypeScript

**⚠️ DEPENDENCY:** This plan must be implemented AFTER `docs/superpowers/plans/2026-05-02-agent-lottery-global-daily-cap.md` is complete. That plan adds `buildAgentLottery` and `getTodayStartUTC` to `src/lib/engine/`, and modifies the cron's pre-assignment phase. This plan builds on top of those changes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/engine/send-timing.ts` | Create | `computeSendTime` — pure, no DB |
| `tests/unit/send-timing.test.ts` | Create | Unit tests for `computeSendTime` |
| `prisma/schema.prisma` | Modify | Add `UserAgentAssignment` model |
| `prisma/migrations/<ts>_add_user_agent_assignment/migration.sql` | Create | DB migration (auto-generated) |
| `tests/helpers/db.ts` | Modify | Add `userAgentAssignment.deleteMany()` to `truncateAll` |
| `tests/helpers/builders.ts` | Modify | Add `createUserAgentAssignment` factory |
| `src/app/api/cron/select-and-send/route.ts` | Modify | Phase 0 assignment + in-window routing + budget tracking |
| `tests/integration/cron-send.test.ts` | Modify | Exploration window integration tests |

---

## Task 1: `computeSendTime` pure engine function

**Files:**
- Create: `src/lib/engine/send-timing.ts`
- Create: `tests/unit/send-timing.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/send-timing.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { computeSendTime } from "@/lib/engine/send-timing";

const zeroHours = Array(24).fill(0) as number[];
const zeroDays  = Array(7).fill(0)  as number[];

describe("computeSendTime", () => {
  it("returns fallback { hour: 9, dayOfWeek: 0 } when both stats are all zeros", () => {
    expect(computeSendTime(zeroHours, zeroDays, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns fallback when hourlyStats is all zeros even if dailyStats has values", () => {
    const days = [0, 5, 3, 0, 0, 0, 0];
    expect(computeSendTime(zeroHours, days, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns fallback when dailyStats is all zeros even if hourlyStats has values", () => {
    const hours = Array(24).fill(0) as number[];
    hours[10] = 8;
    expect(computeSendTime(hours, zeroDays, 0)).toEqual({ hour: 9, dayOfWeek: 0 });
  });

  it("returns peak hour and peak day for sendIndex 0 (primary)", () => {
    const hours = Array(24).fill(0) as number[];
    hours[14] = 10;  // peak at 14:00
    const days = Array(7).fill(0) as number[];
    days[3] = 5;     // peak on Wednesday (index 3)
    expect(computeSendTime(hours, days, 0)).toEqual({ hour: 14, dayOfWeek: 3 });
  });

  it("returns same primary peak for sendIndex 2", () => {
    const hours = Array(24).fill(0) as number[];
    hours[8] = 7;
    const days = Array(7).fill(0) as number[];
    days[1] = 4;
    expect(computeSendTime(hours, days, 2)).toEqual({ hour: 8, dayOfWeek: 1 });
  });

  it("returns secondary peak for sendIndex 1", () => {
    const hours = Array(24).fill(0) as number[];
    hours[9]  = 10;  // primary
    hours[18] = 7;   // secondary
    const days = Array(7).fill(0) as number[];
    days[0] = 8;     // primary (Sunday)
    days[4] = 5;     // secondary (Thursday)
    expect(computeSendTime(hours, days, 1)).toEqual({ hour: 18, dayOfWeek: 4 });
  });

  it("returns same secondary peak for sendIndex 3", () => {
    const hours = Array(24).fill(0) as number[];
    hours[9]  = 10;
    hours[18] = 7;
    const days = Array(7).fill(0) as number[];
    days[0] = 8;
    days[4] = 5;
    expect(computeSendTime(hours, days, 3)).toEqual({ hour: 18, dayOfWeek: 4 });
  });

  it("breaks ties by returning the first (lowest-index) maximum", () => {
    const hours = Array(24).fill(5) as number[];  // all equal
    const days  = Array(7).fill(5)  as number[];  // all equal
    expect(computeSendTime(hours, days, 0)).toEqual({ hour: 0, dayOfWeek: 0 });
  });

  it("secondary peak falls back to primary index when all values tie", () => {
    // If every hour has the same value, argSecondMax loops without finding
    // a different winner — it should return index 1 (the next non-primary slot)
    const hours = Array(24).fill(3) as number[];
    const days  = Array(7).fill(3)  as number[];
    // primary = index 0; secondary = index 1
    expect(computeSendTime(hours, days, 1)).toEqual({ hour: 1, dayOfWeek: 1 });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/danluk/repos/nexus
bun test tests/unit/send-timing.test.ts
```

Expected: All tests fail with `Cannot find module '@/lib/engine/send-timing'`

- [ ] **Step 3: Implement `computeSendTime`**

Create `src/lib/engine/send-timing.ts`:

```typescript
/** Index of the maximum value in an array. Returns 0 for all-zero or empty arrays. */
function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

/**
 * Index of the second-largest value (skipping `primary` index).
 * When all values tie, returns the lowest index that is not `primary`.
 */
function argSecondMax(arr: number[], primary: number): number {
  // Start from the first index that is not `primary`
  let best = primary === 0 ? 1 : 0;
  for (let i = 0; i < arr.length; i++) {
    if (i === primary) continue;
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

const FALLBACK = { hour: 9, dayOfWeek: 0 } as const;

/**
 * Returns the target send time for a user's Nth exploration send.
 *
 * sendIndex 0, 2 → primary peak (highest value in hourlyStats × highest in dailyStats)
 * sendIndex 1, 3 → secondary peak (second-highest in each array)
 *
 * Falls back to { hour: 9, dayOfWeek: 0 } (Sunday 9 AM) when either array
 * is all-zero — covers lapsed users with no prior behavioral data.
 *
 * @param hourlyStats  24-element array from TrackedUser.hourlyStats (index = hour 0–23)
 * @param dailyStats   7-element array from TrackedUser.dailyStats (0 = Sunday)
 * @param sendIndex    0–3 (which of the 4 exploration sends this is)
 */
export function computeSendTime(
  hourlyStats: number[],
  dailyStats: number[],
  sendIndex: number,
): { hour: number; dayOfWeek: number } {
  const allZeroHourly = hourlyStats.every((v) => v === 0);
  const allZeroDaily  = dailyStats.every((v) => v === 0);
  if (allZeroHourly || allZeroDaily) return FALLBACK;

  const isPrimary = sendIndex % 2 === 0;  // 0, 2 → primary; 1, 3 → secondary

  const primaryHour = argmax(hourlyStats);
  const primaryDay  = argmax(dailyStats);

  if (isPrimary) {
    return { hour: primaryHour, dayOfWeek: primaryDay };
  }

  return {
    hour:       argSecondMax(hourlyStats, primaryHour),
    dayOfWeek:  argSecondMax(dailyStats,  primaryDay),
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/unit/send-timing.test.ts
```

Expected: 9 tests pass, 0 fail.

- [ ] **Step 5: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/send-timing.ts tests/unit/send-timing.test.ts
git commit -m "feat: add computeSendTime pure engine function"
```

---

## Task 2: DB schema + migration + test helpers

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/helpers/db.ts`
- Modify: `tests/helpers/builders.ts`

- [ ] **Step 1: Add `UserAgentAssignment` to `prisma/schema.prisma`**

Open `prisma/schema.prisma` and add this model at the end of the file (after `AppSetting`):

```prisma
model UserAgentAssignment {
  id                String    @id @default(cuid())
  externalUserId    String    @unique   // TrackedUser.externalId (no FK — matches UserDecision pattern)
  agentId           String              // Agent.id (no FK — assignment survives agent soft-delete)
  startedAt         DateTime  @default(now())
  sendCount         Int       @default(0)
  windowCompletedAt DateTime?           // null = in exploration; non-null = window done

  @@index([agentId])
  @@index([windowCompletedAt])
}
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add_user_agent_assignment
```

Expected output contains: `✓ Generated Prisma client` and no errors.

- [ ] **Step 3: Add `userAgentAssignment` to `truncateAll` in `tests/helpers/db.ts`**

Open `tests/helpers/db.ts`. Add `userAgentAssignment.deleteMany()` as the first step in the `steps` array (it has no FK dependencies on other tables):

```typescript
const steps: (() => Promise<unknown>)[] = [
  () => prisma.userAgentAssignment.deleteMany(),   // ← add this line
  () => prisma.personaArmStats.deleteMany(),
  () => prisma.linUCBArm.deleteMany(),
  () => prisma.userDecision.deleteMany(),
  () => prisma.modelMetric.deleteMany(),
  () => prisma.trackedUser.deleteMany(),
  () => prisma.agentPersonaTarget.deleteMany(),
  () => prisma.schedulingRule.deleteMany(),
  () => prisma.messageVariant.deleteMany(),
  () => prisma.message.deleteMany(),
  () => prisma.goal.deleteMany(),
  () => prisma.agent.deleteMany(),
  () => prisma.persona.deleteMany(),
  () => prisma.planSetMember.deleteMany(),
  () => prisma.planSet.deleteMany(),
  () => prisma.appSetting.deleteMany(),
];
```

- [ ] **Step 4: Add `createUserAgentAssignment` to `tests/helpers/builders.ts`**

Open `tests/helpers/builders.ts` and append at the end:

```typescript
export async function createUserAgentAssignment(params: {
  externalUserId: string;
  agentId: string;
  sendCount?: number;
  startedAt?: Date;
  windowCompletedAt?: Date | null;
}) {
  return prisma.userAgentAssignment.upsert({
    where: { externalUserId: params.externalUserId },
    create: {
      externalUserId:    params.externalUserId,
      agentId:           params.agentId,
      sendCount:         params.sendCount ?? 0,
      startedAt:         params.startedAt ?? new Date(),
      windowCompletedAt: params.windowCompletedAt ?? null,
    },
    update: {
      agentId:           params.agentId,
      sendCount:         params.sendCount ?? 0,
      startedAt:         params.startedAt ?? new Date(),
      windowCompletedAt: params.windowCompletedAt ?? null,
    },
  });
}
```

- [ ] **Step 5: Run typecheck**

```bash
bun run check
```

Expected: No type errors. Prisma client now includes `prisma.userAgentAssignment`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ tests/helpers/db.ts tests/helpers/builders.ts
git commit -m "feat: add UserAgentAssignment schema, migration, and test helpers"
```

---

## Task 3: Cron Phase 0 — assignment classification and creation

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Modify: `tests/integration/cron-send.test.ts`

Context for this task:
- The existing cron (`POST` handler) fetches all active agents, then loops through them.
- Phase 0 runs BEFORE the agent loop. It uses `agents` (already fetched) to identify exploration agents (`funnelStage === "lapsed"` or `"connected"`).
- Phase 0 produces `inWindowMap: Map<string, string>` (externalUserId → agentId).
- The agent lottery (added by the prerequisite plan) runs after Phase 0 and excludes in-window users.

- [ ] **Step 1: Write failing integration tests for Phase 0**

Add a new `describe` block at the end of `tests/integration/cron-send.test.ts`.

First, add `createUserAgentAssignment` to the import at the top of the file:

```typescript
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserAgentAssignment,   // ← add this
} from "../helpers/builders";
```

Then add these tests at the bottom:

```typescript
describe("Phase 0: exploration window assignment", () => {
  it("creates an assignment for a lapsed-funnel user with no prior assignment", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_phase0" });
    await createVariant(msg.id);
    await createUser("usr_new_lapsed", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_new_lapsed" },
    });
    expect(assignment).not.toBeNull();
    expect(assignment!.agentId).toBe(agent.id);
    expect(assignment!.windowCompletedAt).toBeNull();
  });

  it("creates an assignment for a connected-funnel user", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "connected" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_connected", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_connected" },
    });
    expect(assignment).not.toBeNull();
  });

  it("does NOT create an assignment for an engaged-funnel user (not lapsed/connected)", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "engaged" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_engaged", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_engaged" },
    });
    expect(assignment).toBeNull();
  });

  it("does not reassign a user whose window is still active", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_in_window", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId: user.externalId,
      agentId:        agent.id,
      sendCount:      1,
      startedAt:      twoDaysAgo,
      windowCompletedAt: null,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // Still the same assignment — startedAt not reset
    expect(assignment!.startedAt.getTime()).toBeCloseTo(twoDaysAgo.getTime(), -3);
  });

  it("does not reassign during cooldown period (default 90 days)", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_cooldown", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        4,
      windowCompletedAt: tenDaysAgo,
    });
    // No AppSetting set → default cooldown = 90 days

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // windowCompletedAt unchanged
    expect(assignment!.windowCompletedAt!.getTime()).toBeCloseTo(tenDaysAgo.getTime(), -3);
    expect(assignment!.sendCount).toBe(4);
  });

  it("triggers a new window when cooldown has expired", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_expired_cooldown", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const ninetyOneDaysAgo = new Date(Date.now() - 91 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        4,
      windowCompletedAt: ninetyOneDaysAgo,
    });
    // default cooldown = 90 days → 91 days means eligible

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    // Window reset
    expect(assignment!.windowCompletedAt).toBeNull();
    expect(assignment!.sendCount).toBeGreaterThanOrEqual(0);
  });

  it("closes an expired window (8 days elapsed, sendCount < 4) without triggering new sends", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id);
    await createVariant(msg.id);
    const user     = await createUser("usr_stale_window", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const nineDaysAgo = new Date(Date.now() - 9 * 86_400_000);
    await createUserAgentAssignment({
      externalUserId:   user.externalId,
      agentId:          agent.id,
      sendCount:        2,           // never hit 4
      startedAt:        nineDaysAgo,
      windowCompletedAt: null,       // never completed
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: user.externalId },
    });
    expect(assignment!.windowCompletedAt).not.toBeNull();  // closed by cron
    expect(assignment!.sendCount).toBe(2);                 // no new sends added
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Phase 0"
```

Expected: All 7 tests fail (Phase 0 logic not yet implemented).

- [ ] **Step 3: Implement Phase 0 in the cron route**

Open `src/app/api/cron/select-and-send/route.ts`.

Locate the line `for (const agent of agents) {` (the start of the per-agent loop, around line 58). Insert Phase 0 immediately BEFORE this line:

```typescript
// ─── Phase 0: Exploration window assignment ───────────────────────────────
// Identify lapsed/connected users, create/classify their assignments,
// and build inWindowMap (externalUserId → agentId) for this cron run.

const cooldownSetting = await prisma.appSetting.findUnique({
  where: { key: "exploration_window_cooldown_days" },
});
const cooldownDays = cooldownSetting ? parseInt(cooldownSetting.value, 10) : 90;
const cooldownMs   = cooldownDays * 86_400_000;
const windowMs     = 8 * 86_400_000;

const explorationAgents = agents.filter(
  (a) => a.funnelStage === "lapsed" || a.funnelStage === "connected"
);

const inWindowMap = new Map<string, string>(); // externalUserId → agentId

if (explorationAgents.length > 0) {
  const explorationPersonaIds = [
    ...new Set(explorationAgents.flatMap((a) => a.personaTargets.map((pt) => pt.personaId))),
  ];

  const explorationUsers = await prisma.trackedUser.findMany({
    where: { personaId: { in: explorationPersonaIds } },
  });

  const existingAssignments = await prisma.userAgentAssignment.findMany({
    where: { externalUserId: { in: explorationUsers.map((u) => u.externalId) } },
  });
  const assignmentByUser = new Map(existingAssignments.map((a) => [a.externalUserId, a]));

  // For each exploration agent, index the personas it targets
  const agentPersonaSets = new Map<string, Set<string>>();
  for (const agent of explorationAgents) {
    agentPersonaSets.set(
      agent.id,
      new Set(agent.personaTargets.map((pt) => pt.personaId))
    );
  }

  // Build eligible agent list per user
  const eligibleAgentsByUser = new Map<string, string[]>();
  for (const user of explorationUsers) {
    if (!user.personaId) continue;
    const eligible: string[] = [];
    for (const agent of explorationAgents) {
      if (agentPersonaSets.get(agent.id)?.has(user.personaId)) {
        eligible.push(agent.id);
      }
    }
    if (eligible.length > 0) eligibleAgentsByUser.set(user.externalId, eligible);
  }

  const toUpsert: Array<{ externalUserId: string; agentId: string }> = [];
  const toClose:  string[] = []; // assignment IDs where window expired without 4 sends

  for (const user of explorationUsers) {
    const assignment = assignmentByUser.get(user.externalId);

    if (!assignment) {
      // Class A: no prior assignment — newly eligible
      const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
      if (eligible.length === 0) continue;
      const agentId = eligible[Math.floor(Math.random() * eligible.length)];
      toUpsert.push({ externalUserId: user.externalId, agentId });
      inWindowMap.set(user.externalId, agentId);
    } else if (assignment.windowCompletedAt === null) {
      const age = now.getTime() - assignment.startedAt.getTime();
      if (age <= windowMs) {
        // Class B: active window — keep locked
        inWindowMap.set(user.externalId, assignment.agentId);
      } else {
        // Class C: 8 days elapsed, never hit 4 sends — close window
        toClose.push(assignment.id);
      }
    } else {
      const timeSinceComplete = now.getTime() - assignment.windowCompletedAt.getTime();
      if (timeSinceComplete > cooldownMs) {
        // Class D: cooldown expired — new window
        const eligible = eligibleAgentsByUser.get(user.externalId) ?? [];
        if (eligible.length === 0) continue;
        const agentId = eligible[Math.floor(Math.random() * eligible.length)];
        toUpsert.push({ externalUserId: user.externalId, agentId });
        inWindowMap.set(user.externalId, agentId);
      }
      // Class E: cooldown not yet expired — no action
    }
  }

  // Apply DB writes
  for (const { externalUserId, agentId } of toUpsert) {
    await prisma.userAgentAssignment.upsert({
      where: { externalUserId },
      create: { externalUserId, agentId, sendCount: 0, windowCompletedAt: null },
      update: { agentId, startedAt: now, sendCount: 0, windowCompletedAt: null },
    });
  }
  if (toClose.length > 0) {
    await prisma.userAgentAssignment.updateMany({
      where: { id: { in: toClose } },
      data: { windowCompletedAt: now },
    });
  }
}
// ─── End Phase 0 ─────────────────────────────────────────────────────────────
```

**Important:** `now` is already defined in the existing cron code inside the per-agent loop (`const now = new Date();`). Move this declaration to ABOVE Phase 0 so it's in scope. Find the line `const now = new Date();` inside the `for (const agent of agents)` block and move it to just before Phase 0 (after the `agents` fetch):

```typescript
// Move this line to before Phase 0:
const now = new Date();
```

- [ ] **Step 4: Run the Phase 0 tests**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Phase 0"
```

Expected: All 7 Phase 0 tests pass.

- [ ] **Step 5: Run full cron test suite to check for regressions**

```bash
bun test tests/integration/cron-send.test.ts
```

Expected: All pre-existing tests still pass.

- [ ] **Step 6: Run typecheck**

```bash
bun run check
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts
git commit -m "feat: cron Phase 0 — exploration window assignment classification"
```

---

## Task 4: Cron Phase 2 — in-window routing, timing check, and budget tracking

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Modify: `tests/integration/cron-send.test.ts`

Context: `inWindowMap` is now populated by Phase 0. In the per-agent loop, we need to:
1. Exclude in-window users from the normal user pagination (they'd otherwise get double-processed)
2. Process in-window users for this agent separately with a timing check
3. On a successful send, increment `sendCount` and set `windowCompletedAt` if it reaches 4

`getTodayStartUTC` is available from `@/lib/engine/scheduling` (added by the prerequisite lottery plan).

- [ ] **Step 1: Write failing integration tests for in-window sends**

Add these tests to the `"Phase 0: exploration window assignment"` describe block in `tests/integration/cron-send.test.ts`:

```typescript
  it("in-window user goes to their assigned agent and sendCount increments", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_window" });
    await createVariant(msg.id, { brazeVariantId: "var_w1" });
    // hourlyStats peak at hour 0 (any hour matches since we'll mock now)
    await createUser("usr_window_send", {
      personaId:   persona.id,
      // hourlyStats peak at hour 0, dailyStats peak on Sunday (0)
    });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);
    await createUserAgentAssignment({
      externalUserId: "usr_window_send",
      agentId:        agent.id,
      sendCount:      0,
    });

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.sent).toBeGreaterThanOrEqual(1);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_window_send" },
    });
    expect(assignment!.sendCount).toBe(1);
    expect(assignment!.windowCompletedAt).toBeNull(); // only 1 of 4 sends done
  });

  it("sets windowCompletedAt when sendCount reaches 4", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent({ funnelStage: "lapsed" });
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_complete" });
    await createVariant(msg.id);
    await createUser("usr_completing", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);
    await createUserAgentAssignment({
      externalUserId: "usr_completing",
      agentId:        agent.id,
      sendCount:      3,   // one more send will complete the window
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const assignment = await prisma.userAgentAssignment.findUnique({
      where: { externalUserId: "usr_completing" },
    });
    expect(assignment!.sendCount).toBe(4);
    expect(assignment!.windowCompletedAt).not.toBeNull();
  });

  it("in-window user is excluded from normal (lottery) user pipeline", async () => {
    const persona     = await createPersona();
    const agentA      = await createAgent({ funnelStage: "lapsed",     name: "Agent A" });
    const agentB      = await createAgent({ funnelStage: "connected",  name: "Agent B" });
    const msgA        = await createMessage(agentA.id, { brazeCampaignId: "camp_a" });
    const msgB        = await createMessage(agentB.id, { brazeCampaignId: "camp_b" });
    await createVariant(msgA.id, { brazeVariantId: "var_a" });
    await createVariant(msgB.id, { brazeVariantId: "var_b" });
    await createUser("usr_exclusive", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    // Lock user to agentA
    await createUserAgentAssignment({
      externalUserId: "usr_exclusive",
      agentId:        agentA.id,
      sendCount:      0,
    });

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    // User should appear in exactly one agent's decisions
    const decisions = await prisma.userDecision.findMany({
      where: { userId: "usr_exclusive" },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0].agentId).toBe(agentA.id);
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "in-window|sets windowCompleted"
```

Expected: Tests fail (in-window routing not yet implemented).

- [ ] **Step 3: Modify the per-agent user pagination to exclude in-window users**

In `src/app/api/cron/select-and-send/route.ts`, inside the `for (const agent of agents)` loop, find the `TrackedUser.findMany` paginated query (around line 128):

```typescript
const users = await prisma.trackedUser.findMany({
  where: { personaId: { in: personaIds } },
  take: 500,
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  orderBy: { id: "asc" },
});
```

Replace the `where` clause to exclude all in-window users:

```typescript
const allInWindowUserIds = [...inWindowMap.keys()];

const users = await prisma.trackedUser.findMany({
  where: {
    personaId:  { in: personaIds },
    ...(allInWindowUserIds.length > 0
      ? { externalId: { notIn: allInWindowUserIds } }
      : {}),
  },
  take: 500,
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  orderBy: { id: "asc" },
});
```

**Note:** `allInWindowUserIds` is defined once before the per-agent loop (Phase 0 already ran). Move its declaration to just after Phase 0 ends and before `for (const agent of agents)`:

```typescript
// Derived once from inWindowMap — used in every agent's user query
const allInWindowUserIds = [...inWindowMap.keys()];
```

- [ ] **Step 4: Add in-window sub-pool processing inside the per-agent loop**

Still inside `for (const agent of agents)`, AFTER the existing `while (true)` pagination loop (i.e., after the `}` that closes the while loop), add the in-window sub-pool:

```typescript
    // ── In-window sub-pool for this agent ──────────────────────────────────
    const inWindowUserIdsForAgent = [...inWindowMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    if (inWindowUserIdsForAgent.length > 0) {
      const windowUsers = await prisma.trackedUser.findMany({
        where: { externalId: { in: inWindowUserIdsForAgent } },
      });

      const windowAssignments = await prisma.userAgentAssignment.findMany({
        where: { externalUserId: { in: inWindowUserIdsForAgent } },
      });
      const windowAssignmentMap = new Map(
        windowAssignments.map((a) => [a.externalUserId, a])
      );

      // Determine current ET hour and day-of-week for timing check
      const etParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        weekday:  "short",
        hour:     "2-digit",
        hour12:   false,
      }).formatToParts(now);
      const currentHourET = parseInt(
        etParts.find((p) => p.type === "hour")!.value, 10
      );
      const weekdayStr = etParts.find((p) => p.type === "weekday")!.value;
      const dayIndexMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const currentDayET = dayIndexMap[weekdayStr] ?? 0;

      // Global daily cap for in-window users (safety net)
      const todayStart = getTodayStartUTC("America/New_York");
      const sentTodayWindowRows = await prisma.userDecision.findMany({
        where: {
          userId:  { in: inWindowUserIdsForAgent },
          sentAt:  { gte: todayStart },
        },
        select:   { userId: true },
        distinct: ["userId"],
      });
      const sentTodayWindowIds = new Set(sentTodayWindowRows.map((r) => r.userId));

      // Filter eligible window users by timing check + daily cap
      const eligibleWindowUsers = windowUsers.filter((user) => {
        const assignment = windowAssignmentMap.get(user.externalId);
        if (!assignment || assignment.sendCount >= 4) return false;
        if (sentTodayWindowIds.has(user.externalId)) {
          totalSuppressed++;
          return false;
        }

        const hourlyStats = (Array.isArray(user.hourlyStats)
          ? user.hourlyStats
          : Array(24).fill(0)) as number[];
        const dailyStats = (Array.isArray(user.dailyStats)
          ? user.dailyStats
          : Array(7).fill(0)) as number[];

        const target   = computeSendTime(hourlyStats, dailyStats, assignment.sendCount);
        const hourDiff = Math.abs(currentHourET - target.hour);
        const hourMatch = hourDiff <= 1 || hourDiff >= 23;  // wrap-around (e.g. 23 and 0)
        const dayMatch  = currentDayET === target.dayOfWeek;

        return hourMatch && dayMatch;
      });

      // Decide + collect variant groups for in-window users
      const windowByVariant: Record<string, VariantSendGroup> = {};
      const sentWindowUserIds: string[] = [];

      for (let start = 0; start < eligibleWindowUsers.length; start += CONCURRENCY) {
        const chunk = eligibleWindowUsers.slice(start, start + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map((user) =>
            decideForUser({
              agentId:          agent.id,
              externalUserId:   user.externalId,
              preloadedAgent:   agent,
              skipSchedulingChecks: true,
            }).then((r) => ({ user, result: r }))
          )
        );

        for (const { user, result } of chunkResults) {
          if (!result) continue;
          if (result.suppressed) { totalSuppressed++; continue; }

          const { messageVariantId, userDecisionId } = result;
          const meta = variantMeta.get(messageVariantId);
          if (!meta) continue;

          if (!windowByVariant[messageVariantId]) {
            windowByVariant[messageVariantId] = {
              variantId:       messageVariantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              deeplink:        meta.deeplink,
              externalUserIds: [],
              decisionIds:     [],
            };
          }
          windowByVariant[messageVariantId].externalUserIds.push(user.externalId);
          windowByVariant[messageVariantId].decisionIds.push(userDecisionId);
          sentWindowUserIds.push(user.externalId);
        }
      }

      // Send each window variant group in batches of 50 (same as normal pipeline)
      for (const group of Object.values(windowByVariant)) {
        const BATCH = 50;
        for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
          const batchUserIds     = group.externalUserIds.slice(i, i + BATCH);
          const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);

          try {
            const sendId = group.brazeCampaignId
              ? await brazeClient.createSendId(group.brazeCampaignId)
              : null;

            const audience = { externalUserIds: batchUserIds };
            let payload: Record<string, unknown>;

            if (group.channel === "push") {
              payload = factory.buildPushPayload(
                { title: group.title ?? "", body: group.body, deeplink: group.deeplink ?? undefined },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            } else if (group.channel === "email") {
              payload = factory.buildEmailPayload(
                { subject: group.title ?? "", htmlBody: group.body },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            } else {
              payload = factory.buildSmsPayload(
                { body: group.body },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            }

            const res = await brazeClient.post("/messages/send", payload);
            if (res.ok && sendId) {
              await prisma.userDecision.updateMany({
                where: { id: { in: batchDecisionIds } },
                data: { brazeSendId: sendId },
              });
            }
            totalSent += batchUserIds.length;
          } catch (err) {
            console.error("[cron/select-and-send] window send error:", err);
            totalErrors += batchUserIds.length;
          }
        }
      }

      // Increment sendCount for each user who was actually sent to
      for (const userId of sentWindowUserIds) {
        const assignment = windowAssignmentMap.get(userId);
        if (!assignment) continue;
        const newCount = assignment.sendCount + 1;
        await prisma.userAgentAssignment.update({
          where: { id: assignment.id },
          data: {
            sendCount:        newCount,
            windowCompletedAt: newCount >= 4 ? now : null,
          },
        });
      }
    }
    // ── End in-window sub-pool ───────────────────────────────────────────────
```

**Also** add these two imports at the top of the file (before the existing imports):

```typescript
import { computeSendTime } from "@/lib/engine/send-timing";
import { getTodayStartUTC } from "@/lib/engine/scheduling";  // added by lottery plan
```

- [ ] **Step 5: Run the new in-window tests**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "in-window|sets windowCompleted"
```

Expected: All 3 new tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
bun test tests/integration/cron-send.test.ts
```

Expected: All tests pass (Phase 0 tests + in-window tests + original tests).

- [ ] **Step 7: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts
git commit -m "feat: cron in-window routing — timing check, send, and budget tracking"
```

---

## Verification

After all tasks complete, run the full test suite:

```bash
bun test tests/unit/send-timing.test.ts tests/integration/cron-send.test.ts
bun run check
```

Expected: All unit and integration tests pass, no type or lint errors.
