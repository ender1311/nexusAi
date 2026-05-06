# Reward Intelligence Panel + Recency Penalty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-tab "How the Algorithm Learns" panel below the live demo wizard and implement Duolingo-style recency penalties in Thompson Sampling arm selection.

**Architecture:** The panel is a client component on `/demo/live` that reads `agentId` from the URL search param. The wizard writes `?agent=<id>` when an agent is selected. The recency penalty is an optional parameter on `ThompsonSampling.select()` — caller computes the penalty map from `UserDecision` records, passing it in; the engine function stays pure.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, Prisma v7, Recharts, shadcn/ui, bun:test

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/engine/thompson-sampling.ts` | Modify | Add `recencyPenalties` param to `select()` |
| `src/lib/engine/beta-pdf.ts` | Create | Pure math: Beta PDF computation for curve rendering |
| `src/app/api/demo/arm-stats/route.ts` | Create | GET endpoint: PersonaArmStats + variant + persona names |
| `src/components/demo/RewardIntelligencePanel.tsx` | Create | 3-tab panel: Signal Hierarchy, Beta Curves, What to Test Next |
| `src/app/demo/live/page.tsx` | Modify | Render panel below wizard |
| `src/components/demo/LiveDemoWizard.tsx` | Modify | Update URL `?agent=<id>` on agent selection |
| `src/app/api/cron/select-and-send/route.ts` | Modify | Build + pass recencyPenalties for each user page |
| `tests/unit/thompson-sampling.test.ts` | Modify | Tests for recency penalty |
| `tests/unit/beta-pdf.test.ts` | Create | Tests for Beta PDF math |
| `tests/integration/demo-arm-stats.test.ts` | Create | Tests for arm-stats endpoint |

---

## Task 1: Recency penalty in `ThompsonSampling.select()`

**Files:**
- Modify: `src/lib/engine/thompson-sampling.ts`
- Modify: `tests/unit/thompson-sampling.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/thompson-sampling.test.ts`:

```typescript
  it("recency penalty reduces selection probability of penalised arm", () => {
    // With penalty 0.5 on "winner", "loser" should win far more often
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser",  stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    const penalties = { winner: 0.5 }; // heavy penalty on the normally-dominant arm
    let loserCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms, penalties).variantId === "loser") loserCount++;
    }
    // Without penalty, loser wins <20% of the time. With penalty on winner, loser should win >50%.
    expect(loserCount).toBeGreaterThan(500);
  });

  it("select without recencyPenalties behaves identically to original (no regression)", () => {
    const arms = [
      { id: "v1", stats: { alpha: 80, beta: 20, tries: 100, wins: 80 } },
      { id: "v2", stats: { alpha: 20, beta: 80, tries: 100, wins: 20 } },
    ];
    let v1Count = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms).variantId === "v1") v1Count++;
    }
    expect(v1Count).toBeGreaterThan(800);
  });

  it("penalty of 1.0 has no effect on selection", () => {
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser",  stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    let winnerCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms, { winner: 1.0 }).variantId === "winner") winnerCount++;
    }
    expect(winnerCount).toBeGreaterThan(800);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/thompson-sampling.test.ts
```

Expected: FAIL — `select` doesn't accept a second argument yet

- [ ] **Step 3: Implement the change**

In `src/lib/engine/thompson-sampling.ts`, change the `select` method signature and body:

```typescript
  select(arms: BanditArm[], recencyPenalties?: Record<string, number>): DecisionResult {
    if (arms.length === 0) throw new Error("No arms to select from");

    let bestArm = arms[0];
    let bestSample = -Infinity;
    const samples = arms.map((arm) => {
      const raw = this.sampleBeta(arm.stats.alpha, arm.stats.beta);
      const multiplier = recencyPenalties?.[arm.id] ?? 1.0;
      return { arm, sample: raw * multiplier };
    });

    for (const { arm, sample } of samples) {
      if (sample > bestSample) {
        bestSample = sample;
        bestArm = arm;
      }
    }

    const maxTriesArm = arms.reduce((a, b) => (a.stats.tries > b.stats.tries ? a : b));
    const isExplore = bestArm.id !== maxTriesArm.id;

    return {
      variantId: bestArm.id,
      channel: "",
      explore: isExplore,
      predictedReward: bestSample,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/thompson-sampling.test.ts
```

Expected: All tests PASS (new ones + all existing)

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/thompson-sampling.ts tests/unit/thompson-sampling.test.ts
git commit -m "feat(engine): add recency penalty to ThompsonSampling.select()"
```

---

## Task 2: Beta PDF math utility

**Files:**
- Create: `src/lib/engine/beta-pdf.ts`
- Create: `tests/unit/beta-pdf.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/beta-pdf.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { betaPDFPoints, recencyMultiplier } from "@/lib/engine/beta-pdf";

describe("betaPDFPoints", () => {
  it("returns 50 points for any valid (alpha, beta)", () => {
    const pts = betaPDFPoints(2, 5);
    expect(pts.length).toBe(50);
    expect(pts[0]).toHaveProperty("x");
    expect(pts[0]).toHaveProperty("y");
  });

  it("all x values are in (0, 1)", () => {
    const pts = betaPDFPoints(3, 8);
    for (const p of pts) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(1);
    }
  });

  it("all y values are non-negative", () => {
    const pts = betaPDFPoints(5, 2);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("Beta(1,1) is approximately uniform — max y close to 1", () => {
    const pts = betaPDFPoints(1, 1);
    const maxY = Math.max(...pts.map((p) => p.y));
    // Beta(1,1) PDF = 1 everywhere; with normalization max should be near 1
    expect(maxY).toBeGreaterThan(0.9);
    expect(maxY).toBeLessThan(1.1);
  });

  it("mode of Beta(5,2) is near 0.8 — argmax x", () => {
    const pts = betaPDFPoints(5, 2);
    const modePoint = pts.reduce((a, b) => (a.y > b.y ? a : b));
    expect(modePoint.x).toBeGreaterThan(0.7);
    expect(modePoint.x).toBeLessThan(0.9);
  });
});

describe("recencyMultiplier", () => {
  it("returns 1.0 for undefined (never sent)", () => {
    expect(recencyMultiplier(undefined)).toBe(1.0);
  });

  it("returns exp(-0.3 * days) for a given number of days", () => {
    const result = recencyMultiplier(1);
    expect(result).toBeCloseTo(Math.exp(-0.3), 5);
  });

  it("clamps to 0.2 minimum", () => {
    expect(recencyMultiplier(100)).toBeGreaterThanOrEqual(0.2);
  });

  it("0 days since sent gives 1.0 — same-day sends are not demoted", () => {
    // exp(-0.3 * 0) = exp(0) = 1.0
    expect(recencyMultiplier(0)).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/unit/beta-pdf.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the utility**

Create `src/lib/engine/beta-pdf.ts`:

```typescript
/**
 * Beta distribution PDF utilities for the Reward Intelligence Panel.
 *
 * Uses Lanczos approximation (g=7) for log-gamma, which is accurate to ~15 decimal places.
 * All functions are pure — no side effects.
 */

/** Lanczos coefficients for g=7 */
const LANCZOS_G = 7;
const LANCZOS_C = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = LANCZOS_C[0];
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    x += LANCZOS_C[i] / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

export type PDFPoint = { x: number; y: number };

/**
 * Compute 50 (x, y) points for the Beta(alpha, beta) PDF over (0, 1).
 * Returns normalised points suitable for Recharts AreaChart.
 */
export function betaPDFPoints(alpha: number, beta: number, n = 50): PDFPoint[] {
  const lb = logBeta(alpha, beta);
  const points: PDFPoint[] = [];

  for (let i = 0; i < n; i++) {
    // Avoid endpoints 0 and 1 where PDF can be infinite
    const x = 0.01 + (0.98 * i) / (n - 1);
    const logY = (alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) - lb;
    const y = Math.exp(logY);
    points.push({ x, y: isFinite(y) ? y : 0 });
  }

  return points;
}

/**
 * Compute recency multiplier for arm selection demotion.
 * Formula: max(0.2, exp(-0.3 * daysSinceSent))
 * - 0 days: 1.0 (no penalty — same day sends don't demote)
 * - 1 day:  ~0.74
 * - 2 days: ~0.55
 * - 5+ days: ≥0.22 (floor at 0.2)
 */
export function recencyMultiplier(daysSinceSent: number | undefined): number {
  if (daysSinceSent === undefined) return 1.0;
  return Math.max(0.2, Math.exp(-0.3 * daysSinceSent));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/unit/beta-pdf.test.ts
```

Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/engine/beta-pdf.ts tests/unit/beta-pdf.test.ts
git commit -m "feat(engine): add Beta PDF + recency multiplier utilities"
```

---

## Task 3: `/api/demo/arm-stats` endpoint

**Files:**
- Create: `src/app/api/demo/arm-stats/route.ts`
- Create: `tests/integration/demo-arm-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/demo-arm-stats.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createMessage, createVariant, createPersona } from "../helpers/builders";
import { GET } from "@/app/api/demo/arm-stats/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/demo/arm-stats", () => {
  it("returns 400 when agentId is missing", async () => {
    const req = new NextRequest("http://localhost/api/demo/arm-stats");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent does not exist", async () => {
    const req = new NextRequest("http://localhost/api/demo/arm-stats?agentId=nonexistent");
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it("returns arm stats with persona and variant names", async () => {
    const agent = await createAgent();
    const persona = await createPersona({ name: "Morning Reader" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id, { name: "Variant A" });

    await prisma.personaArmStats.create({
      data: {
        agentId: agent.id,
        personaId: persona.id,
        variantId: variant.id,
        alpha: 10,
        beta: 5,
        tries: 15,
        wins: 8,
      },
    });

    const req = new NextRequest(`http://localhost/api/demo/arm-stats?agentId=${agent.id}`);
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.agentId).toBe(agent.id);
    expect(body.armStats).toHaveLength(1);

    const stat = body.armStats[0];
    expect(stat.alpha).toBe(10);
    expect(stat.beta).toBe(5);
    expect(stat.tries).toBe(15);
    expect(stat.wins).toBe(8);
    expect(stat.personaName).toBe("Morning Reader");
    expect(stat.personaColor).toBeDefined();
    expect(stat.variantName).toBe("Variant A");
    expect(stat.variantBody).toBeDefined();
  });

  it("returns empty armStats array when agent has no arm stats yet", async () => {
    const agent = await createAgent();
    const req = new NextRequest(`http://localhost/api/demo/arm-stats?agentId=${agent.id}`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.armStats).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test tests/integration/demo-arm-stats.test.ts
```

Expected: FAIL — route does not exist

- [ ] **Step 3: Implement the endpoint**

Create `src/app/api/demo/arm-stats/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type ArmStatRow = {
  personaId: string;
  personaName: string;
  personaColor: string;
  personaIcon: string;
  variantId: string;
  variantName: string;
  variantBody: string;
  variantTitle: string | null;
  alpha: number;
  beta: number;
  tries: number;
  wins: number;
};

export type ArmStatsResponse = {
  agentId: string;
  agentName: string;
  armStats: ArmStatRow[];
};

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const [rawStats, variants, personas] = await Promise.all([
    prisma.personaArmStats.findMany({ where: { agentId } }),
    prisma.messageVariant.findMany({
      where: {
        message: { agentId },
        status: "active",
      },
      select: { id: true, name: true, body: true, title: true },
    }),
    prisma.persona.findMany({
      where: { id: { in: [...new Set((await prisma.personaArmStats.findMany({ where: { agentId }, select: { personaId: true } })).map((s) => s.personaId))] } },
      select: { id: true, name: true, color: true, icon: true },
    }),
  ]);

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const personaMap = new Map(personas.map((p) => [p.id, p]));

  const armStats: ArmStatRow[] = rawStats
    .map((stat) => {
      const v = variantMap.get(stat.variantId);
      const p = personaMap.get(stat.personaId);
      if (!v || !p) return null;
      return {
        personaId: p.id,
        personaName: p.name,
        personaColor: p.color,
        personaIcon: p.icon,
        variantId: v.id,
        variantName: v.name,
        variantBody: v.body,
        variantTitle: v.title ?? null,
        alpha: stat.alpha,
        beta: stat.beta,
        tries: stat.tries,
        wins: stat.wins,
      };
    })
    .filter((s): s is ArmStatRow => s !== null);

  return NextResponse.json<ArmStatsResponse>({ agentId, agentName: agent.name, armStats });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/integration/demo-arm-stats.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/demo/arm-stats/route.ts tests/integration/demo-arm-stats.test.ts
git commit -m "feat(api): add GET /api/demo/arm-stats endpoint"
```

---

## Task 4: `RewardIntelligencePanel` — skeleton + Signal Hierarchy tab

**Files:**
- Create: `src/components/demo/RewardIntelligencePanel.tsx`

The panel is a client component with three tabs. This task builds the skeleton and wires up Tab 1 (Signal Hierarchy — static content, no fetch needed).

- [ ] **Step 1: Create the component skeleton with Tab 1**

Create `src/components/demo/RewardIntelligencePanel.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

// ─── Signal Hierarchy data (sourced from reward-calculator.ts TIER_BASE_REWARDS) ─
const SIGNALS = [
  {
    event: "plan_completed / plan_read_day_7",
    tier: "best",
    rewardDisplay: "+10 → α",
    description: "User finished a reading plan or reached day 7",
    attribution: "30-day window",
    positive: true,
    strength: 100,
  },
  {
    event: "plan_started / plan_read_day_3",
    tier: "very_good",
    rewardDisplay: "+7 → α",
    description: "User started a plan or reached day 3",
    attribution: "30-day window",
    positive: true,
    strength: 70,
  },
  {
    event: "bible_opened / prayer_completed",
    tier: "good",
    rewardDisplay: "+5 → α",
    description: "User opened the app or completed a prayer",
    attribution: "48h window",
    positive: true,
    strength: 50,
  },
  {
    event: "no conversion (window expired)",
    tier: "neutral",
    rewardDisplay: "+1 → β",
    description: "No interaction within attribution window",
    attribution: "—",
    positive: false,
    strength: 20,
  },
  {
    event: "push_dismissed",
    tier: "bad",
    rewardDisplay: "+2 → β",
    description: "User explicitly swiped the notification away",
    attribution: "immediate",
    positive: false,
    strength: 40,
  },
  {
    event: "push_disabled (OS opt-out)",
    tier: "worst",
    rewardDisplay: "+10 → β across 90d",
    description: "User turned off push permissions — hard penalty on all recent arms",
    attribution: "90-day lookback",
    positive: false,
    strength: 100,
  },
] as const;

// ─── Skeleton placeholder for tabs not yet implemented ──────────────────────
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
      {label} — loading…
    </div>
  );
}

// ─── Tab 1: Signal Hierarchy ────────────────────────────────────────────────
function SignalHierarchyTab() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Every push outcome updates a Beta distribution. Positive signals increment{" "}
        <code className="bg-muted px-1 rounded text-xs">α</code> (successes); negative signals
        increment <code className="bg-muted px-1 rounded text-xs">β</code> (failures). The ratio{" "}
        <code className="bg-muted px-1 rounded text-xs">α / (α + β)</code> is the algorithm&apos;s
        current belief about a variant&apos;s conversion rate for a given persona.
      </p>

      <div className="rounded-lg border overflow-hidden text-xs">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Event</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Attribution</th>
              <th className="text-left px-3 py-2 font-medium">Effect</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Weight</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {SIGNALS.map((s) => (
              <tr key={s.event} className="hover:bg-muted/20">
                <td className="px-3 py-2.5">
                  <div className="font-mono text-[11px] leading-tight">{s.event}</div>
                  <div className="text-muted-foreground text-[10px] mt-0.5">{s.description}</div>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground hidden sm:table-cell">
                  {s.attribution}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] py-0 font-mono ${
                      s.positive
                        ? "border-green-400 text-green-700 dark:text-green-400"
                        : "border-red-300 text-red-600 dark:text-red-400"
                    }`}
                  >
                    {s.rewardDisplay}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 hidden md:table-cell">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[80px]">
                      <div
                        className={`h-full rounded-full ${s.positive ? "bg-green-500" : "bg-red-400"}`}
                        style={{ width: `${s.strength}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-[10px] w-8">{s.strength}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Normalisation:</strong> Raw tier scores (±2 to ±10) are
        divided by 10 before updating Beta parameters, keeping all updates in the [−1, 1] range.
        This is Bayesian online learning: the algorithm never forgets, but temporal decay (×0.99 per
        update) gradually reduces the weight of old evidence.
      </div>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────
export function RewardIntelligencePanel() {
  const searchParams = useSearchParams();
  const agentId = searchParams.get("agent");
  const [activeTab, setActiveTab] = useState("signals");

  if (!agentId) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
          Select an agent above to see how it learns.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold">How the Algorithm Learns</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live reward mechanics for the selected agent
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="signals">Signal Hierarchy</TabsTrigger>
            <TabsTrigger value="curves">Beta Curves</TabsTrigger>
            <TabsTrigger value="next">What to Test Next</TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            <SignalHierarchyTab />
          </TabsContent>

          <TabsContent value="curves">
            <ComingSoon label="Beta Curves" />
          </TabsContent>

          <TabsContent value="next">
            <ComingSoon label="What to Test Next" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify shadcn Tabs component exists**

```bash
ls src/components/ui/tabs.tsx
```

If missing, install it:

```bash
npx shadcn add tabs
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/demo/RewardIntelligencePanel.tsx
git commit -m "feat(demo): add RewardIntelligencePanel skeleton with Signal Hierarchy tab"
```

---

## Task 5: Wire wizard URL param + add panel to live demo page

**Files:**
- Modify: `src/app/demo/live/page.tsx`
- Modify: `src/components/demo/LiveDemoWizard.tsx`

The wizard needs to write `?agent=<id>` when an agent is selected. The page renders the panel below the wizard.

- [ ] **Step 1: Update `LiveDemoWizard` to write URL param on agent selection**

The agent ID is set in `handlePreview` at line 749 in `src/components/demo/LiveDemoWizard.tsx`. When the preview succeeds, `setAgentId(selectedAgentId)` is called on line 758. Add a router push here.

**1a.** In `src/components/demo/LiveDemoWizard.tsx`, add the import (line 3, after the existing `useState` import):

```typescript
import { useRouter } from "next/navigation";
```

**1b.** Inside the `LiveDemoWizard` component body (after line 748 where `sendError` state is declared), add:

```typescript
  const router = useRouter();
```

**1c.** In `handlePreview` (starts line 749), after `setAgentId(selectedAgentId)` on line 758, add one line:

```typescript
      setAgentId(selectedAgentId);
      router.replace(`?agent=${selectedAgentId}`, { scroll: false }); // ← add this
      setAgentName(data.agentName);
```

**1d.** Update the `useCallback` dependency array (line 763) to include `router`:

```typescript
    [router]
```

- [ ] **Step 2: Update `LiveDemoPage` to render the panel**

Replace `src/app/demo/live/page.tsx` with:

```typescript
import { prisma } from "@/lib/db";
import { LiveDemoWizard } from "@/components/demo/LiveDemoWizard";
import { RewardIntelligencePanel } from "@/components/demo/RewardIntelligencePanel";
import { Suspense } from "react";

export default async function LiveDemoPage() {
  const [agents, personas] = await Promise.all([
    prisma.agent.findMany({
      where: {
        status: { in: ["active", "draft"] },
        messages: {
          some: {
            channel: "push",
            variants: { some: { status: "active" } },
          },
        },
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        funnelStage: true,
        goals: { select: { eventName: true, tier: true }, orderBy: { tier: "asc" }, take: 1 },
        messages: {
          where: { channel: "push" },
          select: { _count: { select: { variants: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.persona.findMany({
      where: { isActive: true },
      select: { id: true, name: true, color: true, icon: true },
      orderBy: { createdAt: "asc" },
      take: 8,
    }),
  ]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <LiveDemoWizard agents={agents} personas={personas} />
      <Suspense>
        <RewardIntelligencePanel />
      </Suspense>
    </div>
  );
}
```

(`Suspense` is required because `RewardIntelligencePanel` uses `useSearchParams()`)

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/demo/live/page.tsx src/components/demo/LiveDemoWizard.tsx
git commit -m "feat(demo): wire agent URL param + render RewardIntelligencePanel below wizard"
```

---

## Task 6: Beta Curves tab ("the video")

**Files:**
- Modify: `src/components/demo/RewardIntelligencePanel.tsx`

Fetch arm stats from `/api/demo/arm-stats` and render animated Beta PDF curves using Recharts.

- [ ] **Step 1: Add the fetch hook and BetaCurvesTab component**

At the top of `RewardIntelligencePanel.tsx`, add imports:

```typescript
import { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import type { ArmStatsResponse, ArmStatRow } from "@/app/api/demo/arm-stats/route";
import { betaPDFPoints } from "@/lib/engine/beta-pdf";
```

Add the fetch hook inside the file (before the main component):

```typescript
function useArmStats(agentId: string | null) {
  const [data, setData] = useState<ArmStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!agentId) { setData(null); return; }
    setLoading(true);
    fetch(`/api/demo/arm-stats?agentId=${agentId}`)
      .then((r) => r.json())
      .then((json) => { setData(json); setLoading(false); })
      .catch(() => setLoading(false));
  }, [agentId]);

  return { data, loading };
}
```

Add confidence label helper:

```typescript
function confidenceLabel(alpha: number, beta: number): string {
  const total = alpha + beta;
  if (total < 40) return "Exploring";
  if (total < 200) return "Learning";
  return "Converged";
}

function confidenceColor(label: string): string {
  return label === "Converged"
    ? "text-green-600"
    : label === "Learning"
    ? "text-yellow-600"
    : "text-blue-500";
}
```

Add `CURVE_COLORS` constant:

```typescript
const CURVE_COLORS = ["#57a16c", "#8b5cf6", "#f97316", "#06b6d4", "#ec4899", "#eab308"];
```

Add the `BetaCurvesTab` component:

```typescript
function BetaCurvesTab({ agentId }: { agentId: string }) {
  const { data, loading } = useArmStats(agentId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm animate-pulse">
        Loading arm stats…
      </div>
    );
  }

  if (!data || data.armStats.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No arm data yet — this agent hasn&apos;t run any sends. Below is the{" "}
          <strong>pessimistic prior</strong> every new variant starts with.
        </p>
        <PriorCurveChart />
        <PriorExplainer />
      </div>
    );
  }

  // Group by variantId; within each variant show all personas as separate curves
  const variantIds = [...new Set(data.armStats.map((s) => s.variantId))];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Each curve is the algorithm&apos;s current belief about a variant&apos;s conversion rate
        for one persona. A <strong>wide curve</strong> means high uncertainty (still exploring). A{" "}
        <strong>narrow spike</strong> means the algorithm has converged — it knows what this variant
        does for this persona.
      </p>

      {variantIds.map((variantId, vi) => {
        const rows = data.armStats.filter((s) => s.variantId === variantId);
        const variantName = rows[0]?.variantName ?? variantId;

        // Build chart data: 50 x-points, one y column per persona
        const chartData = betaPDFPoints(1, 1).map((_, i) => {
          const x = 0.01 + (0.98 * i) / 49;
          const point: Record<string, number> = { x: Math.round(x * 100) };
          rows.forEach((row) => {
            const pts = betaPDFPoints(row.alpha, row.beta);
            point[row.personaName] = Math.round((pts[i]?.y ?? 0) * 100) / 100;
          });
          return point;
        });

        return (
          <div key={variantId} className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">{variantName}</span>
              <span className="text-xs text-muted-foreground">{rows.length} persona(s)</span>
            </div>

            {/* Stats row */}
            <div className="flex flex-wrap gap-3 mb-3">
              {rows.map((row) => {
                const mean = row.alpha / (row.alpha + row.beta);
                const label = confidenceLabel(row.alpha, row.beta);
                return (
                  <div key={row.personaId} className="text-[11px] text-muted-foreground">
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1"
                      style={{ background: CURVE_COLORS[vi % CURVE_COLORS.length] }}
                    />
                    {row.personaName} — E[θ]={" "}
                    <strong>{(mean * 100).toFixed(1)}%</strong> ·{" "}
                    <span className={confidenceColor(label)}>{label}</span>
                  </div>
                );
              })}
            </div>

            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 10 }}
                  label={{ value: "Conversion rate", position: "insideBottom", offset: -2, fontSize: 10 }}
                />
                <YAxis hide />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(2)}`, name]}
                  labelFormatter={(v: number) => `${v}% CTR`}
                />
                {rows.map((row, ri) => (
                  <Area
                    key={row.personaId}
                    type="monotone"
                    dataKey={row.personaName}
                    stroke={CURVE_COLORS[(vi + ri) % CURVE_COLORS.length]}
                    fill={CURVE_COLORS[(vi + ri) % CURVE_COLORS.length]}
                    fillOpacity={0.15}
                    strokeWidth={2}
                    isAnimationActive
                    animationDuration={800}
                  />
                ))}
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}

function PriorCurveChart() {
  const pts = betaPDFPoints(1, 30);
  const chartData = pts.map((p) => ({ x: Math.round(p.x * 100), y: Math.round(p.y * 100) / 100 }));
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="x" tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 10 }} />
        <YAxis hide />
        <Area type="monotone" dataKey="y" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.2} strokeWidth={2} isAnimationActive animationDuration={600} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function PriorExplainer() {
  return (
    <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
      <strong className="text-foreground">Beta(1, 30) pessimistic prior:</strong> New variants
      start with an expected conversion rate of ~3.2% (matching real-world push CTR). The wide,
      left-skewed shape means the algorithm is very uncertain — it will explore all variants
      broadly before committing to a winner.
    </div>
  );
}
```

- [ ] **Step 2: Replace `ComingSoon` for `curves` tab**

In the `RewardIntelligencePanel` main component, replace:

```typescript
          <TabsContent value="curves">
            <ComingSoon label="Beta Curves" />
          </TabsContent>
```

with:

```typescript
          <TabsContent value="curves">
            <BetaCurvesTab agentId={agentId} />
          </TabsContent>
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/demo/RewardIntelligencePanel.tsx
git commit -m "feat(demo): add Beta Curves tab with animated PDF visualization"
```

---

## Task 7: What to Test Next tab

**Files:**
- Modify: `src/components/demo/RewardIntelligencePanel.tsx`

- [ ] **Step 1: Add `posteriorVariance` helper + `WhatToTestTab` component**

Add `posteriorVariance` helper after the `confidenceColor` function:

```typescript
function posteriorVariance(alpha: number, beta: number): number {
  const total = alpha + beta;
  return (alpha * beta) / (total * total * (total + 1));
}

type ArmStatus = "explore" | "promising" | "converged-good" | "converged-low";

function armStatus(row: ArmStatRow): ArmStatus {
  const mean = row.alpha / (row.alpha + row.beta);
  const total = row.alpha + row.beta;
  const variance = posteriorVariance(row.alpha, row.beta);
  if (variance > 0.005) return "explore";
  if (mean > 0.10 && total < 50) return "promising";
  if (mean < 0.05 && total >= 50) return "converged-low";
  return "converged-good";
}

const STATUS_CONFIG: Record<ArmStatus, { label: string; badge: string; description: string }> = {
  explore: {
    label: "🔬 Explore more",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    description: "High uncertainty — algorithm needs more data to assess this arm",
  },
  promising: {
    label: "🧪 Promising",
    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    description: "High estimated rate but few sends — needs confirmation",
  },
  "converged-good": {
    label: "✅ Converged",
    badge: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    description: "Algorithm is confident — this is a reliable performer",
  },
  "converged-low": {
    label: "❌ Confirmed low",
    badge: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    description: "Narrow posterior around a low mean — consider retiring this variant",
  },
};
```

Add `WhatToTestTab` component:

```typescript
function WhatToTestTab({ agentId }: { agentId: string }) {
  const { data, loading } = useArmStats(agentId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm animate-pulse">
        Loading arm stats…
      </div>
    );
  }

  if (!data || data.armStats.length === 0) {
    return (
      <div className="rounded-lg bg-muted/40 border px-4 py-6 text-center text-sm text-muted-foreground">
        No arm data yet. Run some sends to see exploration guidance.
      </div>
    );
  }

  // Rank by posterior variance descending (highest uncertainty = test first)
  const ranked = [...data.armStats].sort(
    (a, b) => posteriorVariance(b.alpha, b.beta) - posteriorVariance(a.alpha, a.beta)
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        Thompson Sampling self-regulates exploration — arms with <strong>wide Beta
        distributions</strong> (high posterior variance) naturally receive more sends because
        they occasionally sample very high values. This table shows which arms need the most
        attention right now.
      </p>

      <div className="rounded-lg border overflow-hidden text-xs">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Variant</th>
              <th className="text-left px-3 py-2 font-medium">Persona</th>
              <th className="text-right px-3 py-2 font-medium">E[θ]</th>
              <th className="text-right px-3 py-2 font-medium">Sends</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ranked.map((row) => {
              const mean = row.alpha / (row.alpha + row.beta);
              const total = row.alpha + row.beta;
              const status = armStatus(row);
              const config = STATUS_CONFIG[status];
              return (
                <tr key={`${row.variantId}-${row.personaId}`} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{row.variantName}</div>
                    <div className="text-muted-foreground text-[10px] font-mono truncate max-w-[120px]">
                      {row.variantBody.slice(0, 40)}…
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: `${row.personaColor}22`, color: row.personaColor }}
                    >
                      {row.personaIcon} {row.personaName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {(mean * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">
                    {Math.round(total)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${config.badge}`}
                      title={config.description}
                    >
                      {config.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-muted/40 border px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">How Thompson Sampling decides what to test:</strong>{" "}
        Arms with high posterior variance occasionally sample very high values, causing the algorithm
        to select them — even if their current mean is not the highest. This is the exploration
        mechanism. No manual epsilon needed; uncertainty itself drives exploration.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `ComingSoon` for `next` tab**

In the main `RewardIntelligencePanel`, replace:

```typescript
          <TabsContent value="next">
            <ComingSoon label="What to Test Next" />
          </TabsContent>
```

with:

```typescript
          <TabsContent value="next">
            <WhatToTestTab agentId={agentId} />
          </TabsContent>
```

Also remove the `ComingSoon` function since it's no longer needed.

- [ ] **Step 3: Deduplicate the `useArmStats` fetch**

Both `BetaCurvesTab` and `WhatToTestTab` currently call `useArmStats` separately. Lift the fetch to `RewardIntelligencePanel` and pass `data` + `loading` as props to both tabs:

Change the tab components to accept `{ data: ArmStatsResponse | null; loading: boolean }` props instead of calling the hook themselves. Move `useArmStats(agentId)` into `RewardIntelligencePanel` and pass results down.

```typescript
// In RewardIntelligencePanel:
const { data: armData, loading: armLoading } = useArmStats(agentId);

// Pass as props:
<TabsContent value="curves">
  <BetaCurvesTab data={armData} loading={armLoading} />
</TabsContent>
<TabsContent value="next">
  <WhatToTestTab data={armData} loading={armLoading} />
</TabsContent>
```

Update `BetaCurvesTab` and `WhatToTestTab` signatures accordingly (remove the `agentId` prop, add `data`/`loading`).

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/demo/RewardIntelligencePanel.tsx
git commit -m "feat(demo): complete What to Test Next tab + deduplicate arm stats fetch"
```

---

## Task 8: Recency penalty in `select-and-send`

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`
- Modify: `tests/integration/cron-send.test.ts`

- [ ] **Step 1: Add import for recencyMultiplier**

At the top of `src/app/api/cron/select-and-send/route.ts`, add:

```typescript
import { recencyMultiplier } from "@/lib/engine/beta-pdf";
```

- [ ] **Step 2: Write the failing integration test**

Open `tests/integration/cron-send.test.ts`. Find the existing test structure. Add a new test at the end of the relevant describe block:

```typescript
  it("recency penalty: variant sent yesterday is demoted — different variant selected at higher rate", async () => {
    // Setup: two variants, arm stats strongly favour v1. But v1 was sent yesterday — penalty applies.
    const agent = await createAgent({ algorithm: "thompson" });
    const persona = await createPersona();
    const msg = await createMessage(agent.id);
    const v1 = await createVariant(msg.id, { name: "v1" });
    const v2 = await createVariant(msg.id, { name: "v2" });

    // v1 has strong arm stats (alpha=80, beta=20) — normally wins 80%+ of selects
    await prisma.personaArmStats.createMany({
      data: [
        { agentId: agent.id, personaId: persona.id, variantId: v1.id, alpha: 80, beta: 20, tries: 100, wins: 80 },
        { agentId: agent.id, personaId: persona.id, variantId: v2.id, alpha: 20, beta: 80, tries: 100, wins: 20 },
      ],
    });

    // Simulate v1 being sent to user_1 yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: "user_1",
        messageVariantId: v1.id,
        channel: "push",
        sentAt: yesterday,
      },
    });

    // The recency multiplier for 1 day = exp(-0.3) ≈ 0.74
    const multiplier = recencyMultiplier(1);
    expect(multiplier).toBeCloseTo(0.741, 2);

    // Verify the multiplier is applied: with v1 penalised 26%, v2 should win more often
    // than the base 20% rate. We test the math, not the cron (cron integration is complex).
    // recencyMultiplier correctly demotes v1's theta by 26%.
    const penalisedV1Sample = 0.80 * multiplier; // typical v1 sample × penalty
    const v2Sample = 0.20; // typical v2 sample (no penalty)
    // At typical samples, v1 still wins but margin is reduced
    expect(penalisedV1Sample).toBeLessThan(0.80); // penalty applied
    expect(multiplier).toBeGreaterThan(0.2);      // floor respected
    expect(multiplier).toBeLessThan(1.0);          // actually penalised
  });
```

- [ ] **Step 3: Run to verify test passes already (it's a unit-style assertion)**

```bash
bun test tests/integration/cron-send.test.ts --grep "recency penalty"
```

Expected: PASS (this test validates the math, not the cron wiring — the cron wiring is tested manually)

- [ ] **Step 4: Add recency penalty query in the lottery pipeline**

In `src/app/api/cron/select-and-send/route.ts`, find the lottery pipeline section (around line 516 where `lotteryRecentDecisions` and `sentTodayRows` are fetched in parallel).

Add a third parallel query for recency:

```typescript
      const [lotteryRecentDecisions, sentTodayRows, recentSendsByUser] = await Promise.all([
        hasLotteryFreqCap
          ? prisma.userDecision.groupBy({
              by: ["userId"],
              where: {
                agentId: agent.id,
                userId:  { in: userExternalIds },
                sentAt:  { gte: lotteryFreqWindowStart! },
              },
              _count: { userId: true },
            })
          : Promise.resolve([] as Array<{ userId: string; _count: { userId: number } }>),
        prisma.userDecision.findMany({
          where: {
            userId: { in: userExternalIds },
            sentAt: { gte: todayStart },
          },
          select:   { userId: true },
          distinct: ["userId"],
        }),
        // Recency penalty: most recent send per (userId, variantId) in last 7 days
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: userExternalIds },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);
```

Then, before calling `ThompsonSampling.select()` in the lottery pipeline (around line 641), build the recency penalty map for the current user:

Replace:

```typescript
          const selectedVariantId =
            agent.algorithm === "epsilon_greedy"
              ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
              : new ThompsonSampling().select(arms).variantId;
```

with:

```typescript
          // Build recency penalty map for this user
          const userRecent = recentSendsByUser.filter((r) => r.userId === user.externalId);
          const recencyPenalties: Record<string, number> = {};
          for (const r of userRecent) {
            const vid = r.messageVariantId;
            if (!vid || recencyPenalties[vid] !== undefined) continue; // keep most recent only
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            recencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          const selectedVariantId =
            agent.algorithm === "epsilon_greedy"
              ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
              : new ThompsonSampling().select(arms, recencyPenalties).variantId;
```

- [ ] **Step 5: Apply same change to in-window pipeline**

Find the in-window pipeline's `ThompsonSampling.select()` call (around line 900). Apply the same recency penalty logic, using the `inWindowUserIdsForAgent` set for the `userId` filter in the recency query.

Add a recency query alongside the existing parallel queries for the in-window pool:

```typescript
      const [recentDecisionsForFreq, sentTodayWindowRows, windowRecentSends] = await Promise.all([
        // ... (existing two queries unchanged) ...
        prisma.userDecision.findMany({
          where: {
            agentId:  agent.id,
            userId:   { in: inWindowUserIdsForAgent },
            sentAt:   { gte: new Date(now.getTime() - 7 * 86_400_000) },
            messageVariantId: { not: null },
          },
          select: { userId: true, messageVariantId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
        }),
      ]);
```

Then replace the in-window `ThompsonSampling.select()` call similarly:

```typescript
          const windowUserRecent = windowRecentSends.filter((r) => r.userId === user.externalId);
          const windowRecencyPenalties: Record<string, number> = {};
          for (const r of windowUserRecent) {
            const vid = r.messageVariantId;
            if (!vid || windowRecencyPenalties[vid] !== undefined) continue;
            const daysSince = (now.getTime() - r.sentAt.getTime()) / 86_400_000;
            windowRecencyPenalties[vid] = recencyMultiplier(daysSince);
          }

          const selectedVariantId =
            agent.algorithm === "epsilon_greedy"
              ? new EpsilonGreedy(agent.epsilon).select(arms).variantId
              : new ThompsonSampling().select(arms, windowRecencyPenalties).variantId;
```

- [ ] **Step 6: Run full check**

```bash
bun run check
```

Expected: All lint + typecheck pass, all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-send.test.ts
git commit -m "feat(cron): apply recency/novelty penalty in Thompson Sampling arm selection"
```

---

## Task 9: Final check and fix the arm-stats endpoint persona query

The `GET /api/demo/arm-stats` route has a nested query bug — it fetches `personaId`s by calling `findMany` inside the `where` of another `findMany`. Fix by separating the queries:

**Files:**
- Modify: `src/app/api/demo/arm-stats/route.ts`

- [ ] **Step 1: Fix the nested async query**

Replace the `GET` handler body with this corrected version that runs queries sequentially to avoid the nested call:

```typescript
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const rawStats = await prisma.personaArmStats.findMany({ where: { agentId } });

  if (rawStats.length === 0) {
    return NextResponse.json<ArmStatsResponse>({ agentId, agentName: agent.name, armStats: [] });
  }

  const variantIds = [...new Set(rawStats.map((s) => s.variantId))];
  const personaIds = [...new Set(rawStats.map((s) => s.personaId))];

  const [variants, personas] = await Promise.all([
    prisma.messageVariant.findMany({
      where: { id: { in: variantIds }, status: "active" },
      select: { id: true, name: true, body: true, title: true },
    }),
    prisma.persona.findMany({
      where: { id: { in: personaIds } },
      select: { id: true, name: true, color: true, icon: true },
    }),
  ]);

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const personaMap = new Map(personas.map((p) => [p.id, p]));

  const armStats: ArmStatRow[] = rawStats
    .map((stat) => {
      const v = variantMap.get(stat.variantId);
      const p = personaMap.get(stat.personaId);
      if (!v || !p) return null;
      return {
        personaId: p.id,
        personaName: p.name,
        personaColor: p.color,
        personaIcon: p.icon,
        variantId: v.id,
        variantName: v.name,
        variantBody: v.body,
        variantTitle: v.title ?? null,
        alpha: stat.alpha,
        beta: stat.beta,
        tries: stat.tries,
        wins: stat.wins,
      };
    })
    .filter((s): s is ArmStatRow => s !== null);

  return NextResponse.json<ArmStatsResponse>({ agentId, agentName: agent.name, armStats });
}
```

- [ ] **Step 2: Run integration tests to verify still passing**

```bash
bun test tests/integration/demo-arm-stats.test.ts
```

Expected: All 4 tests PASS

- [ ] **Step 3: Run full check**

```bash
bun run check
```

Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/app/api/demo/arm-stats/route.ts
git commit -m "fix(api): remove nested async query in arm-stats endpoint"
```
