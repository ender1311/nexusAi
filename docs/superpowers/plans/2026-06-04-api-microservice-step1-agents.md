# API Microservice Step 1 — Agents POC on Vercel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `nexus-api` Hono service the single owner of `POST /agents` DB writes (validation + nested create + segment/persona logic) and turn the Next.js `POST /api/agents` into a thin authenticated proxy, while removing the abandoned Fly.io deploy path so Vercel is the sole deploy target.

**Architecture:** The Next.js route keeps WorkOS `requireAdmin()` then forwards the body to the Hono service via `apiFetch(... isAdmin: true)`. All field validation, the 409 segment-uniqueness checks, the nested agent/goal/message/variant create, the `agentPersonaTarget.createMany` follow-up, and the cache `revalidate` move into `apps/api/src/routes/agents.ts`. Errors propagate to the client through `ApiError.status`. The comprehensive POST behaviour is tested against the in-process Hono app; the Next route keeps only thin proxy tests with `apiFetch` mocked.

**Tech Stack:** Bun + Hono 4, Prisma 7 + Neon, Next.js 16 App Router, bun:test.

---

## Background the implementer must know

- **Two source files matter.** `src/app/api/agents/route.ts` (Next.js) currently holds the *authoritative, up-to-date* `POST` logic — including `segmentTargeting`, `targetSegmentName`, `uniqueUsersCap` (default 1000), `dailySendCap` (default 500), the 409 segment-uniqueness conflict checks, and `targetPersonaIds`. `apps/api/src/routes/agents.ts` (Hono) has a **stale** `POST` that predates all of that. Task 2 ports the authoritative logic into the Hono route. Task 3 deletes it from the Next route and replaces it with a proxy.
- **The Hono app is tested in-process.** `tests/integration/api-service/agents.test.ts` imports `app` from `apps/api/src/app.ts` and calls `app.request("/agents", …)`. No server runs; Prisma hits the local `nexus_test` DB. This is where the full POST coverage belongs after migration.
- **`apiFetch` throws `ApiError(status, message)`** (`src/lib/api-client.ts`) on any non-2xx, carrying the upstream status. The proxy uses this to forward 400/409 to the client.
- **Auth split:** Next.js verifies the WorkOS session (`requireAdmin()`); the Hono route enforces `isNotAdmin(c)` against the `X-User-Role: admin` header that `apiFetch({ isAdmin: true })` adds.
- **Funnel stages match** between `apps/api/src/lib/constants.ts` and `src/types/agent.ts`: `["new","dau4","wau","mau","lapsed_dau4","lapsed_wau","lapsed_mau"]`.
- **`segmentTargeting` null persistence uses `Prisma.DbNull`** (mirror the Next route exactly — not `JsonNull`).
- **Test DB:** these tests run under `bun run test:int` against `nexus_test`. Never point them at `.env.local` (production). Use `bun test` only.

---

## File Map

**Deleted by this plan:**
```
apps/api/fly.toml          Abandoned Fly.io deploy config (Vercel is the target)
apps/api/Dockerfile        Fly.io container build (unused on Vercel)
```

**Modified by this plan:**
```
apps/api/src/routes/agents.ts          POST ported to authoritative logic
src/app/api/agents/route.ts            POST becomes apiFetch proxy; prisma & validation imports dropped
tests/integration/api-service/agents.test.ts   Add full POST coverage (validation, caps, segments, personas)
tests/integration/agents.test.ts       Remove POST-via-Prisma describe blocks; add thin proxy tests (apiFetch mocked)
```

---

## Task 1: Remove the Fly.io deploy path

**Files:**
- Delete: `apps/api/fly.toml`
- Delete: `apps/api/Dockerfile`

- [ ] **Step 1: Confirm nothing references the Fly files**

Run:
```bash
grep -rn "fly.toml\|Dockerfile\|fly.dev\|flyctl" --include="*.ts" --include="*.json" --include="*.md" apps/api src docs/superpowers/specs/2026-06-04-api-microservice-app-surface-design.md
```
Expected: matches only inside the spec doc (prose) and possibly the old `2026-05-15` plan — **no** runtime `.ts`/config references. If a runtime file references them, stop and report.

- [ ] **Step 2: Delete the two files**

```bash
git rm apps/api/fly.toml apps/api/Dockerfile
```

- [ ] **Step 3: Verify the Vercel entry is intact**

```bash
test -f apps/api/api/index.ts && test -f apps/api/vercel.json && test -f apps/api/.vercel/project.json && echo "vercel path OK"
```
Expected: prints `vercel path OK`.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api
git commit -m "chore(api): remove abandoned Fly.io deploy path; Vercel is the sole target"
```

---

## Task 2: Port the authoritative POST /agents into the Hono route

This task is TDD: write the failing API-service tests first, watch them fail, then port the logic, then watch them pass.

**Files:**
- Test: `tests/integration/api-service/agents.test.ts`
- Modify: `apps/api/src/routes/agents.ts`

- [ ] **Step 1: Add the new failing tests to `tests/integration/api-service/agents.test.ts`**

Append these `describe` blocks to the existing file (keep all current tests):

```typescript
describe("POST /agents — caps defaults", () => {
  it("defaults uniqueUsersCap to 1000 when omitted", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps A", funnelStage: "wau", goals: [], messages: [] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { uniqueUsersCap: number | null };
    expect(body.uniqueUsersCap).toBe(1000);
  });

  it("defaults dailySendCap to 500 when omitted", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps B", funnelStage: "wau", goals: [], messages: [] }),
    });
    const body = await res.json() as { dailySendCap: number | null };
    expect(body.dailySendCap).toBe(500);
  });

  it("accepts null uniqueUsersCap (unlimited) and persists null", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps C", funnelStage: "wau", uniqueUsersCap: null, goals: [], messages: [] }),
    });
    const body = await res.json() as { uniqueUsersCap: number | null };
    expect(body.uniqueUsersCap).toBeNull();
  });

  it("returns 400 when uniqueUsersCap is 0", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps D", funnelStage: "wau", uniqueUsersCap: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when dailySendCap is negative", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Caps E", funnelStage: "wau", dailySendCap: -3 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — name validation", () => {
  it("returns 400 when name is empty string", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "   ", funnelStage: "wau" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("name is required");
  });
});

describe("POST /agents — targetSegmentName", () => {
  it("persists targetSegmentName when provided", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg A", funnelStage: "wau", targetSegmentName: "vip-users", goals: [], messages: [] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { targetSegmentName: string | null };
    expect(body.targetSegmentName).toBe("vip-users");
  });

  it("returns 409 when targetSegmentName is already assigned to another agent", async () => {
    await createAgent({ name: "Owner", targetSegmentName: "exclusive-seg" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg B", funnelStage: "wau", targetSegmentName: "exclusive-seg" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 when targetSegmentName is an empty string", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ name: "Seg C", funnelStage: "wau", targetSegmentName: "  " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — segmentTargeting", () => {
  it("persists includes/excludes and bypasses funnelStage requirement", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg A",
        segmentTargeting: { includes: ["seg-1", "seg-2"], excludes: ["seg-3"] },
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { segmentTargeting: { includes: string[]; excludes: string[] } };
    expect(body.segmentTargeting.includes).toEqual(["seg-1", "seg-2"]);
    expect(body.segmentTargeting.excludes).toEqual(["seg-3"]);
  });

  it("returns 400 when an include also appears in excludes", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg B",
        segmentTargeting: { includes: ["dup"], excludes: ["dup"] },
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when an include segment is exclusively held by another agent", async () => {
    await createAgent({ name: "Holder", targetSegmentName: "held-seg" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg C",
        segmentTargeting: { includes: ["held-seg"], excludes: [] },
      }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for a non-string include entry", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "MultiSeg D",
        segmentTargeting: { includes: [123], excludes: [] },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /agents — targetPersonaIds", () => {
  it("creates AgentPersonaTarget rows for each persona id", async () => {
    const p1 = await createPersona({ name: "P1" });
    const p2 = await createPersona({ name: "P2" });
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Persona Agent",
        funnelStage: "wau",
        targetPersonaIds: [p1.id, p2.id],
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    const targets = await prisma.agentPersonaTarget.findMany({ where: { agentId: body.id } });
    expect(targets.length).toBe(2);
  });
});

describe("POST /agents — nested goals & messages", () => {
  it("creates goals, messages, and variants and computes testedVariables", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        name: "Nested Agent",
        funnelStage: "wau",
        goals: [{ eventName: "purchase", tier: "primary", valueWeight: 2 }],
        messages: [{
          name: "M1",
          channel: "push",
          variants: [
            { name: "A", body: "Hello", title: "T1" },
            { name: "B", body: "Hello", title: "T2" },
          ],
        }],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    const msg = await prisma.message.findFirst({ where: { agentId: body.id } });
    expect(msg).not.toBeNull();
    // title differs across variants → "title" is a tested variable
    expect(msg!.testedVariables).toContain("title");
    const goalCount = await prisma.goal.count({ where: { agentId: body.id } });
    expect(goalCount).toBe(1);
  });
});
```

Add the `createPersona` import at the top of the file (next to `createAgent`):

```typescript
import { createAgent, createPersona } from "../../helpers/builders";
```

- [ ] **Step 2: Run the new tests and confirm they fail**

```bash
bun run test:int tests/integration/api-service/agents.test.ts
```
Expected: the new caps/segment/persona/nested tests FAIL (the stale Hono POST returns 201 with `uniqueUsersCap`/`dailySendCap` undefined, ignores `segmentTargeting`/`targetSegmentName`/`targetPersonaIds`, and has no 409 checks). The pre-existing GET/POST tests still pass.

- [ ] **Step 3: Replace `apps/api/src/routes/agents.ts` with the ported logic**

```typescript
import { Hono } from "hono";
import { prisma } from "../lib/db";
import { Prisma } from "../generated/prisma/client";
import { revalidate } from "../lib/revalidate";
import { isNotAdmin } from "../middleware/auth";
import { LIBRARY_AGENT_NAME, FUNNEL_STAGES } from "../lib/constants";
import { detectTestedVariables, type MessageVariant } from "../lib/variant-diff";

const agents = new Hono();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const VALID_STAGES = new Set(FUNNEL_STAGES);

agents.get("/", async (c) => {
  try {
    const result = await prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      include: {
        _count: { select: { goals: true, messages: true, decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return c.json(result, 200, {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("GET /agents error:", error);
    return c.json({ error: "Failed to fetch agents" }, 500);
  }
});

agents.post("/", async (c) => {
  if (isNotAdmin(c)) return c.json({ error: "Forbidden" }, 403);

  let body: Record<string, unknown> | null;
  try {
    body = (await c.req.json()) as Record<string, unknown> | null;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const {
    name,
    description,
    algorithm,
    epsilon,
    goals,
    messages,
    frequencyCap,
    quietStart,
    quietEnd,
    timezone,
    quietDays,
    smartSuppress,
    suppressThresh,
    funnelStage,
    targetFilter,
    uniqueUsersCap,
    dailySendCap,
    targetPersonaIds,
    targetSegmentName,
  } = body;
  const segmentTargeting = body.segmentTargeting as unknown;

  if (typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  if (segmentTargeting !== undefined && segmentTargeting !== null) {
    if (
      typeof segmentTargeting !== "object" ||
      Array.isArray(segmentTargeting) ||
      !Array.isArray((segmentTargeting as { includes?: unknown }).includes) ||
      !Array.isArray((segmentTargeting as { excludes?: unknown }).excludes) ||
      (segmentTargeting as { includes: unknown[] }).includes.some((s: unknown) => typeof s !== "string" || !(s as string).trim()) ||
      (segmentTargeting as { excludes: unknown[] }).excludes.some((s: unknown) => typeof s !== "string" || !(s as string).trim())
    ) {
      return c.json({ error: "segmentTargeting must be null or { includes: string[], excludes: string[] } with non-empty strings" }, 400);
    }
    const st = segmentTargeting as { includes: string[]; excludes: string[] };
    const overlap = st.includes.filter((s: string) => st.excludes.includes(s));
    if (overlap.length > 0) {
      return c.json({ error: `Segment(s) cannot appear in both includes and excludes: ${overlap.join(", ")}` }, 400);
    }
  }

  const hasSegmentIncludes =
    Array.isArray((segmentTargeting as { includes?: unknown } | null)?.includes) &&
    ((segmentTargeting as { includes: unknown[] }).includes.length > 0);

  if (!hasSegmentIncludes) {
    if (!funnelStage || !VALID_STAGES.has(funnelStage as (typeof FUNNEL_STAGES)[number])) {
      return c.json({ error: "Invalid funnelStage" }, 400);
    }
  }

  if (targetFilter !== undefined && targetFilter !== null && !isPlainObject(targetFilter)) {
    return c.json({ error: "targetFilter must be a plain object" }, 400);
  }

  if (uniqueUsersCap !== undefined && uniqueUsersCap !== null) {
    if (!Number.isInteger(uniqueUsersCap) || (uniqueUsersCap as number) < 1) {
      return c.json({ error: "uniqueUsersCap must be null or a positive integer" }, 400);
    }
  }

  if (dailySendCap !== undefined && dailySendCap !== null) {
    if (!Number.isInteger(dailySendCap) || (dailySendCap as number) < 1) {
      return c.json({ error: "dailySendCap must be null or a positive integer" }, 400);
    }
  }

  if (targetSegmentName !== undefined && targetSegmentName !== null && (typeof targetSegmentName !== "string" || (targetSegmentName as string).trim().length === 0)) {
    return c.json({ error: "targetSegmentName must be null or a non-empty string" }, 400);
  }

  if (quietDays !== undefined) {
    if (!Array.isArray(quietDays) || (quietDays as unknown[]).some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) {
      return c.json({ error: "quietDays must be an array of day-of-week numbers (0–6)" }, 400);
    }
  }

  try {
    if (targetSegmentName && typeof targetSegmentName === "string") {
      const trimmed = (targetSegmentName as string).trim();
      const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: trimmed }, select: { name: true } });
      if (conflict) {
        return c.json({ error: `Segment "${trimmed}" is already assigned to agent "${conflict.name}"` }, 409);
      }
    }
    if (hasSegmentIncludes) {
      const includeSegs = (segmentTargeting as { includes: string[] }).includes;
      for (const seg of includeSegs) {
        const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: seg }, select: { name: true } });
        if (conflict) {
          return c.json({ error: `Segment "${seg}" is exclusively assigned to agent "${conflict.name}"` }, 409);
        }
      }
    }

    const goalList = Array.isArray(goals) ? (goals as Array<Record<string, unknown>>) : [];
    const messageList = Array.isArray(messages) ? (messages as Array<Record<string, unknown>>) : [];
    const personaIds = Array.isArray(targetPersonaIds) ? (targetPersonaIds as string[]) : [];
    const qDays = Array.isArray(quietDays) ? (quietDays as number[]) : [];

    const agent = await prisma.agent.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" ? description : undefined,
        algorithm: typeof algorithm === "string" ? algorithm : "thompson",
        epsilon: typeof epsilon === "number" ? epsilon : 0.1,
        status: "draft",
        funnelStage: funnelStage as string,
        uniqueUsersCap: uniqueUsersCap === undefined ? 1000 : (uniqueUsersCap as number | null),
        dailySendCap: dailySendCap === undefined ? 500 : (dailySendCap as number | null),
        ...(targetSegmentName !== undefined ? { targetSegmentName: typeof targetSegmentName === "string" ? (targetSegmentName as string).trim() : null } : {}),
        ...(segmentTargeting !== undefined ? {
          segmentTargeting: segmentTargeting === null
            ? Prisma.DbNull
            : {
                includes: (segmentTargeting as { includes: string[]; excludes: string[] }).includes.map((s: string) => s.trim()),
                excludes: (segmentTargeting as { includes: string[]; excludes: string[] }).excludes.map((s: string) => s.trim()),
              }
        } : {}),
        ...(targetFilter !== undefined && targetFilter !== null
          ? { targetFilter: targetFilter as Prisma.InputJsonValue }
          : {}),
        goals: {
          create: goalList.map((g) => ({
            eventName: String(g.eventName),
            tier: String(g.tier),
            valueWeight: typeof g.valueWeight === "number" ? g.valueWeight : 1.0,
            description: typeof g.description === "string" ? g.description : undefined,
            weightMode: typeof g.weightMode === "string" ? g.weightMode : "fixed",
            weightProperty: typeof g.weightProperty === "string" ? g.weightProperty : null,
            weightDefault: typeof g.weightDefault === "number" ? g.weightDefault : 1.0,
          })),
        },
        messages: {
          create: messageList.map((m) => {
            const variantList = (Array.isArray(m.variants) ? m.variants : []) as MessageVariant[];
            return {
              name: String(m.name),
              channel: String(m.channel),
              testedVariables: detectTestedVariables(variantList),
              variants: {
                create: variantList.map((v) => ({
                  name: v.name ?? "V1",
                  subject: v.subject,
                  body: v.body ?? "",
                  cta: v.cta,
                  title: v.title,
                  iconImageUrl: v.iconImageUrl,
                  deeplink: v.deeplink,
                  preferredHour: v.preferredHour,
                  preferredDayOfWeek: v.preferredDayOfWeek,
                  frequencyCapOverride: v.frequencyCapOverride ?? undefined,
                  sourceTemplateId: v.sourceTemplateId,
                })),
              },
            };
          }),
        },
        schedulingRule: {
          create: {
            frequencyCap: (isPlainObject(frequencyCap)
              ? frequencyCap
              : { maxSends: 3, period: "week" }) as Prisma.InputJsonValue,
            quietHours: {
              start: typeof quietStart === "string" ? quietStart : "22:00",
              end: typeof quietEnd === "string" ? quietEnd : "08:00",
              timezone: typeof timezone === "string" ? timezone : "America/New_York",
              ...(qDays.length > 0 ? { quietDays: qDays } : {}),
            } as Prisma.InputJsonValue,
            smartSuppress: typeof smartSuppress === "boolean" ? smartSuppress : false,
            suppressThresh: typeof suppressThresh === "number" ? suppressThresh : 0.5,
          },
        },
      },
    });

    void revalidate("agents");

    if (personaIds.length > 0) {
      await prisma.agentPersonaTarget.createMany({
        data: personaIds.map((personaId) => ({ agentId: agent.id, personaId })),
        skipDuplicates: true,
      });
    }

    return c.json(agent, 201);
  } catch (error) {
    console.error("POST /agents error:", error);
    return c.json({ error: "Failed to create agent" }, 500);
  }
});

export { agents as agentsRoute };
```

- [ ] **Step 4: Run the API-service tests and confirm they pass**

```bash
bun run test:int tests/integration/api-service/agents.test.ts
```
Expected: ALL tests pass (the original GET/POST set plus the new caps/segment/persona/nested blocks).

- [ ] **Step 5: Typecheck the API package**

```bash
bun --cwd apps/api run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/agents.ts tests/integration/api-service/agents.test.ts
git commit -m "feat(api): port authoritative POST /agents (segments, caps, personas, 409s) into Hono route"
```

---

## Task 3: Turn the Next.js POST into an apiFetch proxy

The Hono route is now authoritative, so the Next route drops its duplicated validation + Prisma write and forwards to the service, propagating upstream status via `ApiError`.

**Files:**
- Modify: `src/app/api/agents/route.ts`
- Modify: `tests/integration/agents.test.ts`

- [ ] **Step 1: Replace `src/app/api/agents/route.ts` with the proxy version**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { apiFetch, ApiError } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api/respond";

export const maxDuration = 15;

export async function GET() {
  try {
    const agents = await apiFetch<unknown[]>("/agents");
    const res = NextResponse.json(agents);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    return handleRouteError("GET /api/agents", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return fail("Invalid JSON body", 400);
  }

  try {
    const agent = await apiFetch<unknown>("/agents", {
      method: "POST",
      body: JSON.stringify(body),
      isAdmin: true,
      timeout: 15000,
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) return fail(err.message, err.status);
    return handleRouteError("POST /api/agents", err);
  }
}
```

- [ ] **Step 2: Remove the POST-via-Prisma describe blocks from `tests/integration/agents.test.ts`**

These blocks now test logic that lives in the Hono route and are covered by `tests/integration/api-service/agents.test.ts`. Delete the following `describe` blocks **and the `POST as createAgent` import/usage they depend on**:
- `describe("POST /api/agents", …)` (the top one around line 32)
- `describe("POST /api/agents — funnelStage + targetFilter", …)`
- `describe("POST /api/agents — uniqueUsersCap", …)`
- `describe("POST /api/agents — dailySendCap", …)`
- `describe("POST /api/agents — sourceTemplateId", …)`
- `describe("POST /api/agents — goal weight fields", …)`
- `describe("POST /api/agents — targetPersonaIds", …)`
- `describe("POST /api/agents — validation", …)`
- `describe("POST /api/agents — targetSegmentName", …)` (the POST one, NOT the `PATCH … targetSegmentName` block — keep all PATCH/DELETE/GET[id] blocks)

Keep: the `GET /api/agents`, `GET /api/agents/[id]`, `DELETE`, and all `PATCH` describe blocks (those routes are not migrated in this step).

After deletion, change line 8–9 from:
```typescript
// POST /api/agents now uses Prisma directly (no Fly.io proxy)
import { POST as createAgent } from "@/app/api/agents/route";
```
to remove the now-unused `POST as createAgent` import. If `createAgent` (the route POST) is no longer referenced anywhere in the file, delete the import line entirely. The `buildRequest("POST", …)` helper and any GET/PATCH/DELETE imports stay.

- [ ] **Step 3: Add thin proxy tests to `tests/integration/agents.test.ts`**

Add this block (it mocks `apiFetch` so no live service is needed). Place the mock setup near the top imports:

```typescript
import { mock } from "bun:test";
import * as apiClient from "@/lib/api-client";
import { POST as postAgents } from "@/app/api/agents/route";

describe("POST /api/agents — proxy behaviour", () => {
  it("forwards a created agent and returns 201", async () => {
    const spy = mock(() => Promise.resolve({ id: "agent_1", name: "Proxied" }));
    // @ts-expect-error override for test
    apiClient.apiFetch = spy;

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Proxied", funnelStage: "wau" }),
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(201);
    const json = await res.json() as { id: string };
    expect(json.id).toBe("agent_1");
    expect(spy).toHaveBeenCalled();
  });

  it("propagates an upstream 409 from the API service", async () => {
    const spy = mock(() => Promise.reject(new apiClient.ApiError(409, "Segment taken")));
    // @ts-expect-error override for test
    apiClient.apiFetch = spy;

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dup", funnelStage: "wau" }),
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(409);
    const json = await res.json() as { error: string };
    expect(json.error).toBe("Segment taken");
  });

  it("returns 400 for an invalid JSON body without calling the service", async () => {
    const spy = mock(() => Promise.resolve({}));
    // @ts-expect-error override for test
    apiClient.apiFetch = spy;

    const req = new Request("http://test/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await postAgents(req as unknown as Parameters<typeof postAgents>[0]);
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

> Note: `requireAdmin()` reads the WorkOS session. The existing `tests/integration/agents.test.ts` already exercises mutating routes, so the test environment short-circuits auth (no real session = the helper's test path). If `requireAdmin()` returns a 403 in this suite, mock it the same way the existing PATCH/DELETE tests do — check the top of the current file for the established auth-mock pattern and reuse it. Do not invent a new auth bypass.

- [ ] **Step 4: Run the Next.js integration tests**

```bash
bun run test:int tests/integration/agents.test.ts
```
Expected: all remaining GET/PATCH/DELETE tests pass and the three new proxy tests pass.

- [ ] **Step 5: Typecheck + lint the web package**

```bash
bun run typecheck && bun run lint
```
Expected: no errors. (If lint flags the `@ts-expect-error` lines as unused because the override typechecks cleanly, switch them to `// eslint-disable-next-line @typescript-eslint/no-explicit-any` style only if needed — prefer leaving the assignment typed.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/route.ts tests/integration/agents.test.ts
git commit -m "feat(api): proxy Next.js POST /api/agents to Hono service; relocate POST tests"
```

---

## Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check**

```bash
bun run check
```
Expected: typecheck + lint + unit/contract + integration + regression all pass. The agents POST behaviour is now covered once in the API-service suite (authoritative) and once as proxy behaviour in the web suite.

- [ ] **Step 2: Sanity-check no app-surface Prisma import remains in the agents route**

```bash
grep -n "from \"@/lib/db\"\|@/generated/prisma" src/app/api/agents/route.ts || echo "no direct prisma import — OK"
```
Expected: prints `no direct prisma import — OK`.

- [ ] **Step 3: Open the MR**

```bash
git push -u origin <branch>
glab mr create --title "feat(api): agents POST behind nexus-api service (Vercel), Fly path removed" \
  --target-branch main --fill
```

---

## Self-Review (completed by plan author)

**Spec coverage:** Step 1 of the spec = (a) delete Fly path → Task 1; (b) port full POST logic incl. segmentTargeting/targetSegmentName/caps defaults/409s/persona createMany/revalidate → Task 2; (c) flip Next POST to apiFetch proxy + drop prisma import → Task 3. Full-suite gate + MR → Task 4. Covered.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. The one judgement call (auth-mock pattern in Task 3 Step 3) explicitly points the implementer at the existing pattern in the same file rather than inventing one — this is intentional because the established mock must be reused, not guessed.

**Type consistency:** Hono route uses `MessageVariant` from `apps/api/src/lib/variant-diff.ts` (matches the existing import in that file). `ApiError`/`apiFetch` names match `src/lib/api-client.ts`. `fail`/`handleRouteError` match `src/lib/api/respond.ts`. `Prisma.DbNull` mirrors the current Next route. Funnel stages match across both `constants.ts` files.
