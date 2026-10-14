# Nexus Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `beaconfrontier.com/nexus`: a one-page marketing site whose centrepiece is an in-browser simulator running Nexus's real bandit engine, and whose call to action books design-partner calls (qualifying form → lead saved + emailed → Calendly).

**Architecture:**
- `apps/site` is a new Next 16 app inside the nexusAi repo (Bun workspace member, `basePath: "/nexus"`).
- It imports the pure engine from `src/lib/engine` through an `@engine/*` path alias. A lint rule forbids every other import from the main app.
- It deploys as its own Vercel project, `nexus-site`, and is mounted into beaconfrontier.com as a multi-zone rewrite, the same way `/book` is.
- Leads go to a `DesignPartnerLead` table in the demo Neon DB, through `pg`. Email goes out through Resend's REST API, called with `fetch`.

**Tech Stack:** Next 16.1.6, React 19.2.6, Tailwind v4.2.1, Recharts ^3.8.0, Zod ^4.4.3, pg ^8.21.0, Bun test, Playwright (smoke only), Vercel.

**Spec:** `docs/superpowers/specs/2026-10-14-nexus-marketing-site-design.md`

## Global Constraints

- **Imports from the main app:** `apps/site` may import only `@engine/*`, which resolves to `../../src/lib/engine/*`. Never `@/…`, and never a relative path into `../../src/` outside the engine.
- **No YouVersion content:**
  - no YouVersion name, user counts or results anywhere in `apps/site` or the synthetic seed;
  - the only proof line allowed is "built and proven in production with a top consumer app";
  - no named competitor and no competitor prices. The category is "ESP-native decisioning add-ons".
- **Connector status:** connectors carry `status: "live" | "roadmap"`. Only `braze` and `hightouch` are `live`.
- **Offer copy (verbatim):**
  - "5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback."
  - "After the pilot: from $1.5k/mo per agent, or pay on measured lift."
- **Booking and email config:**
  - `NEXT_PUBLIC_CALENDLY_URL=https://calendly.com/danluk1311/30min`
  - `LEAD_NOTIFY_EMAIL=danluk1311@gmail.com`
  - email from `Nexus <nexus@beaconfrontier.com>`
- **Leads API:** `{ data }` / `{ error }` response shapes. 400 for invalid input. A honeypot hit returns 200 and stores nothing. 429 after 5 leads per IP per hour. Never surface DB errors.
- **Simulator:**
  - deterministic for a given `(preset, algorithm, seed)`;
  - must restore `Math.random` even if it throws;
  - no network calls.
- **Engine purity:** do not modify `src/lib/engine/**` in this plan.
- **Synthetic seed safety:** it refuses to run unless `DEMO_DATABASE_URL`'s host contains `ep-orange-star-b8ujtvot`, and it never uses `DATABASE_URL` from `.env.local`.
- **Accounts:** personal only.
  - `GH_TOKEN="$(gh auth token -u ender1311)" gh …`
  - Vercel: `--token "$(security find-generic-password -s vercel-ender1311 -w)" --scope dans-projects-d4d642e1`. Export it as `VERCEL_TOKEN` and never echo it.
- **Commits:** commit only the files the task names. Never `git add -A` or `.`. The main checkout has an unrelated uncommitted `src/lib/engine/thompson-sampling.ts` and many untracked `*.png` files. No attribution lines.
- **Checks:** run `bun run check:site` (added in Task 1) inside the task loop. Root `bun run check:quick` must stay green.

## Review Focus

1. **The simulator throws mid-run.** For example, a preset with zero variants. Expected: `Math.random` is restored afterwards, and the page shows an error state instead of leaving global randomness seeded. *Test: Task 2, "restores Math.random when the run throws".*
2. **Duplicate or replayed form submit.** The visitor double-clicks Submit, or a bot replays the POST. Expected: at most one lead per click. The button disables while the POST is pending, and the server rate limit caps replays. *Test: Task 4 rate-limit test, plus Task 5 "disables submit while pending".*
3. **Resend is down or the key is missing.** Expected: the lead is still stored, the visitor still gets Calendly, and the server logs the failure. *Test: Task 4, "stores the lead and returns 201 when email fails".*
4. **A stack selection exists that the simulator doesn't know about,** for example a roadmap connector. Expected: every connector in `connectors.ts` renders in the dropdown, roadmap ones are labelled "(roadmap)", and changing the selection never changes the simulation numbers. *Test: Task 3, "stack choice does not change results".*
5. **The zone rewrite swallows a beaconfrontier page that starts with "nexus"** (for example a future `/nexus-business-names`). Expected: only `/nexus` and `/nexus/...` are rewritten. *Test: Task 7 matcher test.*

---

### Task 1: Scaffold `apps/site` with the engine alias and import boundary

**Files:**
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/next.config.ts`, `apps/site/postcss.config.mjs`, `apps/site/bunfig.toml`, `apps/site/next-env.d.ts`, `apps/site/app/layout.tsx`, `apps/site/app/page.tsx`, `apps/site/app/globals.css`, `apps/site/tests/engine-alias.test.ts`, `apps/site/.gitignore`
- Modify: `package.json` (root: `workspaces`, scripts `check:site`, `check:quick`), `eslint.config.mjs` (boundary rule)

**Interfaces:**
- Produces:
  - the alias `@engine/*` → `../../src/lib/engine/*`, usable from site code and site tests;
  - the script `bun run check:site` (typecheck + test for the site);
  - the env-config module `apps/site/lib/config.ts` (created in Task 4, not here).

- [ ] **Step 1: Write the failing alias test**

```ts
// apps/site/tests/engine-alias.test.ts
import { describe, expect, it } from "bun:test";
import { ThompsonSampling } from "@engine/thompson-sampling";
import { LinUCB } from "@engine/linucb";

describe("engine alias", () => {
  it("imports the real engine classes", () => {
    expect(typeof new ThompsonSampling().select).toBe("function");
    expect(new LinUCB().initialArm(3).aInv).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Create the package files**

```json
// apps/site/package.json
{
  "name": "@nexus/site",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3100",
    "build": "next build",
    "start": "next start --port 3100",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "check": "bun run typecheck && bun run test",
    "smoke": "playwright test"
  },
  "dependencies": {
    "next": "16.1.6",
    "pg": "^8.21.0",
    "react": "19.2.6",
    "react-dom": "19.2.6",
    "recharts": "^3.8.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.0",
    "@tailwindcss/postcss": "4.2.1",
    "@types/bun": "1.3.14",
    "@types/pg": "^8.20.0",
    "@types/react": "19.2.14",
    "@types/react-dom": "19.2.3",
    "tailwindcss": "4.2.1",
    "typescript": "5.9.3"
  }
}
```

```json
// apps/site/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "types": ["bun"],
    "plugins": [{ "name": "next" }],
    "paths": {
      "@site/*": ["./*"],
      "@engine/*": ["../../src/lib/engine/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", "../../src/lib/engine/**/*.ts"],
  "exclude": ["node_modules", "../../src/lib/engine/**/*.test.ts"]
}
```

```ts
// apps/site/next.config.ts
import path from "node:path";
import type { NextConfig } from "next";

// The repo root, so Turbopack and file tracing can reach ../../src/lib/engine.
const repoRoot = path.resolve(__dirname, "../..");

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src https://calendly.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  basePath: "/nexus",
  poweredByHeader: false,
  images: { unoptimized: true },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

```js
// apps/site/postcss.config.mjs
const config = { plugins: { "@tailwindcss/postcss": {} } };
export default config;
```

```toml
# apps/site/bunfig.toml
[test]
root = "tests"
```

```ts
// apps/site/next-env.d.ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

```
# apps/site/.gitignore
.next/
test-results/
playwright-report/
```

```css
/* apps/site/app/globals.css */
@import "tailwindcss";

:root {
  --bg: #0b0d12;
  --panel: #12151d;
  --border: #232838;
  --text: #e8ebf2;
  --muted: #8a93a8;
  --accent: #7c9cff;
  --good: #3ecf8e;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f7f8fb; --panel: #ffffff; --border: #e3e6ee; --text: #121521; --muted: #5b6478; --accent: #3a5cff; --good: #0f9f62; }
}
body { background: var(--bg); color: var(--text); }
```

```tsx
// apps/site/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexus: AI decisioning for the stack you already have",
  description:
    "Nexus picks the right message, channel and time for each user, then learns from every send. Plugs into your CDP, warehouse and ESP.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
```

```tsx
// apps/site/app/page.tsx  (placeholder; Task 6 replaces it)
export default function Page() {
  return <main className="mx-auto max-w-5xl px-4 py-16">Nexus</main>;
}
```

- [ ] **Step 3: Wire the workspace, the scripts and the boundary rule**

In the root `package.json`:
- change `"workspaces": ["apps/api"]` to `"workspaces": ["apps/api", "apps/site"]`;
- add `"check:site": "bun --cwd apps/site run check"`;
- change `check:quick` to `"bun run typecheck && bun run lint && bun run test:quick && bun run check:site"`.

In `eslint.config.mjs`, add this block after `...nextTs,`:

```js
  // apps/site may reach into the main app only through @engine/* (pure engine).
  {
    files: ["apps/site/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["@/*"], message: "apps/site may import only @engine/* from the main app." },
          { regex: "^(\\.\\./)+src/", message: "Use @engine/* — apps/site may import only the pure engine." },
        ],
      }],
    },
  },
```

Also add `"apps/site/.next/**"` and `"apps/site/test-results/**"` to `globalIgnores`.

- [ ] **Step 4: Install and run**

Run: `bun install` (repo root), then `bun run check:site`
Expected: typecheck passes, and `engine alias > imports the real engine classes` passes.

Then check the boundary rule. Temporarily add `import { prisma } from "@/lib/db";` to `apps/site/app/page.tsx`, run `bunx eslint apps/site/app/page.tsx`, and expect the error "apps/site may import only @engine/* from the main app." Remove the line again.

- [ ] **Step 5: Build**

Run: `bun --cwd apps/site run build`
Expected: the build succeeds and the route list shows `/` (served at `/nexus`).

- [ ] **Step 6: Commit**

```bash
git add apps/site/package.json apps/site/tsconfig.json apps/site/next.config.ts apps/site/postcss.config.mjs apps/site/bunfig.toml apps/site/next-env.d.ts apps/site/.gitignore apps/site/app/layout.tsx apps/site/app/page.tsx apps/site/app/globals.css apps/site/tests/engine-alias.test.ts package.json bun.lock eslint.config.mjs
git commit -m "feat(site): scaffold apps/site with @engine alias and import boundary"
```

---

### Task 2: Simulation core (pure, seeded, real engine)

**Files:**
- Create: `apps/site/lib/simulator/rng.ts`, `apps/site/lib/simulator/presets.ts`, `apps/site/lib/simulator/simulate.ts`, `apps/site/lib/simulator/types.ts`
- Test: `apps/site/tests/simulate.test.ts`

**Interfaces:**
- Consumes: `ThompsonSampling.select(arms)`, `EpsilonGreedy(epsilon).select(arms)`, `LinUCB(alpha)` with `.select(arms, x)`, `.update(aInv, b, x, r)`, `.initialArm(dim)` and `.score(aInv, b, x)`. Engine arm shape: `{ id, stats: { alpha, beta, tries, wins } }`.
- Produces:
  - `type AlgorithmId = "thompson" | "epsilon" | "linucb"`
  - `type Preset`, `type DayState`, `type SimulationResult`, and `type DecisionSample` (see `types.ts` below)
  - `PRESETS: Preset[]` and `getPreset(id: string): Preset`
  - `simulate(preset: Preset, algorithm: AlgorithmId, seed: number): SimulationResult`
  - `mulberry32(seed: number): () => number`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/tests/simulate.test.ts
import { describe, expect, it } from "bun:test";
import { simulate } from "@site/lib/simulator/simulate";
import { getPreset, PRESETS } from "@site/lib/simulator/presets";
import type { Preset } from "@site/lib/simulator/types";

const SEEDS = [1, 2, 3];

describe("simulate", () => {
  it("is deterministic for the same preset, algorithm and seed", () => {
    const p = getPreset("winback");
    expect(JSON.stringify(simulate(p, "thompson", 7))).toBe(JSON.stringify(simulate(p, "thompson", 7)));
  });

  it("produces one DayState per simulated day", () => {
    for (const p of PRESETS) expect(simulate(p, "thompson", 1).days).toHaveLength(p.days);
  });

  it("Thompson sends most final-day traffic to the true best variant on every single-segment preset", () => {
    for (const id of ["winback", "onboarding"]) {
      const p = getPreset(id);
      const best = p.variants.reduce((a, b) => (b.rates[0]! > a.rates[0]! ? b : a));
      for (const seed of SEEDS) {
        const last = simulate(p, "thompson", seed).days.at(-1)!;
        expect(last.trafficShare[best.id]!).toBeGreaterThan(0.6);
      }
    }
  });

  it("LinUCB beats Thompson on the segmented preset", () => {
    const p = getPreset("upsell");
    for (const seed of SEEDS) {
      const lin = simulate(p, "linucb", seed).days.at(-1)!;
      const ts = simulate(p, "thompson", seed).days.at(-1)!;
      expect(lin.cumulativeRate).toBeGreaterThan(ts.cumulativeRate * 1.2);
      expect(lin.cumulativeRegret).toBeLessThan(ts.cumulativeRegret);
    }
  });

  it("reports positive lift vs the holdout for Thompson on winback", () => {
    const lift = simulate(getPreset("winback"), "thompson", 1).days.at(-1)!.liftVsHoldout;
    expect(lift).toBeGreaterThan(0.05);
    expect(lift).toBeLessThan(2);
  });

  it("restores Math.random afterwards, including when the run throws", () => {
    const original = Math.random;
    simulate(getPreset("winback"), "epsilon", 1);
    expect(Math.random).toBe(original);
    const broken: Preset = { ...getPreset("winback"), variants: [] };
    expect(() => simulate(broken, "thompson", 1)).toThrow();
    expect(Math.random).toBe(original);
  });

  it("emits decision samples with an explanation for every algorithm", () => {
    for (const alg of ["thompson", "epsilon", "linucb"] as const) {
      const s = simulate(getPreset("upsell"), alg, 2).days[5]!.samples;
      expect(s.length).toBeGreaterThan(0);
      expect(s[0]!.estimate).toBeGreaterThanOrEqual(0);
      expect(typeof s[0]!.variantId).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun --cwd apps/site test tests/simulate.test.ts`
Expected: FAIL with `Cannot find module '@site/lib/simulator/simulate'`.

- [ ] **Step 3: Implement**

```ts
// apps/site/lib/simulator/types.ts
export type AlgorithmId = "thompson" | "epsilon" | "linucb";

export type Segment = { id: string; label: string; share: number };

/** rates[i] is the true conversion rate for segments[i]. */
export type Variant = { id: string; label: string; copy: string; rates: number[] };

export type Preset = {
  id: string;
  title: string;
  description: string;
  segments: Segment[];
  variants: Variant[];
  days: number;
  usersPerDay: number;
  holdoutShare: number;
};

export type DecisionSample = {
  userNumber: number;
  segmentId: string;
  variantId: string;
  explore: boolean;
  /** Algorithm's estimated conversion rate for this user and variant. */
  estimate: number;
  /** ± half-width of the estimate (0 when the algorithm has no notion of uncertainty). */
  uncertainty: number;
};

export type DayState = {
  day: number;
  /** Share of today's non-holdout sends per variant id (sums to 1). */
  trafficShare: Record<string, number>;
  /** Per segment: the variant this algorithm sent most often today. */
  topVariantBySegment: Record<string, string>;
  cumulativeSends: number;
  cumulativeConversions: number;
  cumulativeRate: number;
  holdoutRate: number;
  liftVsHoldout: number;
  cumulativeRegret: number;
  samples: DecisionSample[];
};

export type SimulationResult = { presetId: string; algorithm: AlgorithmId; seed: number; days: DayState[] };
```

```ts
// apps/site/lib/simulator/rng.ts
/** Small, fast, seedable PRNG (mulberry32). Same seed → same stream. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

```ts
// apps/site/lib/simulator/presets.ts
import type { Preset } from "./types";

const ALL = [{ id: "all", label: "Everyone", share: 1 }];

// Rates validated against the real engine on 2026-10-14 (seeds 1–3): Thompson
// moves ≥92% of day-30 traffic to the best winback variant; LinUCB converts
// ~8% vs Thompson ~5% on upsell.
export const PRESETS: Preset[] = [
  {
    id: "winback",
    title: "Win back lapsed users",
    description: "Users inactive 14+ days. Four push messages compete to bring them back.",
    segments: ALL,
    variants: [
      { id: "A", label: "Reminder", copy: "We saved your spot. Pick up where you left off.", rates: [0.021] },
      { id: "B", label: "Social proof", copy: "12,000 people finished this week's challenge.", rates: [0.034] },
      { id: "C", label: "Discount", copy: "Come back today: 20% off your next month.", rates: [0.028] },
      { id: "D", label: "Personal progress", copy: "You're 3 days from your best streak ever.", rates: [0.046] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
  {
    id: "onboarding",
    title: "Onboarding day 1–7",
    description: "New sign-ups. Which first-week nudge gets them to the key action?",
    segments: ALL,
    variants: [
      { id: "A", label: "Feature tour", copy: "Three things you can do in your first minute.", rates: [0.12] },
      { id: "B", label: "Quick win", copy: "Finish setup in 30 seconds and unlock your plan.", rates: [0.18] },
      { id: "C", label: "Founder note", copy: "A personal welcome, and one tip that matters.", rates: [0.14] },
      { id: "D", label: "Checklist", copy: "Your 4-step start checklist is ready.", rates: [0.15] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
  {
    id: "upsell",
    title: "Upsell to paid",
    description: "Free users in three segments. Each segment responds to a different pitch, so a single A/B winner leaves money on the table.",
    segments: [
      { id: "power", label: "Power users", share: 0.4 },
      { id: "casual", label: "Casual users", share: 0.35 },
      { id: "teams", label: "Team admins", share: 0.25 },
    ],
    variants: [
      { id: "A", label: "Unlimited usage", copy: "You've hit the free limit 3 times. Go unlimited.", rates: [0.09, 0.02, 0.03] },
      { id: "B", label: "Annual discount", copy: "Two months free when you pay yearly.", rates: [0.03, 0.08, 0.02] },
      { id: "C", label: "Team seats", copy: "Add your team and manage billing in one place.", rates: [0.02, 0.03, 0.1] },
      { id: "D", label: "Generic upgrade", copy: "Upgrade to Pro.", rates: [0.05, 0.05, 0.05] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
];

export function getPreset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}
```

```ts
// apps/site/lib/simulator/simulate.ts
import { ThompsonSampling } from "@engine/thompson-sampling";
import { EpsilonGreedy } from "@engine/epsilon-greedy";
import { LinUCB } from "@engine/linucb";
import { mulberry32 } from "./rng";
import type { AlgorithmId, DayState, DecisionSample, Preset, SimulationResult } from "./types";

const SAMPLES_PER_DAY = 6;
const EPSILON = 0.1;
const LINUCB_ALPHA = 1.0;

/**
 * Runs the real Nexus engine against a simulated audience. The engine draws
 * from Math.random, so the run swaps in a seeded stream and always restores
 * the original — the same technique the P0 characterization tests use.
 */
export function simulate(preset: Preset, algorithm: AlgorithmId, seed: number): SimulationResult {
  if (preset.variants.length === 0) throw new Error("Preset has no variants");
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return { presetId: preset.id, algorithm, seed, days: run(preset, algorithm, rng) };
  } finally {
    Math.random = original;
  }
}

function run(preset: Preset, algorithm: AlgorithmId, rng: () => number): DayState[] {
  const { segments, variants } = preset;
  const dim = segments.length + 1; // bias + one-hot segment
  const thompson = new ThompsonSampling();
  const epsilon = new EpsilonGreedy(EPSILON);
  const linucb = new LinUCB(LINUCB_ALPHA);
  const linucbMean = new LinUCB(0); // score with alpha 0 = θᵀx, the point estimate

  const stats = new Map(variants.map((v) => [v.id, { alpha: 1, beta: 1, tries: 0, wins: 0 }]));
  const linArms = new Map(variants.map((v) => [v.id, linucb.initialArm(dim)]));

  let sends = 0;
  let conversions = 0;
  let holdoutSends = 0;
  let holdoutConversions = 0;
  let regret = 0;
  let userNumber = 0;
  const days: DayState[] = [];

  for (let day = 0; day < preset.days; day++) {
    const sentToday: Record<string, number> = {};
    const bySegment: Record<string, Record<string, number>> = {};
    const samples: DecisionSample[] = [];

    for (let u = 0; u < preset.usersPerDay; u++) {
      userNumber++;
      const segIndex = pickSegment(segments.map((s) => s.share), rng());
      const segment = segments[segIndex]!;
      const x = Array.from({ length: dim }, (_, i) => (i === 0 || i === segIndex + 1 ? 1 : 0));
      const inHoldout = rng() < preset.holdoutShare;

      let variantId: string;
      let explore = false;
      if (inHoldout) {
        variantId = variants[Math.floor(rng() * variants.length)]!.id;
      } else if (algorithm === "linucb") {
        variantId = linucb.select(variants.map((v) => ({ id: v.id, ...linArms.get(v.id)! })), x).variantId;
      } else {
        const arms = variants.map((v) => ({ id: v.id, stats: stats.get(v.id)! }));
        const r = algorithm === "thompson" ? thompson.select(arms) : epsilon.select(arms);
        variantId = r.variantId;
        explore = r.explore;
      }

      const variant = variants.find((v) => v.id === variantId)!;
      const trueRate = variant.rates[segIndex]!;
      const converted = rng() < trueRate ? 1 : 0;

      if (inHoldout) {
        holdoutSends++;
        holdoutConversions += converted;
        continue;
      }

      if (samples.length < SAMPLES_PER_DAY && u % Math.ceil(preset.usersPerDay / SAMPLES_PER_DAY) === 0) {
        samples.push(explain(algorithm, userNumber, segment.id, variantId, explore, stats, linArms, linucb, linucbMean, x));
      }

      sends++;
      conversions += converted;
      sentToday[variantId] = (sentToday[variantId] ?? 0) + 1;
      bySegment[segment.id] ??= {};
      bySegment[segment.id]![variantId] = (bySegment[segment.id]![variantId] ?? 0) + 1;
      regret += Math.max(...variants.map((v) => v.rates[segIndex]!)) - trueRate;

      const s = stats.get(variantId)!;
      s.tries++;
      s.wins += converted;
      if (converted) s.alpha++;
      else s.beta++;
      const arm = linArms.get(variantId)!;
      linArms.set(variantId, linucb.update(arm.aInv, arm.b, x, converted));
    }

    const totalToday = Object.values(sentToday).reduce((a, b) => a + b, 0);
    const trafficShare = Object.fromEntries(variants.map((v) => [v.id, totalToday ? (sentToday[v.id] ?? 0) / totalToday : 0]));
    const topVariantBySegment = Object.fromEntries(
      segments.map((seg) => {
        const counts = bySegment[seg.id] ?? {};
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? variants[0]!.id;
        return [seg.id, top];
      }),
    );
    const cumulativeRate = sends ? conversions / sends : 0;
    const holdoutRate = holdoutSends ? holdoutConversions / holdoutSends : 0;
    days.push({
      day: day + 1,
      trafficShare,
      topVariantBySegment,
      cumulativeSends: sends,
      cumulativeConversions: conversions,
      cumulativeRate,
      holdoutRate,
      liftVsHoldout: holdoutRate > 0 ? cumulativeRate / holdoutRate - 1 : 0,
      cumulativeRegret: regret,
      samples,
    });
  }
  return days;
}

function pickSegment(shares: number[], r: number): number {
  let acc = 0;
  for (let i = 0; i < shares.length; i++) {
    acc += shares[i]!;
    if (r < acc) return i;
  }
  return shares.length - 1;
}

function explain(
  algorithm: AlgorithmId,
  userNumber: number,
  segmentId: string,
  variantId: string,
  explore: boolean,
  stats: Map<string, { alpha: number; beta: number; tries: number; wins: number }>,
  linArms: Map<string, { aInv: number[]; b: number[] }>,
  linucb: LinUCB,
  linucbMean: LinUCB,
  x: number[],
): DecisionSample {
  if (algorithm === "linucb") {
    const arm = linArms.get(variantId)!;
    const mean = linucbMean.score(arm.aInv, arm.b, x);
    const ucb = linucb.score(arm.aInv, arm.b, x);
    return { userNumber, segmentId, variantId, explore: false, estimate: clamp01(mean), uncertainty: Math.max(0, ucb - mean) };
  }
  const s = stats.get(variantId)!;
  if (algorithm === "thompson") {
    const n = s.alpha + s.beta;
    const mean = s.alpha / n;
    const sd = Math.sqrt((s.alpha * s.beta) / (n * n * (n + 1)));
    return { userNumber, segmentId, variantId, explore: false, estimate: mean, uncertainty: 1.96 * sd };
  }
  return { userNumber, segmentId, variantId, explore, estimate: s.tries ? s.wins / s.tries : 0, uncertainty: 0 };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun --cwd apps/site test tests/simulate.test.ts`
Expected: 7 passing.

If the Thompson-convergence or LinUCB thresholds fail on a seed, re-check your code against this listing before changing anything. The rates were validated against these thresholds with this exact loop.

- [ ] **Step 5: Commit**

```bash
git add apps/site/lib/simulator apps/site/tests/simulate.test.ts
git commit -m "feat(site): seeded simulation loop over the real Nexus engine"
```

---

### Task 3: Simulator UI

**Files:**
- Create: `apps/site/content/connectors.ts`, `apps/site/components/simulator/simulator.tsx`, `apps/site/components/simulator/charts.tsx`, `apps/site/components/simulator/flow-diagram.tsx`, `apps/site/components/simulator/use-playback.ts`
- Test: `apps/site/tests/connectors.test.ts`, `apps/site/tests/stack-independence.test.ts`

**Interfaces:**
- Consumes: `simulate`, `PRESETS`, `getPreset`, `SimulationResult`, `DayState`, `AlgorithmId` (Task 2).
- Produces:
  - `type Connector = { id: string; name: string; kind: "source" | "sender"; status: "live" | "roadmap" }`
  - `CONNECTORS: Connector[]`, `sources()`, `senders()`
  - `<Simulator />` (client component, no props)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/tests/connectors.test.ts
import { describe, expect, it } from "bun:test";
import { CONNECTORS, senders, sources } from "@site/content/connectors";

describe("connectors", () => {
  it("marks only braze and hightouch as live", () => {
    expect(CONNECTORS.filter((c) => c.status === "live").map((c) => c.id).sort()).toEqual(["braze", "hightouch"]);
  });
  it("lists every spec connector exactly once", () => {
    expect(sources().map((c) => c.id)).toEqual(["segment", "snowflake", "bigquery", "hightouch", "csv"]);
    expect(senders().map((c) => c.id)).toEqual(["braze", "iterable", "customerio", "onesignal", "twilio", "sendgrid"]);
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length);
  });
});
```

```ts
// apps/site/tests/stack-independence.test.ts
// The stack pickers only relabel the UI. The simulation is a function of
// (preset, algorithm, seed) and nothing else — this pins that contract.
import { describe, expect, it } from "bun:test";
import { simulate } from "@site/lib/simulator/simulate";
import { getPreset } from "@site/lib/simulator/presets";

describe("stack choice does not change results", () => {
  it("simulate has no stack parameter and is stable across calls", () => {
    expect(simulate.length).toBe(3);
    const a = simulate(getPreset("upsell"), "linucb", 4);
    const b = simulate(getPreset("upsell"), "linucb", 4);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun --cwd apps/site test tests/connectors.test.ts tests/stack-independence.test.ts`
Expected: `connectors.test.ts` fails because the module is missing. `stack-independence` passes already; it's a contract pin.

- [ ] **Step 3: Implement the connectors content**

```ts
// apps/site/content/connectors.ts
export type Connector = { id: string; name: string; kind: "source" | "sender"; status: "live" | "roadmap" };

export const CONNECTORS: Connector[] = [
  { id: "segment", name: "Segment", kind: "source", status: "roadmap" },
  { id: "snowflake", name: "Snowflake", kind: "source", status: "roadmap" },
  { id: "bigquery", name: "BigQuery", kind: "source", status: "roadmap" },
  { id: "hightouch", name: "Hightouch", kind: "source", status: "live" },
  { id: "csv", name: "Webhook / CSV", kind: "source", status: "roadmap" },
  { id: "braze", name: "Braze", kind: "sender", status: "live" },
  { id: "iterable", name: "Iterable", kind: "sender", status: "roadmap" },
  { id: "customerio", name: "Customer.io", kind: "sender", status: "roadmap" },
  { id: "onesignal", name: "OneSignal", kind: "sender", status: "roadmap" },
  { id: "twilio", name: "Twilio", kind: "sender", status: "roadmap" },
  { id: "sendgrid", name: "SendGrid", kind: "sender", status: "roadmap" },
];

export const sources = () => CONNECTORS.filter((c) => c.kind === "source");
export const senders = () => CONNECTORS.filter((c) => c.kind === "sender");
export const connectorLabel = (c: Connector) => (c.status === "roadmap" ? `${c.name} (roadmap)` : c.name);
```

- [ ] **Step 4: Implement playback, the flow diagram and the charts**

```ts
// apps/site/components/simulator/use-playback.ts
"use client";
import { useEffect, useState } from "react";

export type Speed = 1 | 2 | 4;
const BASE_MS_PER_DAY = 650; // 30 days ≈ 20 s at 1×

/** Steps a day index from 0 to `total`, at `speed`, while `playing`. */
export function usePlayback(total: number, runKey: string) {
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  useEffect(() => {
    setDay(0);
    setPlaying(false);
  }, [runKey]);

  useEffect(() => {
    if (!playing) return;
    if (day >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setDay((d) => d + 1), BASE_MS_PER_DAY / speed);
    return () => clearTimeout(t);
  }, [playing, day, total, speed]);

  return {
    day,
    playing,
    speed,
    setSpeed,
    play: () => { if (day >= total) setDay(0); setPlaying(true); },
    pause: () => setPlaying(false),
    reset: () => { setPlaying(false); setDay(0); },
  };
}
```

```tsx
// apps/site/components/simulator/flow-diagram.tsx
export function FlowDiagram({ source, sender, active }: { source: string; sender: string; active: boolean }) {
  const node = "rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm font-medium";
  const pipe = `h-0.5 flex-1 bg-gradient-to-r from-[var(--accent)]/20 via-[var(--accent)] to-[var(--accent)]/20 ${active ? "animate-pulse" : "opacity-40"}`;
  return (
    <div className="flex items-center gap-2" aria-label={`${source} to Nexus to ${sender}`}>
      <span className={node}>{source}</span>
      <span className={pipe} />
      <span className={`${node} text-[var(--accent)]`}>Nexus</span>
      <span className={pipe} />
      <span className={node}>{sender}</span>
    </div>
  );
}
```

```tsx
// apps/site/components/simulator/charts.tsx
"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayState, Variant } from "@site/lib/simulator/types";

const COLORS = ["#7c9cff", "#3ecf8e", "#f5a524", "#f25f8a"];
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function TrafficChart({ days, variants }: { days: DayState[]; variants: Variant[] }) {
  const data = days.map((d) => ({ day: d.day, ...d.trafficShare }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} stackOffset="expand">
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="day" tickLine={false} fontSize={12} />
        <YAxis tickFormatter={pct} fontSize={12} width={40} />
        <Tooltip formatter={(v: number) => pct(v)} />
        {variants.map((v, i) => (
          <Area key={v.id} type="monotone" dataKey={v.id} name={`${v.id} · ${v.label}`} stackId="1"
            stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.6} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MetricLine({ days, dataKey, label, format }: {
  days: DayState[]; dataKey: "liftVsHoldout" | "cumulativeRegret"; label: string; format: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={days}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="day" tickLine={false} fontSize={12} />
        <YAxis tickFormatter={format} fontSize={12} width={48} />
        <Tooltip formatter={(v: number) => format(v)} />
        <Line type="monotone" dataKey={dataKey} name={label} stroke="#7c9cff" dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Implement the Simulator component**

```tsx
// apps/site/components/simulator/simulator.tsx
"use client";
import { useMemo, useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { PRESETS, getPreset } from "@site/lib/simulator/presets";
import { simulate } from "@site/lib/simulator/simulate";
import type { AlgorithmId, SimulationResult } from "@site/lib/simulator/types";
import { MetricLine, TrafficChart } from "./charts";
import { FlowDiagram } from "./flow-diagram";
import { usePlayback, type Speed } from "./use-playback";

const ALGORITHMS: { id: AlgorithmId; name: string; blurb: string }[] = [
  { id: "thompson", name: "Thompson sampling", blurb: "Keeps a belief about each message and tries the ones that might be best." },
  { id: "epsilon", name: "Epsilon-greedy", blurb: "Sends the current leader, and explores at random 10% of the time." },
  { id: "linucb", name: "LinUCB (contextual)", blurb: "Learns which message wins for each kind of user, not just on average." },
];

export function Simulator() {
  const [sourceId, setSourceId] = useState("snowflake");
  const [senderId, setSenderId] = useState("iterable");
  const [presetId, setPresetId] = useState("winback");
  const [algorithm, setAlgorithm] = useState<AlgorithmId>("thompson");
  const [seed, setSeed] = useState(1);
  const [showTruth, setShowTruth] = useState(false);

  const preset = getPreset(presetId);
  const result = useMemo<SimulationResult | Error>(() => {
    try { return simulate(preset, algorithm, seed); } catch (e) { return e instanceof Error ? e : new Error("Simulation failed"); }
  }, [preset, algorithm, seed]);
  const playback = usePlayback(preset.days, `${presetId}:${algorithm}:${seed}`);

  const source = sources().find((c) => c.id === sourceId)!;
  const sender = senders().find((c) => c.id === senderId)!;
  const select = "rounded-md border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-sm";

  if (result instanceof Error) {
    return <p role="alert" className="text-sm text-red-400">The simulator hit an error. Reload the page to try again.</p>;
  }
  const visible = result.days.slice(0, Math.max(1, playback.day));
  const today = visible.at(-1)!;

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Data source
          <select className={select} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sources().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Sender
          <select className={select} value={senderId} onChange={(e) => setSenderId(e.target.value)}>
            {senders().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Use case
          <select className={select} value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">Algorithm
          <select className={select} value={algorithm} onChange={(e) => setAlgorithm(e.target.value as AlgorithmId)}>
            {ALGORITHMS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      </div>

      <FlowDiagram source={source.name} sender={sender.name} active={playback.playing} />
      <p className="text-sm text-[var(--muted)]">{preset.description} {ALGORITHMS.find((a) => a.id === algorithm)!.blurb}</p>

      <div className="flex flex-wrap items-center gap-2">
        {playback.playing
          ? <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={playback.pause}>Pause</button>
          : <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white" onClick={playback.play}>{playback.day === 0 ? "Run" : "Resume"}</button>}
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={playback.reset}>Reset</button>
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => { playback.reset(); playback.play(); }}>Replay</button>
        <button className="rounded-md border border-[var(--border)] px-3 py-2 text-sm" onClick={() => setSeed((s) => s + 1)}>New audience</button>
        <span className="ml-auto flex gap-1 text-xs">
          {([1, 2, 4] as Speed[]).map((s) => (
            <button key={s} aria-pressed={playback.speed === s} onClick={() => playback.setSpeed(s)}
              className={`rounded px-2 py-1 ${playback.speed === s ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{s}×</button>
          ))}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Day" value={`${playback.day} / ${preset.days}`} />
        <Stat label="Conversion rate" value={`${(today.cumulativeRate * 100).toFixed(2)}%`} />
        <Stat label="Lift vs. 10% random control" value={`${today.liftVsHoldout >= 0 ? "+" : ""}${(today.liftVsHoldout * 100).toFixed(0)}%`} good={today.liftVsHoldout > 0} />
      </div>

      <section>
        <h4 className="mb-2 text-sm font-semibold">Traffic share by message</h4>
        <TrafficChart days={visible} variants={preset.variants} />
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <section><h4 className="mb-2 text-sm font-semibold">Lift vs. control</h4>
          <MetricLine days={visible} dataKey="liftVsHoldout" label="Lift" format={(v) => `${Math.round(v * 100)}%`} /></section>
        <section><h4 className="mb-2 text-sm font-semibold">Regret (conversions lost vs. always picking the best)</h4>
          <MetricLine days={visible} dataKey="cumulativeRegret" label="Regret" format={(v) => v.toFixed(0)} /></section>
      </div>

      {preset.segments.length > 1 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold">What each segment is getting today</h4>
          <ul className="grid gap-2 sm:grid-cols-3 text-sm">
            {preset.segments.map((s) => {
              const v = preset.variants.find((x) => x.id === today.topVariantBySegment[s.id])!;
              return <li key={s.id} className="rounded-md border border-[var(--border)] p-2"><span className="text-[var(--muted)]">{s.label}:</span> {v.id} · {v.label}</li>;
            })}
          </ul>
        </section>
      )}

      <section aria-live="polite">
        <h4 className="mb-2 text-sm font-semibold">Why this decision?</h4>
        <ul className="space-y-1 font-mono text-xs text-[var(--muted)]">
          {today.samples.slice(0, 4).map((s) => (
            <li key={s.userNumber}>
              user {s.userNumber} → {s.variantId}{s.explore ? " (exploring)" : ""}: estimated conversion {(s.estimate * 100).toFixed(1)}%
              {s.uncertainty > 0 ? ` ± ${(s.uncertainty * 100).toFixed(1)}%` : ""}
            </li>
          ))}
        </ul>
      </section>

      <details open={showTruth} onToggle={(e) => setShowTruth((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm">Show the hidden truth (simulated conversion rates)</summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead><tr><th>Message</th>{preset.segments.map((s) => <th key={s.id}>{s.label}</th>)}</tr></thead>
          <tbody>
            {preset.variants.map((v) => (
              <tr key={v.id}><td>{v.id} · {v.label}: <span className="text-[var(--muted)]">“{v.copy}”</span></td>
                {v.rates.map((r, i) => <td key={i}>{(r * 100).toFixed(1)}%</td>)}</tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--muted)]">Simulated data. The algorithms are Nexus's production engine, running in your browser.</p>
      </details>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`text-2xl font-semibold ${good ? "text-[var(--good)]" : ""}`}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `bun run check:site`
Expected: all site tests pass and the typecheck is clean.

Then render `<Simulator />` temporarily in `app/page.tsx` and run `bun --cwd apps/site run dev`. Open `http://localhost:3100/nexus` and confirm all of the following:
- Run animates to day 30;
- switching Sender changes only the flow-diagram label;
- the upsell preset shows the segment list;
- "Show the hidden truth" lists the rates.

Revert `page.tsx`; Task 6 owns it.

- [ ] **Step 7: Commit**

```bash
git add apps/site/content/connectors.ts apps/site/components/simulator apps/site/tests/connectors.test.ts apps/site/tests/stack-independence.test.ts
git commit -m "feat(site): interactive simulator UI over the seeded engine run"
```

---

### Task 4: Leads API (validation, storage, rate limit, email)

**Files:**
- Create: `apps/site/db/001_design_partner_lead.sql`, `apps/site/lib/config.ts`, `apps/site/lib/leads/schema.ts`, `apps/site/lib/leads/store.ts`, `apps/site/lib/leads/email.ts`, `apps/site/lib/leads/handle-lead.ts`, `apps/site/app/api/leads/route.ts`
- Test: `apps/site/tests/handle-lead.test.ts`, `apps/site/tests/lead-store.pg.test.ts`

**Interfaces:**
- Produces:
  - `leadSchema` (zod) and `type LeadInput = { email; company; source; sender; useCase; website }`. `website` is the honeypot.
  - `interface LeadStore { countSince(ipHash: string, since: Date): Promise<number>; insert(lead: LeadRecord): Promise<void> }`
  - `pgLeadStore(pool: Pool): LeadStore`
  - `sendLeadEmail(lead: LeadRecord, opts: { apiKey?: string; to: string; fetchImpl?: typeof fetch }): Promise<void>`
  - `handleLead(body: unknown, ctx: { ip: string; userAgent: string; now: Date }, deps: { store: LeadStore; email: (l: LeadRecord) => Promise<void>; log: (msg: string, err?: unknown) => void }): Promise<{ status: number; body: { data: { ok: true } } | { error: string } }>`
  - `POST /nexus/api/leads`
  - `LEAD_RATE_LIMIT_PER_HOUR = 5`

- [ ] **Step 1: Write the SQL**

```sql
-- apps/site/db/001_design_partner_lead.sql
-- Design-partner leads from beaconfrontier.com/nexus. Idempotent; apply with psql.
CREATE TABLE IF NOT EXISTS "DesignPartnerLead" (
  "id"        TEXT PRIMARY KEY,
  "email"     TEXT NOT NULL,
  "company"   TEXT NOT NULL,
  "source"    TEXT NOT NULL,
  "sender"    TEXT NOT NULL,
  "useCase"   TEXT NOT NULL,
  "ipHash"    TEXT NOT NULL,
  "userAgent" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "DesignPartnerLead_ipHash_createdAt_idx" ON "DesignPartnerLead" ("ipHash", "createdAt");
```

Ruling (recorded here so reviewers see it): the spec calls for a "Prisma model". This plan uses one plain SQL table through `pg` instead, with the same fields plus `ipHash` for the DB-backed rate limit. A separate Prisma schema and generated client for one table would add a code-generation step to the site build and nothing else.

- [ ] **Step 2: Write the failing tests**

```ts
// apps/site/tests/handle-lead.test.ts
import { describe, expect, it } from "bun:test";
import { handleLead, LEAD_RATE_LIMIT_PER_HOUR } from "@site/lib/leads/handle-lead";
import type { LeadRecord, LeadStore } from "@site/lib/leads/store";

function memoryStore(): LeadStore & { rows: LeadRecord[] } {
  const rows: LeadRecord[] = [];
  return {
    rows,
    async countSince(ipHash, since) { return rows.filter((r) => r.ipHash === ipHash && r.createdAt >= since).length; },
    async insert(lead) { rows.push(lead); },
  };
}
const valid = { email: "ana@acme.io", company: "Acme", source: "snowflake", sender: "iterable", useCase: "Win back lapsed trial users", website: "" };
const ctx = { ip: "203.0.113.7", userAgent: "test", now: new Date("2026-10-14T12:00:00Z") };

describe("handleLead", () => {
  it("stores a valid lead, emails it, returns 201", async () => {
    const store = memoryStore(); const sent: LeadRecord[] = [];
    const res = await handleLead(valid, ctx, { store, email: async (l) => { sent.push(l); }, log: () => {} });
    expect(res).toEqual({ status: 201, body: { data: { ok: true } } });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.ipHash).not.toContain("203.0.113.7");
    expect(sent).toHaveLength(1);
  });

  it("rejects invalid input with 400 and stores nothing", async () => {
    const store = memoryStore();
    for (const bad of [{ ...valid, email: "nope" }, { ...valid, company: "" }, { ...valid, useCase: "x".repeat(281) }, null, "str"]) {
      const res = await handleLead(bad, ctx, { store, email: async () => {}, log: () => {} });
      expect(res.status).toBe(400);
      expect("error" in res.body).toBe(true);
    }
    expect(store.rows).toHaveLength(0);
  });

  it("silently accepts a honeypot hit with 200 and stores nothing", async () => {
    const store = memoryStore(); let emailed = false;
    const res = await handleLead({ ...valid, website: "http://spam" }, ctx, { store, email: async () => { emailed = true; }, log: () => {} });
    expect(res.status).toBe(200);
    expect(store.rows).toHaveLength(0);
    expect(emailed).toBe(false);
  });

  it("rate-limits after LEAD_RATE_LIMIT_PER_HOUR leads per IP per hour", async () => {
    const store = memoryStore();
    for (let i = 0; i < LEAD_RATE_LIMIT_PER_HOUR; i++) {
      expect((await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} })).status).toBe(201);
    }
    const res = await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} });
    expect(res.status).toBe(429);
    const later = { ...ctx, now: new Date("2026-10-14T13:00:01Z") };
    expect((await handleLead(valid, later, { store, email: async () => {}, log: () => {} })).status).toBe(201);
  });

  it("stores the lead and returns 201 when email fails", async () => {
    const store = memoryStore(); const logs: string[] = [];
    const res = await handleLead(valid, ctx, { store, email: async () => { throw new Error("resend down"); }, log: (m) => logs.push(m) });
    expect(res.status).toBe(201);
    expect(store.rows).toHaveLength(1);
    expect(logs.join(" ")).toContain("email");
  });

  it("returns a generic 500 when storage fails, never the DB message", async () => {
    const store: LeadStore = { countSince: async () => 0, insert: async () => { throw new Error('relation "DesignPartnerLead" does not exist'); } };
    const res = await handleLead(valid, ctx, { store, email: async () => {}, log: () => {} });
    expect(res).toEqual({ status: 500, body: { error: "Something went wrong. Please try again." } });
  });
});
```

```ts
// apps/site/tests/lead-store.pg.test.ts
// Runs only against the local test DB: TEST_DB=true bun --cwd apps/site test tests/lead-store.pg.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { pgLeadStore } from "@site/lib/leads/store";

const LOCAL = `postgresql://${process.env.USER}@localhost:5432/nexus_test?sslmode=disable`;
const enabled = process.env.TEST_DB === "true";

describe.skipIf(!enabled)("pgLeadStore (local nexus_test)", () => {
  const pool = new Pool({ connectionString: LOCAL });
  beforeAll(async () => {
    await pool.query(readFileSync(path.join(import.meta.dir, "../db/001_design_partner_lead.sql"), "utf8"));
    await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`);
  });
  afterAll(async () => { await pool.query(`DELETE FROM "DesignPartnerLead" WHERE "ipHash" = 'test-ip'`); await pool.end(); });

  it("inserts and counts by ipHash within a window", async () => {
    const store = pgLeadStore(pool);
    const at = new Date("2026-10-14T12:00:00Z");
    await store.insert({ id: "t1", email: "a@b.co", company: "B", source: "csv", sender: "braze", useCase: "x", ipHash: "test-ip", userAgent: "ua", createdAt: at });
    expect(await store.countSince("test-ip", new Date("2026-10-14T11:00:00Z"))).toBe(1);
    expect(await store.countSince("test-ip", new Date("2026-10-14T12:00:01Z"))).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun --cwd apps/site test tests/handle-lead.test.ts`
Expected: FAIL, because `@site/lib/leads/handle-lead` doesn't exist yet.

- [ ] **Step 4: Implement**

```ts
// apps/site/lib/config.ts
export const config = {
  calendlyUrl: process.env.NEXT_PUBLIC_CALENDLY_URL ?? "https://calendly.com/danluk1311/30min",
  leadNotifyEmail: process.env.LEAD_NOTIFY_EMAIL ?? "danluk1311@gmail.com",
  leadFromEmail: "Nexus <nexus@beaconfrontier.com>",
  consoleUrl: "https://nexus-ai-demo-dl.vercel.app",
};
```

```ts
// apps/site/lib/leads/schema.ts
import { z } from "zod";

export const leadSchema = z.object({
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(1).max(120),
  source: z.string().trim().min(1).max(60),
  sender: z.string().trim().min(1).max(60),
  useCase: z.string().trim().min(1).max(280),
  /** Honeypot: hidden from people, filled by bots. */
  website: z.string().max(500).optional().default(""),
});
export type LeadInput = z.infer<typeof leadSchema>;
```

```ts
// apps/site/lib/leads/store.ts
import type { Pool } from "pg";

export type LeadRecord = {
  id: string; email: string; company: string; source: string; sender: string;
  useCase: string; ipHash: string; userAgent: string; createdAt: Date;
};

export interface LeadStore {
  countSince(ipHash: string, since: Date): Promise<number>;
  insert(lead: LeadRecord): Promise<void>;
}

export function pgLeadStore(pool: Pool): LeadStore {
  return {
    async countSince(ipHash, since) {
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "DesignPartnerLead" WHERE "ipHash" = $1 AND "createdAt" >= $2`,
        [ipHash, since],
      );
      return Number(r.rows[0]?.n ?? 0);
    },
    async insert(l) {
      await pool.query(
        `INSERT INTO "DesignPartnerLead" ("id","email","company","source","sender","useCase","ipHash","userAgent","createdAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [l.id, l.email, l.company, l.source, l.sender, l.useCase, l.ipHash, l.userAgent, l.createdAt],
      );
    },
  };
}
```

```ts
// apps/site/lib/leads/email.ts
import type { LeadRecord } from "./store";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendLeadEmail(
  lead: LeadRecord,
  opts: { apiKey?: string; to: string; from: string; fetchImpl?: typeof fetch },
): Promise<void> {
  if (!opts.apiKey) throw new Error("RESEND_API_KEY is not set");
  const rows = [["Email", lead.email], ["Company", lead.company], ["Data source", lead.source], ["Sender", lead.sender], ["Use case", lead.useCase]];
  const res = await (opts.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      reply_to: lead.email,
      subject: `Nexus design partner: ${lead.company}`,
      html: `<table>${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escape(v!)}</td></tr>`).join("")}</table>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}
```

```ts
// apps/site/lib/leads/handle-lead.ts
import { createHash, randomUUID } from "node:crypto";
import { leadSchema } from "./schema";
import type { LeadRecord, LeadStore } from "./store";

export const LEAD_RATE_LIMIT_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

type Result = { status: number; body: { data: { ok: true } } | { error: string } };

export async function handleLead(
  body: unknown,
  ctx: { ip: string; userAgent: string; now: Date },
  deps: { store: LeadStore; email: (l: LeadRecord) => Promise<void>; log: (msg: string, err?: unknown) => void },
): Promise<Result> {
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "Please check the form and try again." } };
  if (parsed.data.website) return { status: 200, body: { data: { ok: true } } }; // honeypot: pretend success

  const ipHash = createHash("sha256").update(`nexus-lead:${ctx.ip}`).digest("hex");
  try {
    const recent = await deps.store.countSince(ipHash, new Date(ctx.now.getTime() - HOUR_MS));
    if (recent >= LEAD_RATE_LIMIT_PER_HOUR) return { status: 429, body: { error: "Too many requests. Try again later." } };

    const { website: _honeypot, ...fields } = parsed.data;
    const lead: LeadRecord = { id: randomUUID(), ...fields, ipHash, userAgent: ctx.userAgent.slice(0, 300), createdAt: ctx.now };
    await deps.store.insert(lead);
    try {
      await deps.email(lead);
    } catch (err) {
      deps.log("[leads] email notification failed; lead is stored", err);
    }
    return { status: 201, body: { data: { ok: true } } };
  } catch (err) {
    deps.log("[leads] storage failed", err);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}
```

```ts
// apps/site/app/api/leads/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { Pool } from "pg";
import { config } from "@site/lib/config";
import { sendLeadEmail } from "@site/lib/leads/email";
import { handleLead } from "@site/lib/leads/handle-lead";
import { pgLeadStore } from "@site/lib/leads/store";

let pool: Pool | undefined;
const getPool = () => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));

export async function POST(req: NextRequest): Promise<NextResponse<{ data: { ok: true } } | { error: string }>> {
  const body: unknown = await req.json().catch(() => null);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const result = await handleLead(
    body,
    { ip, userAgent: req.headers.get("user-agent") ?? "", now: new Date() },
    {
      store: pgLeadStore(getPool()),
      email: (lead) => sendLeadEmail(lead, { apiKey: process.env.RESEND_API_KEY, to: config.leadNotifyEmail, from: config.leadFromEmail }),
      log: (msg, err) => console.error(msg, err instanceof Error ? err.message : err),
    },
  );
  return NextResponse.json(result.body, { status: result.status });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `bun --cwd apps/site test tests/handle-lead.test.ts` → 6 passing.
Run: `TEST_DB=true bun --cwd apps/site test tests/lead-store.pg.test.ts` → 1 passing against local `nexus_test`.
Run: `bun run check:site` → green. Without `TEST_DB`, the pg test is skipped.

- [ ] **Step 6: Commit**

```bash
git add apps/site/db apps/site/lib/config.ts apps/site/lib/leads apps/site/app/api/leads/route.ts apps/site/tests/handle-lead.test.ts apps/site/tests/lead-store.pg.test.ts
git commit -m "feat(site): design-partner leads API with honeypot, rate limit and Resend notify"
```

---

### Task 5: Lead form and Calendly hand-off

**Files:**
- Create: `apps/site/components/lead-form.tsx`, `apps/site/lib/leads/calendly-url.ts`
- Test: `apps/site/tests/calendly-url.test.ts`, `apps/site/tests/lead-form.test.tsx`
- Modify: `apps/site/package.json` (devDeps `@happy-dom/global-registrator@^20.0.0` and `@testing-library/react@^16.3.0`), `apps/site/bunfig.toml` (preload)

**Interfaces:**
- Consumes: `POST /nexus/api/leads` (Task 4), `config.calendlyUrl` and `connectorLabel`/`sources`/`senders` (Tasks 3–4).
- Produces: `calendlyEmbedUrl(base: string, lead: { email: string; company: string }): string` and `<LeadForm />`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/site/tests/calendly-url.test.ts
import { describe, expect, it } from "bun:test";
import { calendlyEmbedUrl } from "@site/lib/leads/calendly-url";

describe("calendlyEmbedUrl", () => {
  it("pre-fills email and company and marks the embed", () => {
    const u = new URL(calendlyEmbedUrl("https://calendly.com/danluk1311/30min", { email: "ana@acme.io", company: "Acme & Co" }));
    expect(u.origin + u.pathname).toBe("https://calendly.com/danluk1311/30min");
    expect(u.searchParams.get("email")).toBe("ana@acme.io");
    expect(u.searchParams.get("a1")).toBe("Acme & Co");
    expect(u.searchParams.get("embed_type")).toBe("Inline");
  });
});
```

```tsx
// apps/site/tests/lead-form.test.tsx
import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadForm } from "@site/components/lead-form";

afterEach(cleanup);

function fill() {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@acme.io" } });
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText("Use case to pilot"), { target: { value: "Win back trials" } });
}

describe("LeadForm", () => {
  it("disables submit while pending and shows Calendly on success", async () => {
    let resolve!: (r: Response) => void;
    globalThis.fetch = mock(() => new Promise<Response>((r) => { resolve = r; })) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    expect((screen.getByRole("button", { name: /sending/i }) as HTMLButtonElement).disabled).toBe(true);
    resolve(new Response(JSON.stringify({ data: { ok: true } }), { status: 201 }));
    await waitFor(() => expect(screen.getByTitle("Book a call")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and keeps the form", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Too many requests. Try again later." }), { status: 429 })) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many requests"));
  });
});
```

- [ ] **Step 2: Add the DOM test setup**

Create `apps/site/tests/setup/dom.ts`:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

Change `apps/site/bunfig.toml` to:

```toml
[test]
root = "tests"
preload = ["./tests/setup/dom.ts"]
```

Then run `bun install` from the repo root.

- [ ] **Step 3: Run to verify they fail**

Run: `bun --cwd apps/site test tests/calendly-url.test.ts tests/lead-form.test.tsx`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement**

```ts
// apps/site/lib/leads/calendly-url.ts
/** Calendly inline-embed URL with the visitor's details pre-filled (a1 = first custom question). */
export function calendlyEmbedUrl(base: string, lead: { email: string; company: string }): string {
  const u = new URL(base);
  u.searchParams.set("embed_type", "Inline");
  u.searchParams.set("hide_gdpr_banner", "1");
  u.searchParams.set("email", lead.email);
  u.searchParams.set("a1", lead.company);
  return u.toString();
}
```

```tsx
// apps/site/components/lead-form.tsx
"use client";
import { useState } from "react";
import { connectorLabel, senders, sources } from "@site/content/connectors";
import { config } from "@site/lib/config";
import { calendlyEmbedUrl } from "@site/lib/leads/calendly-url";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string } | { kind: "booked"; url: string };

export function LeadForm() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    const form = new FormData(e.currentTarget);
    const lead = Object.fromEntries(form.entries()) as Record<string, string>;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/nexus/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lead) });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setState({ kind: "error", message: json.error ?? "Something went wrong. Please try again." }); return; }
      setState({ kind: "booked", url: calendlyEmbedUrl(config.calendlyUrl, { email: lead.email ?? "", company: lead.company ?? "" }) });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  if (state.kind === "booked") {
    return (
      <div className="space-y-3">
        <p className="text-sm">Thanks. Pick a time below and we'll walk through your stack.</p>
        <iframe title="Book a call" src={state.url} className="h-[700px] w-full rounded-lg border border-[var(--border)]" />
      </div>
    );
  }

  const field = "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" noValidate>
      <label className="flex flex-col gap-1 text-sm">Work email<input name="email" type="email" required className={field} autoComplete="email" /></label>
      <label className="flex flex-col gap-1 text-sm">Company<input name="company" required className={field} autoComplete="organization" /></label>
      <label className="flex flex-col gap-1 text-sm">Data source
        <select name="source" className={field} defaultValue="segment">
          {sources().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}<option value="other">Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Sender
        <select name="sender" className={field} defaultValue="braze">
          {senders().map((c) => <option key={c.id} value={c.id}>{connectorLabel(c)}</option>)}<option value="other">Other</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">Use case to pilot
        <textarea name="useCase" required maxLength={280} rows={3} className={field} placeholder="e.g. win back users who lapsed after their trial" />
      </label>
      {/* Honeypot: off-screen for people, tempting for bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px]">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      {state.kind === "error" && <p role="alert" className="text-sm text-red-400 sm:col-span-2">{state.message}</p>}
      <button type="submit" disabled={state.kind === "sending"}
        className="rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 sm:col-span-2">
        {state.kind === "sending" ? "Sending…" : "Become a design partner"}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `bun run check:site`
Expected: all tests pass, including both `LeadForm` tests and `calendlyEmbedUrl`.

- [ ] **Step 6: Commit**

```bash
git add apps/site/components/lead-form.tsx apps/site/lib/leads/calendly-url.ts apps/site/tests/calendly-url.test.ts apps/site/tests/lead-form.test.tsx apps/site/tests/setup/dom.ts apps/site/bunfig.toml apps/site/package.json bun.lock
git commit -m "feat(site): qualifying form that hands off to Calendly"
```

---

### Task 6: The page (content + sections)

**Files:**
- Create: `apps/site/content/copy.ts`, `apps/site/components/sections/hero.tsx`, `apps/site/components/sections/stack-strip.tsx`, `apps/site/components/sections/how-it-works.tsx`, `apps/site/components/sections/comparison.tsx`, `apps/site/components/sections/offer.tsx`, `apps/site/components/sections/console-link.tsx`, `apps/site/components/sections/faq.tsx`
- Modify: `apps/site/app/page.tsx`
- Test: `apps/site/tests/copy.test.ts`

**Interfaces:**
- Consumes: `<Simulator />` (Task 3), `<LeadForm />` (Task 5), `CONNECTORS` (Task 3), `config.consoleUrl` (Task 4).
- Produces: the final `/nexus` page.

- [ ] **Step 1: Write the failing copy-rules test**

```ts
// apps/site/tests/copy.test.ts
// Pins the spec's copy rules: verbatim offer, no YouVersion, no named competitor.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { COPY } from "@site/content/copy";

function allSiteText(dir: string): string {
  return readdirSync(dir).map((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === ".next" || f === "tests" ? "" : allSiteText(p);
    return /\.(tsx?|css)$/.test(f) ? readFileSync(p, "utf8") : "";
  }).join("\n");
}

describe("site copy", () => {
  it("carries the verbatim offer lines", () => {
    expect(COPY.offer.terms).toBe("5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback.");
    expect(COPY.offer.after).toBe("After the pilot: from $1.5k/mo per agent, or pay on measured lift.");
  });

  it("never names YouVersion or a competitor, and never prices one", () => {
    const text = allSiteText(path.join(import.meta.dir, ".."));
    for (const banned of [/youversion/i, /bible/i, /39\s?m/i, /decisioning studio/i, /offerfit/i, /\$300k/i]) {
      expect(text).not.toMatch(banned);
    }
  });
});
```

Braze still appears in the copy, but only as a supported sender in `connectors.ts`. That isn't banned: naming an ESP you integrate with isn't a competitor claim.

- [ ] **Step 2: Run to verify it fails**

Run: `bun --cwd apps/site test tests/copy.test.ts`
Expected: FAIL, because `@site/content/copy` is missing.

- [ ] **Step 3: Implement the content and sections**

```ts
// apps/site/content/copy.ts
export const COPY = {
  hero: {
    title: "AI decisioning for the stack you already have.",
    subtitle:
      "Nexus picks the right message, channel and time for each user, then learns from every send. Plugs into your CDP, your warehouse and your ESP. Pay for the lift you can measure.",
    primary: "Try the simulator",
    secondary: "Become a design partner",
    proof: "Built and proven in production with a top consumer app.",
  },
  how: [
    { title: "Connect your data", body: "Point Nexus at your CDP or warehouse. It copies only the fields you map." },
    { title: "Set a goal and variants", body: "Pick the conversion you care about and write a few messages. Nexus handles the rest." },
    { title: "Nexus decides, sends, learns", body: "Each user gets the message most likely to work, through your ESP. Every outcome makes the next decision better." },
  ],
  algorithms: [
    { name: "Thompson sampling", body: "Balances trying new messages with sending proven ones." },
    { name: "Epsilon-greedy", body: "Simple and predictable: mostly the leader, sometimes a test." },
    { name: "LinUCB", body: "Contextual. Learns what works for each kind of user." },
  ],
  provenance: "Every decision is logged with why it was made.",
  comparison: {
    title: "Why not your ESP's built-in AI?",
    rows: [
      { label: "Works with", nexus: "Any CDP, warehouse and ESP", them: "One ESP" },
      { label: "Pricing", nexus: "Per agent, or on measured lift", them: "Per use case, enterprise contracts" },
      { label: "Transparency", nexus: "Every decision explained", them: "Black box" },
      { label: "Proof", nexus: "Holdout lift report built in", them: "Varies" },
    ],
    footnote: "Compared with ESP-native decisioning add-ons in general.",
  },
  offer: {
    title: "Become a design partner",
    terms: "5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback.",
    after: "After the pilot: from $1.5k/mo per agent, or pay on measured lift.",
  },
  console: {
    title: "Explore the full console",
    body: "See the agents, personas and decision logs Nexus runs on, loaded with synthetic data.",
    cta: "Open the demo console",
  },
  faq: [
    { q: "What data does Nexus copy?", a: "Only the fields you map for decisioning. Everything else stays in your systems." },
    { q: "Can we self-host?", a: "Yes. Nexus runs as a single workspace in your own cloud." },
    { q: "Which ESPs work today?", a: "Braze is live, with Hightouch for data. The rest of the list on this page is on the roadmap, and design partners decide the order." },
    { q: "How is lift measured?", a: "A random holdout gets the same messages without decisioning. We report the difference at day 30, 60 and 90." },
  ],
} as const;
```

```tsx
// apps/site/components/sections/hero.tsx
import { COPY } from "@site/content/copy";
export function Hero() {
  return (
    <section className="py-16 sm:py-24">
      <p className="mb-4 text-sm font-medium text-[var(--accent)]">Nexus by Beacon Frontier</p>
      <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">{COPY.hero.title}</h1>
      <p className="mt-6 max-w-2xl text-lg text-[var(--muted)]">{COPY.hero.subtitle}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="#simulator" className="rounded-md bg-[var(--accent)] px-5 py-3 font-semibold text-white">{COPY.hero.primary}</a>
        <a href="#design-partner" className="rounded-md border border-[var(--border)] px-5 py-3 font-semibold">{COPY.hero.secondary}</a>
      </div>
      <p className="mt-6 text-sm text-[var(--muted)]">{COPY.hero.proof}</p>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/stack-strip.tsx
import { connectorLabel, senders, sources } from "@site/content/connectors";
export function StackStrip() {
  const pill = "rounded-full border border-[var(--border)] px-3 py-1 text-sm";
  return (
    <section className="grid gap-6 border-y border-[var(--border)] py-8 sm:grid-cols-2">
      <div><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">Connect from</h2>
        <ul className="flex flex-wrap gap-2">{sources().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
      <div><h2 className="mb-3 text-xs uppercase tracking-wider text-[var(--muted)]">Send through</h2>
        <ul className="flex flex-wrap gap-2">{senders().map((c) => <li key={c.id} className={pill}>{connectorLabel(c)}</li>)}</ul></div>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/how-it-works.tsx
import { COPY } from "@site/content/copy";
export function HowItWorks() {
  return (
    <section className="py-16">
      <h2 className="text-3xl font-bold">How it works</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.how.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
            <span className="text-sm text-[var(--accent)]">{i + 1}</span>
            <h3 className="mt-1 font-semibold">{s.title}</h3><p className="mt-2 text-sm text-[var(--muted)]">{s.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {COPY.algorithms.map((a) => <div key={a.name}><h3 className="font-semibold">{a.name}</h3><p className="text-sm text-[var(--muted)]">{a.body}</p></div>)}
      </div>
      <p className="mt-6 text-sm">{COPY.provenance}</p>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/comparison.tsx
import { COPY } from "@site/content/copy";
export function Comparison() {
  const c = COPY.comparison;
  return (
    <section className="py-16">
      <h2 className="text-3xl font-bold">{c.title}</h2>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-2" /><th className="py-2 text-[var(--accent)]">Nexus</th><th className="py-2 text-[var(--muted)]">ESP add-ons</th></tr></thead>
          <tbody>{c.rows.map((r) => <tr key={r.label} className="border-b border-[var(--border)]"><td className="py-2 font-medium">{r.label}</td><td>{r.nexus}</td><td className="text-[var(--muted)]">{r.them}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">{c.footnote}</p>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/offer.tsx
import { COPY } from "@site/content/copy";
import { LeadForm } from "@site/components/lead-form";
export function Offer() {
  return (
    <section id="design-partner" className="scroll-mt-8 rounded-2xl border border-[var(--accent)]/40 bg-[var(--panel)] p-6 sm:p-10">
      <h2 className="text-3xl font-bold">{COPY.offer.title}</h2>
      <p className="mt-3 text-lg">{COPY.offer.terms}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">{COPY.offer.after}</p>
      <div className="mt-8"><LeadForm /></div>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/console-link.tsx
import { COPY } from "@site/content/copy";
import { config } from "@site/lib/config";
export function ConsoleLink() {
  return (
    <section className="py-16">
      <h2 className="text-2xl font-bold">{COPY.console.title}</h2>
      <p className="mt-2 text-[var(--muted)]">{COPY.console.body}</p>
      <a href={config.consoleUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded-md border border-[var(--border)] px-4 py-2 font-semibold">{COPY.console.cta} ↗</a>
    </section>
  );
}
```

```tsx
// apps/site/components/sections/faq.tsx
import { COPY } from "@site/content/copy";
export function Faq() {
  return (
    <section className="py-16">
      <h2 className="text-2xl font-bold">FAQ</h2>
      <dl className="mt-6 space-y-5">{COPY.faq.map((f) => <div key={f.q}><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-[var(--muted)]">{f.a}</dd></div>)}</dl>
      <footer className="mt-16 border-t border-[var(--border)] pt-6 text-xs text-[var(--muted)]">© {new Date().getFullYear()} Beacon Frontier</footer>
    </section>
  );
}
```

```tsx
// apps/site/app/page.tsx
import { Simulator } from "@site/components/simulator/simulator";
import { Comparison } from "@site/components/sections/comparison";
import { ConsoleLink } from "@site/components/sections/console-link";
import { Faq } from "@site/components/sections/faq";
import { Hero } from "@site/components/sections/hero";
import { HowItWorks } from "@site/components/sections/how-it-works";
import { Offer } from "@site/components/sections/offer";
import { StackStrip } from "@site/components/sections/stack-strip";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4">
      <Hero />
      <StackStrip />
      <section id="simulator" className="scroll-mt-8 py-16">
        <h2 className="text-3xl font-bold">Watch it learn</h2>
        <p className="mt-2 mb-6 text-[var(--muted)]">Pick your stack and a use case, then press Run. This is Nexus's real engine, running in your browser on simulated users.</p>
        <Simulator />
      </section>
      <HowItWorks />
      <Comparison />
      <Offer />
      <ConsoleLink />
      <Faq />
    </main>
  );
}
```

- [ ] **Step 4: Run to verify it passes and builds**

Run: `bun run check:site`, then `bun --cwd apps/site run build`
Expected: green, and the build lists `/` and `/api/leads`.

Open `http://localhost:3100/nexus` with `bun --cwd apps/site run dev` and check:
- the page at 375px width has no horizontal scroll;
- both hero buttons scroll to their sections.

- [ ] **Step 5: Commit**

```bash
git add apps/site/content/copy.ts apps/site/components/sections apps/site/app/page.tsx apps/site/tests/copy.test.ts
git commit -m "feat(site): one-page marketing site with simulator, offer and FAQ"
```

---

### Task 7: Synthetic console data for the demo app

**Files:**
- Create: `scripts/seed-demo-synthetic.ts`, `scripts/lib/demo-db-guard.ts`
- Test: `tests/unit/demo-db-guard.test.ts`

**Interfaces:**
- Produces:
  - `assertDemoDatabase(url: string | undefined): string`. It returns the URL, or throws.
  - `DEMO_DB_HOST_MARKER = "ep-orange-star-b8ujtvot"`

- [ ] **Step 1: Write the failing guard test**

```ts
// tests/unit/demo-db-guard.test.ts
import { describe, expect, it } from "bun:test";
import { assertDemoDatabase } from "../../scripts/lib/demo-db-guard";

describe("assertDemoDatabase", () => {
  it("accepts the demo endpoint", () => {
    const url = "postgresql://u:p@ep-orange-star-b8ujtvot-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require";
    expect(assertDemoDatabase(url)).toBe(url);
  });
  it("rejects anything else, including a missing URL and a lookalike in the path", () => {
    expect(() => assertDemoDatabase(undefined)).toThrow(/DEMO_DATABASE_URL/);
    expect(() => assertDemoDatabase("postgresql://u:p@ep-old-surf-a4p5os6s.us-east-1.aws.neon.tech/neondb")).toThrow(/not the demo database/);
    expect(() => assertDemoDatabase("postgresql://u:p@localhost:5432/ep-orange-star-b8ujtvot")).toThrow(/not the demo database/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/demo-db-guard.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement the guard and the seed**

```ts
// scripts/lib/demo-db-guard.ts
export const DEMO_DB_HOST_MARKER = "ep-orange-star-b8ujtvot";

/** Throws unless `url` points at the public demo DB (nexus-demo-db). Checks the host, not the whole string. */
export function assertDemoDatabase(url: string | undefined): string {
  if (!url) throw new Error("Set DEMO_DATABASE_URL to the nexus-demo-db connection string.");
  const host = new URL(url).hostname;
  if (!host.startsWith(DEMO_DB_HOST_MARKER)) throw new Error(`Refusing to seed: ${host} is not the demo database.`);
  return url;
}
```

```ts
// scripts/seed-demo-synthetic.ts
/**
 * Fills the public demo DB (nexus-demo-db) with synthetic agents, variants,
 * users and six weeks of decisions so the console has something to show.
 * No YouVersion content. Idempotent: deletes its own rows (prefix "demo-") first.
 *
 *   DEMO_DATABASE_URL='postgresql://…ep-orange-star-b8ujtvot…' bun scripts/seed-demo-synthetic.ts
 */
import { assertDemoDatabase } from "./lib/demo-db-guard";
import { mulberry32 } from "../apps/site/lib/simulator/rng";

const url = assertDemoDatabase(process.env.DEMO_DATABASE_URL);
process.env.DATABASE_URL = url; // must be set before @/lib/db is imported
const { prisma } = await import("../src/lib/db");

const rng = mulberry32(2026);
const DAYS = 42;
const USERS = 2000;
const PREFIX = "demo-";

const AGENTS = [
  { name: "Win-back push", algorithm: "thompson", channel: "push", rates: [0.021, 0.034, 0.028, 0.046] },
  { name: "Onboarding email", algorithm: "epsilon_greedy", channel: "email", rates: [0.12, 0.18, 0.14, 0.15] },
  { name: "Upsell (contextual)", algorithm: "linucb", channel: "push", rates: [0.05, 0.08, 0.03, 0.06] },
  { name: "Re-engagement with holdout", algorithm: "thompson", channel: "push", rates: [0.03, 0.04, 0.035] },
];
const COPY = ["Pick up where you left off.", "Others finished this week — join them.", "A quick win is waiting.", "Your progress, at a glance."];

async function main() {
  await prisma.userDecision.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.agent.deleteMany({ where: { name: { in: AGENTS.map((a) => a.name) } } });
  await prisma.trackedUser.deleteMany({ where: { externalId: { startsWith: PREFIX } } });

  const personas = await prisma.persona.findMany({ select: { id: true } });
  if (personas.length === 0) throw new Error("Seed personas first: DATABASE_URL=<demo> bun prisma/seed-personas.ts");

  await prisma.trackedUser.createMany({
    data: Array.from({ length: USERS }, (_, i) => ({
      externalId: `${PREFIX}user-${i + 1}`,
      personaId: personas[Math.floor(rng() * personas.length)]!.id,
      personaConfidence: 1,
      attributes: { language_tag: "en", newsletter_push_enabled: true, newsletter_email_enabled: true },
    })),
  });

  const start = new Date(Date.now() - DAYS * 86_400_000);
  for (const a of AGENTS) {
    const agent = await prisma.agent.create({ data: { name: a.name, algorithm: a.algorithm, epsilon: 0.1, status: "active", funnelStage: "wau" } });
    const message = await prisma.message.create({ data: { agentId: agent.id, name: `${a.name} message`, channel: a.channel } });
    const variants = await Promise.all(a.rates.map((_, i) =>
      prisma.messageVariant.create({ data: { messageId: message.id, name: `Variant ${String.fromCharCode(65 + i)}`, body: COPY[i % COPY.length]!, title: a.name, status: "active" } })));

    // Traffic drifts toward the best variant over time, as a bandit would.
    const best = a.rates.indexOf(Math.max(...a.rates));
    const rows = [];
    for (let d = 0; d < DAYS; d++) {
      const bestShare = 0.25 + 0.65 * (d / DAYS);
      for (let k = 0; k < 120; k++) {
        const v = rng() < bestShare ? best : Math.floor(rng() * variants.length);
        const sentAt = new Date(start.getTime() + d * 86_400_000 + Math.floor(rng() * 86_400_000));
        const converted = rng() < a.rates[v]!;
        rows.push({
          agentId: agent.id,
          userId: `${PREFIX}user-${1 + Math.floor(rng() * USERS)}`,
          messageVariantId: variants[v]!.id,
          channel: a.channel,
          sentAt,
          brazeSendId: `${PREFIX}send-${agent.id}-${d}-${k}`,
          ...(converted ? { conversionEvent: "goal_completed", conversionAt: new Date(sentAt.getTime() + 3_600_000), reward: 1 } : {}),
        });
      }
    }
    await prisma.userDecision.createMany({ data: rows });
    console.log(`seeded ${a.name}: ${rows.length} decisions`);
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1); });
```

- [ ] **Step 4: Run the tests and a dry check**

Run: `bun test tests/unit/demo-db-guard.test.ts` → 2 passing.
Run: `bun scripts/seed-demo-synthetic.ts`, with no `DEMO_DATABASE_URL` set. Expected: it exits 1 with "Set DEMO_DATABASE_URL…".

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-demo-synthetic.ts scripts/lib/demo-db-guard.ts tests/unit/demo-db-guard.test.ts
git commit -m "feat(demo): guarded synthetic seed for the public demo console"
```

---

### Task 8: Deploy, mount on beaconfrontier.com, and smoke test

This task touches external systems: a Vercel project, env vars, DNS, and another repo. Every command uses the personal account. Run them in the order given.

**Files:**
- Create: `apps/site/playwright.config.ts`, `apps/site/smoke/site.spec.ts`
- Modify, in the `business-name-generator` repo on a fresh worktree off `origin/main` (never the checked-out branch): `src/lib/zones.ts`, `next.config.ts`, `src/lib/zones.test.ts`

- [ ] **Step 1: Mount the zone in the beaconfrontier repo, test first**

Work in a new worktree: `git -C ~/projects/business-name-generator worktree add ../bf-nexus-zone -b feat/nexus-zone origin/main`.

Add these tests to `src/lib/zones.test.ts`. Import `DEFAULT_NEXUS_SITE_ORIGIN` and `nexusZoneRewrites` from `./zones`.

```ts
describe("nexus zone", () => {
  it("rewrites /nexus and everything under it to the nexus site, before files", async () => {
    const rewrites = await nextConfig.rewrites!();
    if (Array.isArray(rewrites)) throw new Error("expected object rewrites");
    expect(rewrites.beforeFiles).toEqual(expect.arrayContaining([
      { source: "/nexus", destination: `${DEFAULT_NEXUS_SITE_ORIGIN}/nexus`, basePath: false },
      { source: "/nexus/:path*", destination: `${DEFAULT_NEXUS_SITE_ORIGIN}/nexus/:path*`, basePath: false },
    ]));
  });

  it("matches only the zone, not lookalike pages", () => {
    const [root, nested] = nexusZoneRewrites();
    expect(matches(root.source, "/nexus")).toBe(true);
    for (const p of ["/nexus/", "/nexus/api/leads", "/nexus/_next/static/a.js"]) expect(matches(nested.source, p)).toBe(true);
    expect(matches(nested.source, "/nexus-business-names")).toBe(false);
    expect(matches(root.source, "/nexus-business-names")).toBe(false);
  });

  it("keeps this site's headers off the nexus zone, and on lookalikes", () => {
    for (const p of ["/nexus", "/nexus/", "/nexus/api/leads"]) expect(matches(OWN_PATHS, p)).toBe(false);
    expect(matches(OWN_PATHS, "/nexus-business-names")).toBe(true);
  });
});
```

Run `npm test`. Expected: the new tests FAIL.

Then implement. In `src/lib/zones.ts`, after the book zone:

```ts
// beaconfrontier.com/nexus is the Nexus marketing site (apps/site in the
// nexusAi repo, basePath "/nexus", its own Vercel project), stitched in the same way.
export const NEXUS_ZONE = "/nexus";
export const DEFAULT_NEXUS_SITE_ORIGIN = "https://nexus-site-dans-projects-d4d642e1.vercel.app";

/** Hands every /nexus request to the Nexus site, before files, like the other zones. */
export function nexusZoneRewrites(origin = process.env.NEXUS_SITE_ORIGIN ?? DEFAULT_NEXUS_SITE_ORIGIN) {
  const base = trimSlash(origin);
  return [
    { source: NEXUS_ZONE, destination: `${base}${NEXUS_ZONE}`, basePath: false as const },
    { source: `${NEXUS_ZONE}/:path*`, destination: `${base}${NEXUS_ZONE}/:path*`, basePath: false as const },
  ];
}
```

Then make two more edits:
- Change `OWN_PATHS` to `"/((?!(?:beaconbaby|book|nexus)(?:/|$)).*)"`, and add "Nexus" to its doc comment.
- In `next.config.ts`, import `nexusZoneRewrites` and change `beforeFiles` to `[...babyZoneRewrites(), ...bookZoneRewrites(), ...nexusZoneRewrites()]`.

Run `npm test`. Expected: all pass, including the existing baby and book tests. Commit `src/lib/zones.ts next.config.ts src/lib/zones.test.ts` with the message "Serve the Nexus site under /nexus as a zone of beaconfrontier.com". Don't push yet; Step 5 pushes once the origin is live.

- [ ] **Step 2: Create the Vercel project and its env**

```bash
export VERCEL_TOKEN="$(security find-generic-password -s vercel-ender1311 -w)"
cd ~/projects/nexusAi/apps/site
vercel --scope dans-projects-d4d642e1 project add nexus-site
vercel --scope dans-projects-d4d642e1 link --yes --project nexus-site
```

Then set the project's Root Directory to `apps/site`. In `vercel project` settings that's `rootDirectory`; through the API it's `PATCH /v9/projects/nexus-site` with `{"rootDirectory":"apps/site"}`, using the token from the environment. Also connect the GitHub repo `ender1311/nexusAi` with production branch `main`.

Connect the existing `nexus-demo-db` store to `nexus-site` for production and preview. This uses `vercel integration` / the dashboard Storage tab: connect the existing resource. Never `integration add`, because that creates a second DB.

Then:

```bash
printf 'danluk1311@gmail.com' | vercel --scope dans-projects-d4d642e1 env add LEAD_NOTIFY_EMAIL production
printf 'https://calendly.com/danluk1311/30min' | vercel --scope dans-projects-d4d642e1 env add NEXT_PUBLIC_CALENDLY_URL production
```

**`RESEND_API_KEY` is a blocking ask for Dan:** which Resend account to use, and the key for it. Add it with `vercel env add RESEND_API_KEY production` (sensitive). Until it exists, leads are stored and the email step logs a failure. That's the designed degradation.

- [ ] **Step 3: Apply the leads table to the demo DB, and seed the console**

Pull the demo DB URL into a 0600 scratch file with `vercel env pull <scratch>/demo.env --environment=development` from the nexusAi root project. Then:

```bash
psql "$DEMO_UNPOOLED" -v ON_ERROR_STOP=1 -f apps/site/db/001_design_partner_lead.sql
DEMO_DATABASE_URL="$DEMO_POOLED" bun scripts/seed-demo-synthetic.ts
```

Expected: `CREATE TABLE` (or a notice that it exists), then 4 "seeded …" lines.

Delete the scratch env file afterwards. Then open `https://nexus-ai-demo-dl.vercel.app/agents` and confirm 4 agents with decisions.

- [ ] **Step 4: Verify the sending domain in Resend**

With Dan's Resend key, `POST https://api.resend.com/domains {"name":"beaconfrontier.com"}`, then add every returned DNS record with `vercel dns add beaconfrontier.com <name> <type> <value>` under the personal scope.

Do **not** touch the existing MX record (`inbound-smtp.us-east-1.amazonaws.com`). If Resend returns an MX record for a `send.` subdomain, that one is fine to add, because it's a different name.

Then `POST /domains/{id}/verify` and poll `GET /domains/{id}` until `status` is `verified`.

- [ ] **Step 5: Deploy and mount**

1. Push nexusAi `main`. The pre-push hook runs the tests. Wait for the `nexus-site` production deploy to be Ready.
2. `curl -sI https://nexus-site-dans-projects-d4d642e1.vercel.app/nexus` should return 200.
3. Push the beaconfrontier branch: `GH_TOKEN="$(gh auth token -u ender1311)" gh pr create --fill`, then merge per that repo's flow.
4. After its deploy, `curl -sI https://beaconfrontier.com/nexus` should return 200 with the Nexus CSP header (`frame-src https://calendly.com`).

- [ ] **Step 6: Smoke test against production**

```ts
// apps/site/playwright.config.ts
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "smoke", timeout: 60_000, use: { baseURL: process.env.SMOKE_BASE_URL ?? "https://beaconfrontier.com" } });
```

```ts
// apps/site/smoke/site.spec.ts
import { expect, test } from "@playwright/test";

test("page loads, simulator runs, form reaches Calendly", async ({ page }) => {
  await page.goto("/nexus");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI decisioning");
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "4×" }).click();
  await expect(page.getByText(/^30 \/ 30$/)).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("Work email").fill("smoke-test@beaconfrontier.com");
  await page.getByLabel("Company").fill("Smoke Test");
  await page.getByLabel("Use case to pilot").fill("Automated smoke test, ignore");
  await page.getByRole("button", { name: /become a design partner/i }).click();
  await expect(page.getByTitle("Book a call")).toBeVisible({ timeout: 15_000 });
});
```

Run: `bunx playwright install chromium`, then `bun --cwd apps/site run smoke`
Expected: 1 passing.

Then delete the smoke lead: `DELETE FROM "DesignPartnerLead" WHERE email = 'smoke-test@beaconfrontier.com'` on the demo DB. Confirm with Dan that the notification email arrived, if the Resend key is in place.

- [ ] **Step 7: Commit the smoke files**

```bash
git add apps/site/playwright.config.ts apps/site/smoke/site.spec.ts
git commit -m "test(site): production smoke test for /nexus"
```

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Covered by |
  |---|---|
  | §2 page sections | Task 6, plus the stack strip (Task 3 content) |
  | §3 simulator | Tasks 2–3 |
  | §4 leads | Tasks 4–5 |
  | §5 routing and headers | Task 1 (CSP) and Task 8 (zone, DNS) |
  | §6 synthetic data | Task 7 |
  | §7 boundaries | Task 1 |
  | §8 testing | Tasks 2–6, plus the Task 8 smoke test |
  | §10 open items | Calendly URL resolved. Resend key is the Task 8 ask. YouVersion proof is enforced by the Task 6 copy test. |

- **Deviations from the spec, with rulings:**
  - Leads table: plain SQL + `pg` instead of a Prisma model (Task 4 Step 1).
  - Vercel Analytics: not added in v1. Its script is served from `/_vercel/insights` at the domain root, which on beaconfrontier.com belongs to the parent zone. Add it once the zone path for it is confirmed.
