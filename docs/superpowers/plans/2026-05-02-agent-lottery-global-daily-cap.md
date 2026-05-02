# Agent Lottery + Global Daily Cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent any user from receiving more than one push per calendar day across all agents, and distribute shared-pool users fairly across agents using a per-run random lottery.

**Architecture:** Two new pure engine functions — `getTodayStartUTC` (derives midnight in an IANA timezone as a UTC Date) and `buildAgentLottery` (randomly assigns each eligible user to exactly one agent for the run). The cron gains a pre-assignment phase that builds a `lotteryMap` before the agent loop, filters each agent's user pagination to only lottery-assigned users, and adds a cross-agent daily cap bulk query per page.

**Tech Stack:** Bun, Next.js App Router, Prisma v7 + PostgreSQL (Neon), TypeScript

**Note:** This plan must be implemented BEFORE `docs/superpowers/plans/2026-05-02-user-agent-assignment.md`, which imports `getTodayStartUTC` and depends on the `lotteryMap` logic added here.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/engine/scheduling.ts` | Create | `getTodayStartUTC(timezone, now?)` — pure, no DB |
| `tests/unit/scheduling.test.ts` | Create | Unit tests for `getTodayStartUTC` |
| `src/lib/engine/agent-lottery.ts` | Create | `buildAgentLottery(eligibleUsersByAgent)` — pure, no DB |
| `tests/unit/agent-lottery.test.ts` | Create | Unit tests for `buildAgentLottery` |
| `src/app/api/cron/select-and-send/route.ts` | Modify | Pre-assignment phase + lottery filter + global daily cap |
| `tests/integration/cron-send.test.ts` | Modify | Lottery + daily cap integration tests |

---

## Task 1: `getTodayStartUTC` pure engine function

**Files:**
- Create: `src/lib/engine/scheduling.ts`
- Create: `tests/unit/scheduling.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/scheduling.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { getTodayStartUTC } from "@/lib/engine/scheduling";

describe("getTodayStartUTC", () => {
  it("returns midnight ET (EDT, UTC-4) on a standard summer day", () => {
    // 2026-05-02T14:00:00Z → today in ET is May 2; midnight ET = 04:00 UTC
    const now = new Date("2026-05-02T14:00:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-05-02T04:00:00.000Z")
    );
  });

  it("returns midnight ET (EST, UTC-5) on a standard winter day", () => {
    // 2026-01-15T14:00:00Z → today in ET is Jan 15; midnight ET = 05:00 UTC
    const now = new Date("2026-01-15T14:00:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-01-15T05:00:00.000Z")
    );
  });

  it("handles midnight UTC edge case: 00:30 UTC is prior evening ET", () => {
    // 2026-05-02T00:30:00Z → EDT (UTC-4) = 2026-05-01T20:30 ET
    // today in ET = May 1; midnight ET = 2026-05-01T04:00:00Z
    const now = new Date("2026-05-02T00:30:00Z");
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-05-01T04:00:00.000Z")
    );
  });

  it("returns midnight ET across DST spring-forward (2026-03-08, clocks spring 02:00 EST → EDT)", () => {
    // Midnight Mar 8 is before the spring-forward (which happens at 02:00 AM EST = 07:00 UTC).
    // So midnight Mar 8 is still EST (UTC-5) → 05:00 UTC.
    const now = new Date("2026-03-08T14:00:00Z"); // well after spring-forward
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-03-08T05:00:00.000Z")
    );
  });

  it("returns midnight ET across DST fall-back (2026-11-01, clocks fall 02:00 EDT → EST)", () => {
    // Midnight Nov 1 is before the fall-back (which happens at 02:00 AM EDT = 06:00 UTC).
    // So midnight Nov 1 is still EDT (UTC-4) → 04:00 UTC.
    const now = new Date("2026-11-01T14:00:00Z"); // well after fall-back
    expect(getTodayStartUTC("America/New_York", now)).toEqual(
      new Date("2026-11-01T04:00:00.000Z")
    );
  });

  it("works for UTC timezone (midnight UTC = midnight UTC)", () => {
    const now = new Date("2026-05-02T14:00:00Z");
    expect(getTodayStartUTC("UTC", now)).toEqual(new Date("2026-05-02T00:00:00.000Z"));
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/danluk/repos/nexus
bun test tests/unit/scheduling.test.ts
```

Expected: All tests fail with `Cannot find module '@/lib/engine/scheduling'`

- [ ] **Step 3: Implement `getTodayStartUTC`**

Create `src/lib/engine/scheduling.ts`:

```typescript
/**
 * Returns the start of the current calendar day (midnight) in the given
 * IANA timezone, expressed as a UTC Date.
 *
 * Example: at 14:00 UTC on 2026-05-02, getTodayStartUTC("America/New_York")
 * returns 2026-05-02T04:00:00.000Z  (midnight ET = 04:00 UTC in EDT).
 *
 * @param timezone  Any IANA timezone string (e.g. "America/New_York", "UTC")
 * @param now       Optional — current time. Defaults to new Date(). Pass an
 *                  explicit value in tests to avoid real-clock dependency.
 */
export function getTodayStartUTC(timezone: string, now: Date = new Date()): Date {
  // Step 1: What date is "today" in the target timezone? (en-CA gives YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  }).format(now);  // e.g. "2026-05-02"

  // Step 2: Anchor to UTC midnight of that date string.
  //   At this UTC moment, what local time does the timezone show?
  const anchorUtc = new Date(`${todayStr}T00:00:00Z`);

  // Step 3: Format that anchor in the target timezone to read the local hour/minute.
  const localTimeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  }).format(anchorUtc);  // e.g. "20:00" for ET (UTC-4 offset → shows prior evening)

  const [hourStr, minStr] = localTimeStr.split(":");
  const localHour = parseInt(hourStr, 10);
  const localMin  = parseInt(minStr,  10);

  const localMinutes = localHour * 60 + localMin;

  // Step 4: Compute the offset between anchor UTC and true local midnight.
  //   - If local shows e.g. 20:00 when UTC is 00:00, timezone is UTC-4:
  //       true midnight = anchor + (24*60 - 20*60) minutes = anchor + 4 hours
  //   - If local shows e.g. 05:30 when UTC is 00:00, timezone is UTC+5:30:
  //       true midnight = anchor - 5*60 - 30 minutes
  let offsetMs: number;
  if (localMinutes === 0) {
    offsetMs = 0;
  } else if (localMinutes <= 12 * 60) {
    // Timezone is ahead of UTC (local time is morning when UTC is midnight)
    offsetMs = -localMinutes * 60_000;
  } else {
    // Timezone is behind UTC (local time is evening when UTC is midnight)
    offsetMs = (24 * 60 - localMinutes) * 60_000;
  }

  return new Date(anchorUtc.getTime() + offsetMs);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/unit/scheduling.test.ts
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/scheduling.ts tests/unit/scheduling.test.ts
git commit -m "feat: add getTodayStartUTC pure engine function"
```

---

## Task 2: `buildAgentLottery` pure engine function

**Files:**
- Create: `src/lib/engine/agent-lottery.ts`
- Create: `tests/unit/agent-lottery.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/agent-lottery.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";

describe("buildAgentLottery", () => {
  it("returns empty map for empty input", () => {
    expect(buildAgentLottery(new Map()).size).toBe(0);
  });

  it("returns empty map when all agent pools are empty", () => {
    const input = new Map([["agentA", [] as string[]], ["agentB", [] as string[]]]);
    expect(buildAgentLottery(input).size).toBe(0);
  });

  it("assigns all users to the single agent", () => {
    const input = new Map([["agentA", ["u1", "u2", "u3"]]]);
    const result = buildAgentLottery(input);
    expect(result.size).toBe(3);
    expect(result.get("u1")).toBe("agentA");
    expect(result.get("u2")).toBe("agentA");
    expect(result.get("u3")).toBe("agentA");
  });

  it("assigns each user to their only agent when pools are disjoint", () => {
    const input = new Map([
      ["agentA", ["u1", "u2"]],
      ["agentB", ["u3", "u4"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("u1")).toBe("agentA");
    expect(result.get("u2")).toBe("agentA");
    expect(result.get("u3")).toBe("agentB");
    expect(result.get("u4")).toBe("agentB");
  });

  it("assigns each shared user to exactly one agent (no user appears twice)", () => {
    const input = new Map([
      ["agentA", ["u1", "u2", "u3"]],
      ["agentB", ["u1", "u2", "u3"]],
    ]);
    const result = buildAgentLottery(input);
    // map size = 3 (one entry per user, not 6)
    expect(result.size).toBe(3);
    for (const userId of ["u1", "u2", "u3"]) {
      const assigned = result.get(userId);
      expect(["agentA", "agentB"]).toContain(assigned);
    }
  });

  it("produces approximately uniform distribution for 3 agents sharing a large pool", () => {
    const userIds = Array.from({ length: 900 }, (_, i) => `user${i}`);
    const input = new Map([
      ["agentA", userIds],
      ["agentB", userIds],
      ["agentC", userIds],
    ]);
    const result = buildAgentLottery(input);
    const counts: Record<string, number> = { agentA: 0, agentB: 0, agentC: 0 };
    for (const agentId of result.values()) {
      counts[agentId] = (counts[agentId] ?? 0) + 1;
    }
    // Each agent gets ~300 ± 90 (30% slack around expected 300)
    expect(counts["agentA"]).toBeGreaterThan(200);
    expect(counts["agentB"]).toBeGreaterThan(200);
    expect(counts["agentC"]).toBeGreaterThan(200);
    // Total = 900 (each user assigned exactly once)
    expect(result.size).toBe(900);
  });

  it("agent with empty pool does not steal users from a pool-sharing partner", () => {
    const input = new Map([
      ["agentA", [] as string[]],
      ["agentB", ["u1", "u2"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("u1")).toBe("agentB");
    expect(result.get("u2")).toBe("agentB");
  });

  it("mixed disjoint and shared: disjoint users go to their agent, shared users go to one", () => {
    const input = new Map([
      ["agentA", ["exclusive_A", "shared"]],
      ["agentB", ["exclusive_B", "shared"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("exclusive_A")).toBe("agentA");
    expect(result.get("exclusive_B")).toBe("agentB");
    const sharedAssigned = result.get("shared");
    expect(["agentA", "agentB"]).toContain(sharedAssigned);
    // Still only one entry for "shared"
    expect(result.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/unit/agent-lottery.test.ts
```

Expected: All tests fail with `Cannot find module '@/lib/engine/agent-lottery'`

- [ ] **Step 3: Implement `buildAgentLottery`**

Create `src/lib/engine/agent-lottery.ts`:

```typescript
/**
 * Assigns each eligible user to exactly one agent for a single cron run.
 *
 * For users eligible for only one agent: assigned to that agent.
 * For users eligible for multiple agents: randomly assigned to one,
 * producing an approximately uniform distribution across agents.
 *
 * @param eligibleUsersByAgent  Map of agentId → array of externalUserIds
 * @returns                     Map of externalUserId → agentId
 */
export function buildAgentLottery(
  eligibleUsersByAgent: Map<string, string[]>,
): Map<string, string> {
  // Invert: user → list of agents that want them
  const candidatesByUser = new Map<string, string[]>();
  for (const [agentId, userIds] of eligibleUsersByAgent) {
    for (const userId of userIds) {
      const existing = candidatesByUser.get(userId) ?? [];
      existing.push(agentId);
      candidatesByUser.set(userId, existing);
    }
  }

  // Assign each user to one agent at random
  const result = new Map<string, string>();
  for (const [userId, candidates] of candidatesByUser) {
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    result.set(userId, chosen);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
bun test tests/unit/agent-lottery.test.ts
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 5: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/engine/agent-lottery.ts tests/unit/agent-lottery.test.ts
git commit -m "feat: add buildAgentLottery pure engine function"
```

---

## Task 3: Cron pre-assignment phase + lottery filter on user pagination

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Modify: `tests/integration/cron-send.test.ts`

Context: The existing cron fetches all active agents, then loops through them independently — a user in 2 agents' personas gets 2 sends. This task adds a phase before the loop that builds `lotteryMap`, then filters each agent's user pagination to only lottery-assigned users.

- [ ] **Step 1: Write failing integration tests for the lottery**

Add a new `describe` block to `tests/integration/cron-send.test.ts`:

```typescript
describe("Lottery: cross-agent user distribution", () => {
  it("user shared by two agents receives exactly one send", async () => {
    const persona  = await createPersona();
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id, { brazeCampaignId: "camp_A" });
    const msgB     = await createMessage(agentB.id, { brazeCampaignId: "camp_B" });
    await createVariant(msgA.id, { brazeVariantId: "var_A" });
    await createVariant(msgB.id, { brazeVariantId: "var_B" });
    await createUser("usr_shared", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    expect(body.ok).toBe(true);

    const decisions = await prisma.userDecision.findMany({
      where: { userId: "usr_shared" },
    });
    expect(decisions).toHaveLength(1);  // exactly one send
  });

  it("users with disjoint personas each receive one send from their respective agent", async () => {
    const personaA = await createPersona({ name: "Persona A" });
    const personaB = await createPersona({ name: "Persona B" });
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id, { brazeCampaignId: "camp_A2" });
    const msgB     = await createMessage(agentB.id, { brazeCampaignId: "camp_B2" });
    await createVariant(msgA.id);
    await createVariant(msgB.id);
    await createUser("usr_only_A", { personaId: personaA.id });
    await createUser("usr_only_B", { personaId: personaB.id });
    await linkAgentToPersona(agentA.id, personaA.id);
    await linkAgentToPersona(agentB.id, personaB.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decisionsA = await prisma.userDecision.findMany({ where: { userId: "usr_only_A" } });
    const decisionsB = await prisma.userDecision.findMany({ where: { userId: "usr_only_B" } });
    expect(decisionsA).toHaveLength(1);
    expect(decisionsB).toHaveLength(1);
    // Each user was sent to by their own agent
    expect(decisionsA[0].agentId).toBe(agentA.id);
    expect(decisionsB[0].agentId).toBe(agentB.id);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Lottery"
```

Expected: Both tests fail (shared user gets 2 sends with current code).

- [ ] **Step 3: Add imports to the cron route**

Open `src/app/api/cron/select-and-send/route.ts` and add at the top (with existing imports):

```typescript
import { buildAgentLottery } from "@/lib/engine/agent-lottery";
import { getTodayStartUTC }  from "@/lib/engine/scheduling";
```

- [ ] **Step 4: Add pre-assignment phase to the cron route**

Open `src/app/api/cron/select-and-send/route.ts`.

Locate the line `for (const agent of agents) {` (start of the agent loop, around line 58). Insert the pre-assignment phase immediately BEFORE this line:

```typescript
// ── Pre-assignment phase: build lottery map once for the entire cron run ──
// For each agent, fetch eligible user IDs (lightweight — IDs only).
// Then assign each user to exactly one agent via random lottery.
const eligibleUsersByAgent = new Map<string, string[]>();
for (const agent of agents) {
  const personaIds = agent.personaTargets.map((pt) => pt.personaId);
  if (personaIds.length === 0) {
    eligibleUsersByAgent.set(agent.id, []);
    continue;
  }
  const rows = await prisma.trackedUser.findMany({
    where:  { personaId: { in: personaIds } },
    select: { externalId: true },
  });
  eligibleUsersByAgent.set(agent.id, rows.map((r) => r.externalId));
}

const lotteryMap = buildAgentLottery(eligibleUsersByAgent);
// lotteryMap: Map<externalUserId, agentId>  — held in memory for this run
// ── End pre-assignment phase ──────────────────────────────────────────────
```

- [ ] **Step 5: Filter user pagination by lottery assignment**

Still in `src/app/api/cron/select-and-send/route.ts`, inside the `for (const agent of agents)` loop.

Find the block starting with `const personaIds = agent.personaTargets.map(...)` and the subsequent `if (personaIds.length === 0) continue;`. After that `continue`, add:

```typescript
    // Derive the users assigned to this agent by the lottery
    const assignedUserIds = [...lotteryMap.entries()]
      .filter(([, aid]) => aid === agent.id)
      .map(([uid]) => uid);

    // If no users were assigned to this agent in this run, skip it entirely
    if (assignedUserIds.length === 0) continue;
```

Then find the paginated `prisma.trackedUser.findMany` call inside the `while (true)` loop:

```typescript
      const users = await prisma.trackedUser.findMany({
        where: { personaId: { in: personaIds } },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
```

Replace the `where` clause to add the lottery filter:

```typescript
      const users = await prisma.trackedUser.findMany({
        where: {
          personaId:  { in: personaIds },
          externalId: { in: assignedUserIds },
        },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
```

- [ ] **Step 6: Run the lottery tests**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Lottery"
```

Expected: Both lottery tests pass.

- [ ] **Step 7: Run full cron test suite to check for regressions**

```bash
bun test tests/integration/cron-send.test.ts
```

Expected: All pre-existing tests still pass.

- [ ] **Step 8: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts
git commit -m "feat: cron pre-assignment phase — agent lottery filter on user pagination"
```

---

## Task 4: Global daily cap inside per-agent loop

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Modify: `tests/integration/cron-send.test.ts`

Context: Even with the lottery, a user could receive multiple sends in edge cases: manual re-runs, partial failure recovery, or a mid-run persona update. The global daily cap is a safety net — it queries `UserDecision` (no `agentId` filter) for users already sent today and suppresses them.

- [ ] **Step 1: Write failing integration tests for the global daily cap**

First, add `createUserDecision` to the import at the top of `tests/integration/cron-send.test.ts`:

```typescript
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
  createUserDecision,   // ← add this
} from "../helpers/builders";
```

Then add a new `describe` block at the bottom of `tests/integration/cron-send.test.ts`:

```typescript
describe("Global daily cap", () => {
  it("second cron run on the same day sends to zero users", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_dailycap" });
    await createVariant(msg.id);
    await createUser("usr_capped", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // First run — should send
    const res1  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body1 = await res1.json();
    expect(body1.sent).toBe(1);

    // Second run — same calendar day, global cap should block
    const res2  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body2 = await res2.json();
    expect(body2.sent).toBe(0);
    expect(body2.suppressed).toBeGreaterThanOrEqual(1);
  });

  it("user sent yesterday is eligible again today", async () => {
    const persona  = await createPersona();
    const agent    = await createAgent();
    const msg      = await createMessage(agent.id, { brazeCampaignId: "camp_yesterday" });
    await createVariant(msg.id);
    await createUser("usr_yesterday", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Seed a UserDecision from 2 days ago (definitely before today's midnight ET)
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    await createUserDecision({
      agentId: agent.id,
      userId:  "usr_yesterday",
      sentAt:  twoDaysAgo,
    });

    // Cron run today — user should NOT be capped
    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();
    expect(body.sent).toBe(1);
  });

  it("cross-agent: user sent by agentA today is suppressed when agentB tries to send", async () => {
    const persona  = await createPersona();
    const agentA   = await createAgent({ name: "Agent A" });
    const agentB   = await createAgent({ name: "Agent B" });
    const msgA     = await createMessage(agentA.id);
    const msgB     = await createMessage(agentB.id);
    await createVariant(msgA.id);
    await createVariant(msgB.id);
    const user     = await createUser("usr_cross_cap", { personaId: persona.id });
    await linkAgentToPersona(agentA.id, persona.id);
    await linkAgentToPersona(agentB.id, persona.id);
    await createSchedulingRule(agentA.id);
    await createSchedulingRule(agentB.id);

    // Pre-seed a decision from agentA today (before this cron run)
    await createUserDecision({
      agentId: agentA.id,
      userId:  user.externalId,
      sentAt:  new Date(),
    });

    // The lottery will assign the user to one of the agents.
    // Regardless of which one, the daily cap should catch it.
    const res  = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    const body = await res.json();

    // User already has a decision today → should not get another
    const decisions = await prisma.userDecision.findMany({
      where: { userId: user.externalId },
    });
    // Still 1 (the pre-seeded one) — cron did not add a second
    expect(decisions).toHaveLength(1);
    expect(body.suppressed).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Global daily cap"
```

Expected: First and third tests fail (no daily cap yet). Second test may pass coincidentally — that's fine.

- [ ] **Step 3: Add global daily cap query inside the per-agent loop**

Open `src/app/api/cron/select-and-send/route.ts`.

Inside the `while (true)` pagination loop, after the existing frequency cap block (which ends with building `freqCappedUserIds`), and after the smart suppression block (which ends with building `smartSuppressedUserIds`), add the global daily cap:

The existing suppression count and filter currently reads:
```typescript
      // Count suppressed users
      for (const u of users) {
        if (freqCappedUserIds.has(u.externalId) || smartSuppressedUserIds.has(u.externalId)) {
          totalSuppressed++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) => !freqCappedUserIds.has(u.externalId) && !smartSuppressedUserIds.has(u.externalId)
      );
```

Replace these two blocks with:

```typescript
      // 4d. Global daily cap — cross-agent guard (no agentId filter intentional)
      const todayStart = getTodayStartUTC("America/New_York");
      const sentTodayRows = await prisma.userDecision.findMany({
        where: {
          userId: { in: userExternalIds },
          sentAt: { gte: todayStart },
          // intentionally no agentId filter — cross-agent
        },
        select:   { userId: true },
        distinct: ["userId"],
      });
      const sentTodayIds = new Set(sentTodayRows.map((r) => r.userId));

      // Count suppressed users (freq cap + smart suppress + global daily cap)
      for (const u of users) {
        if (
          freqCappedUserIds.has(u.externalId) ||
          smartSuppressedUserIds.has(u.externalId) ||
          sentTodayIds.has(u.externalId)
        ) {
          totalSuppressed++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) =>
          !freqCappedUserIds.has(u.externalId) &&
          !smartSuppressedUserIds.has(u.externalId) &&
          !sentTodayIds.has(u.externalId)
      );
```

**Note:** `userExternalIds` is already defined earlier in the frequency cap block as `const userExternalIds = users.map((u) => u.externalId);`. Confirm it exists before this insertion point — if not, add it just before the frequency cap block:

```typescript
      const userExternalIds = users.map((u) => u.externalId);
```

- [ ] **Step 4: Run the daily cap tests**

```bash
bun test tests/integration/cron-send.test.ts --test-name-pattern "Global daily cap"
```

Expected: All 3 tests pass.

- [ ] **Step 5: Run full cron test suite**

```bash
bun test tests/integration/cron-send.test.ts
```

Expected: All tests pass — original tests, lottery tests, and daily cap tests.

- [ ] **Step 6: Run typecheck**

```bash
bun run check
```

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts
git commit -m "feat: global daily cap — cross-agent one-push-per-day safety net"
```

---

## Verification

After all tasks complete, run the full test suite:

```bash
bun test tests/unit/scheduling.test.ts tests/unit/agent-lottery.test.ts tests/integration/cron-send.test.ts
bun run check
```

Expected: All unit and integration tests pass, no type or lint errors.
