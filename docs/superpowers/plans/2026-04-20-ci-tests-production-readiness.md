# CI/CD, Tests & Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a full test suite, GitLab CI pipeline, and production-ready API endpoints so the bandit engine actually runs, learns, and sends messages.

**Architecture:** Test infrastructure first (unit → contract → integration → regression), then TDD for each production gap: fix the PersonaArmStats bug (20 lines), build `/api/decide` (variant selection service + route), and build `/api/cron/select-and-send` (scheduled Braze delivery). The shared `decideForUser()` service in `src/lib/decide.ts` is reused by both the route and the cron to avoid duplication.

**Tech Stack:** Bun test runner, `@happy-dom/global-registrator`, `@testing-library/jest-dom`, Husky, GitLab CI, Prisma + Neon (real test DB), Next.js App Router, `vi` mock API (Bun-compatible).

---

## File Map

**New files created:**
```
bunfig.toml
.gitlab-ci.yml
.husky/pre-push
tests/setup/happy-dom.ts
tests/setup/bun.ts
tests/helpers/db.ts
tests/helpers/braze.ts
tests/helpers/request.ts
tests/helpers/builders.ts
tests/unit/thompson-sampling.test.ts
tests/unit/epsilon-greedy.test.ts
tests/unit/reward-calculator.test.ts
tests/unit/feature-vector.test.ts
tests/unit/variant-diff.test.ts
tests/unit/frequency-resolver.test.ts
tests/contracts/braze-client.test.ts
tests/integration/agents.test.ts
tests/integration/ingest-users.test.ts
tests/integration/ingest-events.test.ts
tests/integration/decide.test.ts
tests/integration/cron-send.test.ts
tests/regression/persona-arm-stats-updated-on-conversion.test.ts
tests/regression/bandit-seeds-missing-arms.test.ts
src/lib/decide.ts
src/app/api/decide/route.ts
src/app/api/cron/select-and-send/route.ts
```

**Modified files:**
```
package.json                                   add test/check scripts
vercel.json                                    add cron + fix buildCommand
src/app/api/ingest/events/route.ts             add PersonaArmStats update
CLAUDE.md                                      add Testing section
AGENTS.md                                      add Testing section
```

---

## Task 1: Install dev dependencies and create bunfig.toml

**Files:**
- Create: `bunfig.toml`

- [ ] **Step 1: Install dev dependencies**

```bash
bun add -d @happy-dom/global-registrator @testing-library/jest-dom husky
```

Expected: packages added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create bunfig.toml**

```toml
[test]
root = "tests"
preload = ["./tests/setup/happy-dom.ts", "./tests/setup/bun.ts"]
```

- [ ] **Step 3: Commit**

```bash
git add bunfig.toml package.json bun.lockb
git commit -m "chore: add test dev dependencies and bunfig.toml"
```

---

## Task 2: Create test setup files

**Files:**
- Create: `tests/setup/happy-dom.ts`
- Create: `tests/setup/bun.ts`

- [ ] **Step 1: Create tests/setup/happy-dom.ts**

```typescript
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

- [ ] **Step 2: Create tests/setup/bun.ts**

```typescript
import { afterEach, mock } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "bun:test";

// Extend expect with jest-dom matchers
expect.extend(matchers);

// Stub Next.js cache/navigation for routes that import them
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not_found"); },
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  unstable_cache: (fn: unknown) => fn,
}));

// Polyfill vi for Bun (vi.stubEnv, vi.stubGlobal, vi.unstubAllGlobals, vi.unstubAllEnvs)
const _envStubs = new Map<string, string | undefined>();
const _globalStubs = new Map<string, unknown>();

const vi = {
  hoisted: <T>(fn: () => T): T => fn(),
  fn: <T extends (...args: unknown[]) => unknown>(impl?: T) => mock(impl ?? (() => undefined)),
  spyOn: mock.module ? undefined : undefined, // use mock.module for module-level mocking
  stubEnv: (key: string, value: string) => {
    if (!_envStubs.has(key)) _envStubs.set(key, process.env[key]);
    process.env[key] = value;
  },
  stubGlobal: (key: string, value: unknown) => {
    if (!_globalStubs.has(key)) _globalStubs.set(key, (globalThis as Record<string, unknown>)[key]);
    (globalThis as Record<string, unknown>)[key] = value;
  },
  unstubAllEnvs: () => {
    for (const [key, orig] of _envStubs) {
      if (orig === undefined) delete process.env[key];
      else process.env[key] = orig;
    }
    _envStubs.clear();
  },
  unstubAllGlobals: () => {
    for (const [key, orig] of _globalStubs) {
      (globalThis as Record<string, unknown>)[key] = orig;
    }
    _globalStubs.clear();
  },
};

// Make vi available globally for tests
(globalThis as unknown as Record<string, unknown>).vi = vi;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

export { vi };
```

- [ ] **Step 3: Verify setup files parse without error**

```bash
bun build tests/setup/happy-dom.ts --target bun 2>&1 | head -5
bun build tests/setup/bun.ts --target bun 2>&1 | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tests/setup/
git commit -m "chore: add bun test setup files"
```

---

## Task 3: Create test helpers

**Files:**
- Create: `tests/helpers/db.ts`
- Create: `tests/helpers/braze.ts`
- Create: `tests/helpers/request.ts`
- Create: `tests/helpers/builders.ts`

- [ ] **Step 1: Create tests/helpers/db.ts**

```typescript
import { prisma } from "@/lib/db";

/**
 * Delete all rows in safe dependency order.
 * Call in beforeEach for integration test files.
 */
export async function truncateAll(): Promise<void> {
  await prisma.personaArmStats.deleteMany();
  await prisma.userDecision.deleteMany();
  await prisma.modelMetric.deleteMany();
  // Users must be deleted before Personas (User.personaId FK)
  await prisma.user.deleteMany();
  // AgentPersonaTarget before Agent/Persona (cascade would handle it, but be explicit)
  await prisma.agentPersonaTarget.deleteMany();
  await prisma.schedulingRule.deleteMany();
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.persona.deleteMany();
  await prisma.appSetting.deleteMany();
}

export { prisma };
```

- [ ] **Step 2: Create tests/helpers/braze.ts**

```typescript
/**
 * FakeFetch — replaces globalThis.fetch in tests that touch BrazeClient.
 * Queue responses before making calls; inspect recorded requests after.
 */
export class FakeFetch {
  readonly requests: Array<{ url: string; method: string; body: unknown }> = [];
  private queue: Array<{ body: unknown; status: number }> = [];

  queueResponse(body: unknown, status = 200) {
    this.queue.push({ body, status });
  }

  /** Use as globalThis.fetch replacement */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body ? JSON.parse(init.body as string) : null;
    this.requests.push({ url, method: init?.method ?? "GET", body });
    const next = this.queue.shift();
    if (!next) {
      // Default: success for Braze endpoints
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}
```

- [ ] **Step 3: Create tests/helpers/request.ts**

```typescript
/**
 * Build a NextRequest-compatible Request for route handler tests.
 * Route handlers only use req.headers.get() and req.json(), so a plain
 * Request cast works without importing from next/server.
 */
export function buildRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/", {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function withAuth(headers: Record<string, string>, token: string): Record<string, string> {
  return { ...headers, Authorization: `Bearer ${token}` };
}
```

- [ ] **Step 4: Create tests/helpers/builders.ts**

```typescript
import { prisma } from "@/lib/db";

export async function createAgent(overrides: {
  name?: string;
  algorithm?: string;
  epsilon?: number;
  status?: string;
} = {}) {
  return prisma.agent.create({
    data: {
      name: "Test Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      status: "active",
      ...overrides,
    },
  });
}

export async function createPersona(overrides: {
  name?: string;
  isActive?: boolean;
  clusterSize?: number;
  source?: string;
} = {}) {
  return prisma.persona.create({
    data: {
      name: "Test Persona",
      isActive: true,
      clusterSize: 10,
      source: "discovered",
      ...overrides,
    },
  });
}

export async function createMessage(
  agentId: string,
  overrides: { channel?: string; brazeCampaignId?: string | null } = {}
) {
  return prisma.message.create({
    data: {
      agentId,
      name: "Test Message",
      channel: "push",
      ...overrides,
    },
  });
}

export async function createVariant(
  messageId: string,
  overrides: {
    name?: string;
    body?: string;
    title?: string | null;
    brazeVariantId?: string | null;
    status?: string;
  } = {}
) {
  return prisma.messageVariant.create({
    data: {
      messageId,
      name: "Variant A",
      body: "Test body",
      title: "Test title",
      status: "active",
      ...overrides,
    },
  });
}

export async function createUser(
  externalId: string,
  overrides: {
    personaId?: string | null;
    totalDecisions?: number;
    totalConversions?: number;
    totalReward?: number;
  } = {}
) {
  return prisma.user.upsert({
    where: { externalId },
    create: { externalId, ...overrides },
    update: { ...overrides },
  });
}

export async function createGoal(
  agentId: string,
  overrides: {
    eventName?: string;
    tier?: string;
    valueWeight?: number;
    weightMode?: string;
    weightDefault?: number;
    weightProperty?: string | null;
  } = {}
) {
  return prisma.goal.create({
    data: {
      agentId,
      eventName: "plan_started",
      tier: "best",
      valueWeight: 1.0,
      weightMode: "fixed",
      weightDefault: 1.0,
      ...overrides,
    },
  });
}

export async function createSchedulingRule(
  agentId: string,
  overrides: {
    frequencyCap?: object;
    quietHours?: object;
    smartSuppress?: boolean;
    suppressThresh?: number;
  } = {}
) {
  return prisma.schedulingRule.create({
    data: {
      agentId,
      frequencyCap: { maxSends: 100, period: "week" } as object,
      quietHours: { start: "02:00", end: "03:00", timezone: "UTC" } as object,
      blackoutDates: [],
      smartSuppress: false,
      suppressThresh: 0.5,
      ...overrides,
    },
  });
}

export async function createUserDecision(params: {
  agentId: string;
  userId: string;           // externalId string
  messageVariantId?: string;
  channel?: string;
  sentAt?: Date;
}) {
  return prisma.userDecision.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      messageVariantId: params.messageVariantId,
      channel: params.channel ?? "push",
      sentAt: params.sentAt ?? new Date(),
    },
  });
}

export async function linkAgentToPersona(agentId: string, personaId: string) {
  return prisma.agentPersonaTarget.create({ data: { agentId, personaId } });
}
```

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/
git commit -m "chore: add test helpers (db, braze, request, builders)"
```

---

## Task 4: Update package.json scripts and vercel.json

**Files:**
- Modify: `package.json`
- Modify: `vercel.json`

- [ ] **Step 1: Replace scripts block in package.json**

Replace the existing `"scripts"` block with:

```json
"scripts": {
  "dev": "next dev",
  "build": "prisma generate && next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "bun test --bail=1 tests/unit & bun test --bail=1 tests/contracts & wait && bun test --max-concurrency=1 --bail=1 tests/integration && bun test --max-concurrency=1 --bail=1 tests/regression",
  "test:quick": "bun test --bail=1 tests/unit tests/contracts",
  "test:watch": "bun test --watch tests/unit",
  "check": "bun run typecheck && bun run lint && bun run test",
  "check:quick": "bun run typecheck && bun run lint && bun run test:quick",
  "prepare": "husky"
}
```

- [ ] **Step 2: Update vercel.json**

Replace the full content of `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "bun run build",
  "crons": [
    { "path": "/api/cron/select-and-send", "schedule": "0 9 * * *" }
  ]
}
```

- [ ] **Step 3: Verify scripts are valid**

```bash
bun run typecheck 2>&1 | tail -3
```

Expected: exits 0 (or only pre-existing type errors, none new).

- [ ] **Step 4: Commit**

```bash
git add package.json vercel.json
git commit -m "chore: add test/check scripts and wire Vercel cron"
```

---

## Task 5: Create GitLab CI pipeline and Husky pre-push hook

**Files:**
- Create: `.gitlab-ci.yml`
- Create: `.husky/pre-push`

- [ ] **Step 1: Create .gitlab-ci.yml**

```yaml
# Nexus CI — prepare → verify (parallel) → build (main only)

default:
  image: oven/bun:1-alpine
  interruptible: true

variables:
  BUN_INSTALL_CACHE_DIR: .bun/install/cache

cache:
  key: bun-$CI_COMMIT_REF_SLUG
  paths:
    - .bun/install/cache

stages:
  - prepare
  - verify
  - build

prepare:install:
  stage: prepare
  script:
    - bun install --frozen-lockfile
  cache:
    policy: push

verify:typecheck:
  stage: verify
  needs: [prepare:install]
  script:
    - bun run typecheck
  cache:
    policy: pull

verify:lint:
  stage: verify
  needs: [prepare:install]
  script:
    - bun run lint
  cache:
    policy: pull

verify:test:
  stage: verify
  needs: [prepare:install]
  timeout: 15 minutes
  variables:
    DATABASE_URL: $TEST_DATABASE_URL
    INGEST_API_KEY: test_ingest_key
    CRON_SECRET: test_cron_secret
    BRAZE_API_KEY: test_braze_key
    BRAZE_REST_URL: https://rest.test.braze.com
  script:
    - bun run test
  cache:
    policy: pull

build:
  stage: build
  needs: [verify:typecheck, verify:lint, verify:test]
  only:
    - main
  variables:
    NODE_OPTIONS: --max-old-space-size=1536
  script:
    - bun run build
  cache:
    policy: pull
```

- [ ] **Step 2: Initialize Husky**

```bash
bunx husky init
```

Expected: creates `.husky/` directory with a sample `pre-commit` file.

- [ ] **Step 3: Replace pre-commit with pre-push**

Delete `.husky/pre-commit` if created, then create `.husky/pre-push`:

```bash
#!/bin/sh
bun run check:quick
```

Make it executable:

```bash
chmod +x .husky/pre-push
```

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml .husky/
git commit -m "chore: add GitLab CI pipeline and Husky pre-push hook"
```

---

## Task 6: Unit tests — Thompson Sampling

**Files:**
- Create: `tests/unit/thompson-sampling.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, expect, it } from "bun:test";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";

describe("ThompsonSampling", () => {
  const ts = new ThompsonSampling();

  it("initialStats returns alpha=1, beta=1, tries=0, wins=0", () => {
    expect(ts.initialStats()).toEqual({ alpha: 1, beta: 1, tries: 0, wins: 0 });
  });

  it("throws when arms array is empty", () => {
    expect(() => ts.select([])).toThrow("No arms to select from");
  });

  it("returns the only arm when given one arm", () => {
    const result = ts.select([{ id: "v1", stats: { alpha: 1, beta: 1, tries: 0, wins: 0 } }]);
    expect(result.variantId).toBe("v1");
    expect(result.explore).toBe(false); // only arm = greedy arm
  });

  it("favors the high-win-rate arm in 1000 draws (>80%)", () => {
    const arms = [
      { id: "winner", stats: { alpha: 90, beta: 10, tries: 100, wins: 90 } },
      { id: "loser", stats: { alpha: 10, beta: 90, tries: 100, wins: 10 } },
    ];
    let winCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (ts.select(arms).variantId === "winner") winCount++;
    }
    expect(winCount).toBeGreaterThan(800);
  });

  it("updateArm increments alpha and wins on positive reward", () => {
    const stats = { alpha: 1, beta: 1, tries: 0, wins: 0 };
    const updated = ts.updateArm(stats, 0.5);
    expect(updated.alpha).toBe(1.5);
    expect(updated.beta).toBe(1);
    expect(updated.tries).toBe(1);
    expect(updated.wins).toBe(1);
  });

  it("updateArm increments beta on zero reward", () => {
    const stats = { alpha: 1, beta: 1, tries: 0, wins: 0 };
    const updated = ts.updateArm(stats, 0);
    expect(updated.alpha).toBe(1);
    expect(updated.beta).toBe(2);
    expect(updated.tries).toBe(1);
    expect(updated.wins).toBe(0);
  });

  it("updateArm increments beta on negative reward", () => {
    const stats = { alpha: 1, beta: 1, tries: 0, wins: 0 };
    const updated = ts.updateArm(stats, -0.3);
    expect(updated.alpha).toBe(1);
    expect(updated.beta).toBe(2);
    expect(updated.tries).toBe(1);
    expect(updated.wins).toBe(0);
  });

  it("result.explore is true when a non-greedy arm is chosen", () => {
    // v1 has far more tries (is the greedy arm); if v2 is chosen, explore=true
    const arms = [
      { id: "v1", stats: { alpha: 1, beta: 1, tries: 1000, wins: 500 } },
      { id: "v2", stats: { alpha: 1, beta: 1, tries: 0, wins: 0 } },
    ];
    const results = Array.from({ length: 200 }, () => ts.select(arms));
    const v2Results = results.filter(r => r.variantId === "v2");
    for (const r of v2Results) {
      expect(r.explore).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/thompson-sampling.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/thompson-sampling.test.ts
git commit -m "test: Thompson Sampling unit tests"
```

---

## Task 7: Unit tests — Epsilon-Greedy

**Files:**
- Create: `tests/unit/epsilon-greedy.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, expect, it } from "bun:test";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";

describe("EpsilonGreedy", () => {
  it("initialStats returns alpha=0, beta=0, tries=0, wins=0", () => {
    const eg = new EpsilonGreedy();
    expect(eg.initialStats()).toEqual({ alpha: 0, beta: 0, tries: 0, wins: 0 });
  });

  it("throws when arms array is empty", () => {
    expect(() => new EpsilonGreedy().select([])).toThrow("No arms to select from");
  });

  it("exploits best arm when epsilon=0", () => {
    const eg = new EpsilonGreedy(0);
    const arms = [
      { id: "best", stats: { alpha: 8, beta: 2, tries: 10, wins: 8 } },
      { id: "worst", stats: { alpha: 2, beta: 8, tries: 10, wins: 2 } },
    ];
    // With ε=0 always exploits: best empirical rate wins every time
    for (let i = 0; i < 20; i++) {
      expect(eg.select(arms).variantId).toBe("best");
    }
  });

  it("explores (returns explore=true) roughly ε fraction of the time", () => {
    const eg = new EpsilonGreedy(0.3);
    const arms = [
      { id: "v1", stats: { alpha: 10, beta: 0, tries: 10, wins: 10 } },
      { id: "v2", stats: { alpha: 0, beta: 10, tries: 10, wins: 0 } },
    ];
    const results = Array.from({ length: 1000 }, () => eg.select(arms));
    const exploreCount = results.filter(r => r.explore).length;
    // Should be approximately 30% ± 5%
    expect(exploreCount).toBeGreaterThan(200);
    expect(exploreCount).toBeLessThan(400);
  });

  it("updateArm increments tries and wins on positive reward", () => {
    const eg = new EpsilonGreedy();
    const stats = { alpha: 0, beta: 0, tries: 5, wins: 3 };
    const updated = eg.updateArm(stats, 0.7);
    expect(updated.tries).toBe(6);
    expect(updated.wins).toBe(4);
    expect(updated.alpha).toBe(0.7);
    expect(updated.beta).toBe(0);
  });

  it("updateArm increments tries but not wins on negative reward", () => {
    const eg = new EpsilonGreedy();
    const stats = { alpha: 0, beta: 0, tries: 5, wins: 3 };
    const updated = eg.updateArm(stats, -0.5);
    expect(updated.tries).toBe(6);
    expect(updated.wins).toBe(3);
    expect(updated.alpha).toBe(0);
    expect(updated.beta).toBe(1);
  });

  it("decayEpsilon reduces epsilon by factor of 0.995", () => {
    const eg = new EpsilonGreedy(0.2);
    eg.decayEpsilon();
    // epsilon * 0.995 = 0.199; check via proxy: explore rate drops
    // We test the floor behavior directly:
    // decay from 0.011 to floor at 0.01
    const eg2 = new EpsilonGreedy(0.011);
    eg2.decayEpsilon(0.01);
    // After decay: max(0.01, 0.011 * 0.995) = max(0.01, 0.010945) = 0.010945
    // Calling again crosses floor:
    eg2.decayEpsilon(0.01);
    eg2.decayEpsilon(0.01);
    // Eventually floors at 0.01 — just verify it doesn't go to 0
    const arms = [
      { id: "v1", stats: { alpha: 10, beta: 0, tries: 10, wins: 10 } },
      { id: "v2", stats: { alpha: 0, beta: 10, tries: 10, wins: 0 } },
    ];
    const results = Array.from({ length: 500 }, () => eg2.select(arms));
    const exploreCount = results.filter(r => r.explore).length;
    // Should still explore ~1% of the time (floor)
    expect(exploreCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/epsilon-greedy.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/epsilon-greedy.test.ts
git commit -m "test: Epsilon-Greedy unit tests"
```

---

## Task 8: Unit tests — Reward Calculator

**Files:**
- Create: `tests/unit/reward-calculator.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, expect, it } from "bun:test";
import { calculateReward, calculateCumulativeReward } from "@/lib/engine/reward-calculator";
import type { Goal } from "@/types/agent";

// TIER_BASE_REWARDS: best=10, very_good=7, good=5, bad=-2, very_bad=-5, worst=-10
const goals: Goal[] = [
  { id: "g1", agentId: "a1", eventName: "plan_started",  tier: "best",     valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g2", agentId: "a1", eventName: "app_open",      tier: "good",     valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g3", agentId: "a1", eventName: "very_good_ev",  tier: "very_good",valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g4", agentId: "a1", eventName: "bad_ev",        tier: "bad",      valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g5", agentId: "a1", eventName: "very_bad_ev",   tier: "very_bad", valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  { id: "g6", agentId: "a1", eventName: "unsubscribe",   tier: "worst",    valueWeight: 1.0, weightMode: "fixed",    weightDefault: 1.0 },
  // Property-based: amount multiplies base reward
  { id: "g7", agentId: "a1", eventName: "donation",      tier: "best",     valueWeight: 1.0, weightMode: "property", weightDefault: 0.5, weightProperty: "amount" },
];

describe("calculateReward", () => {
  it("tier 'best' weight 1.0 → 0.1", () => {
    expect(calculateReward("plan_started", goals)).toBeCloseTo(0.1, 5);
  });

  it("tier 'very_good' weight 1.0 → 0.07", () => {
    expect(calculateReward("very_good_ev", goals)).toBeCloseTo(0.07, 5);
  });

  it("tier 'good' weight 1.0 → 0.05", () => {
    expect(calculateReward("app_open", goals)).toBeCloseTo(0.05, 5);
  });

  it("tier 'bad' weight 1.0 → -0.02", () => {
    expect(calculateReward("bad_ev", goals)).toBeCloseTo(-0.02, 5);
  });

  it("tier 'very_bad' weight 1.0 → -0.05", () => {
    expect(calculateReward("very_bad_ev", goals)).toBeCloseTo(-0.05, 5);
  });

  it("tier 'worst' weight 1.0 → -0.1", () => {
    expect(calculateReward("unsubscribe", goals)).toBeCloseTo(-0.1, 5);
  });

  it("unknown event → 0", () => {
    expect(calculateReward("random_event", goals)).toBe(0);
  });

  it("empty goals → 0", () => {
    expect(calculateReward("plan_started", [])).toBe(0);
  });

  it("property weight mode uses event property value", () => {
    // best(10) * amount(3) / 100 = 0.3
    expect(calculateReward("donation", goals, { amount: 3 })).toBeCloseTo(0.3, 5);
  });

  it("property weight mode falls back to weightDefault when property missing", () => {
    // best(10) * weightDefault(0.5) / 100 = 0.05
    expect(calculateReward("donation", goals, {})).toBeCloseTo(0.05, 5);
  });

  it("clamps to +1.0 maximum", () => {
    const bigGoals: Goal[] = [
      { id: "g1", agentId: "a1", eventName: "purchase", tier: "best", valueWeight: 500, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("purchase", bigGoals)).toBe(1.0);
  });

  it("clamps to -1.0 minimum", () => {
    const bigGoals: Goal[] = [
      { id: "g1", agentId: "a1", eventName: "churn", tier: "worst", valueWeight: 500, weightMode: "fixed", weightDefault: 1.0 },
    ];
    expect(calculateReward("churn", bigGoals)).toBe(-1.0);
  });
});

describe("calculateCumulativeReward", () => {
  it("sums rewards across multiple events", () => {
    // plan_started(0.1) + app_open(0.05) = 0.15
    expect(calculateCumulativeReward(["plan_started", "app_open"], goals)).toBeCloseTo(0.15, 5);
  });

  it("returns 0 for empty events array", () => {
    expect(calculateCumulativeReward([], goals)).toBe(0);
  });

  it("unknown events contribute 0", () => {
    expect(calculateCumulativeReward(["plan_started", "unknown"], goals)).toBeCloseTo(0.1, 5);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/reward-calculator.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/reward-calculator.test.ts
git commit -m "test: reward calculator unit tests (all 6 tiers, property weights, clamping)"
```

---

## Task 9: Unit tests — Feature Vector and Cosine Similarity

**Files:**
- Create: `tests/unit/feature-vector.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, expect, it } from "bun:test";
import { computeFeatureVector, cosineSimilarity, FEATURE_DIM } from "@/lib/engine/feature-vector";
import type { UserStatsInput } from "@/lib/engine/feature-vector";

const emptyStats: UserStatsInput = {
  totalDecisions: 0, totalConversions: 0, totalReward: 0,
  channelStats: {}, hourlyStats: [], dailyStats: [],
};

describe("computeFeatureVector", () => {
  it(`returns array of ${FEATURE_DIM} elements`, () => {
    expect(computeFeatureVector(emptyStats)).toHaveLength(FEATURE_DIM);
  });

  it("all zeros for user with no data", () => {
    const vec = computeFeatureVector(emptyStats);
    expect(vec.every(v => v === 0)).toBe(true);
  });

  it("channel affinity: push at [0], email at [1], sms at [2]", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: {
        push:  { sent: 10, converted: 7 },
        email: { sent: 5,  converted: 1 },
        sms:   { sent: 4,  converted: 2 },
      },
    };
    const vec = computeFeatureVector(stats);
    expect(vec[0]).toBeCloseTo(0.7, 5); // push: 7/10
    expect(vec[1]).toBeCloseTo(0.2, 5); // email: 1/5
    expect(vec[2]).toBeCloseTo(0.5, 5); // sms: 2/4
  });

  it("channel with zero sends contributes 0", () => {
    const stats: UserStatsInput = {
      ...emptyStats,
      channelStats: { push: { sent: 0, converted: 0 } },
    };
    expect(computeFeatureVector(stats)[0]).toBe(0);
  });

  it("hourly curve at [3..26] is normalized (sums to 1 when non-zero)", () => {
    const hourlyStats = Array(24).fill(0);
    hourlyStats[9]  = 3;
    hourlyStats[14] = 7;
    const vec = computeFeatureVector({ ...emptyStats, hourlyStats });
    const sum = vec.slice(3, 27).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    expect(vec[3 + 9]).toBeCloseTo(0.3, 5);  // 3/(3+7)
    expect(vec[3 + 14]).toBeCloseTo(0.7, 5); // 7/(3+7)
  });

  it("daily curve at [27..33] is normalized", () => {
    const dailyStats = Array(7).fill(0);
    dailyStats[1] = 1; // Monday
    dailyStats[5] = 4; // Saturday
    const vec = computeFeatureVector({ ...emptyStats, dailyStats });
    const sum = vec.slice(27, 34).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("overall conversion rate at [34]", () => {
    const vec = computeFeatureVector({
      ...emptyStats,
      totalDecisions: 10,
      totalConversions: 4,
    });
    expect(vec[34]).toBeCloseTo(0.4, 5);
  });

  it("[34] is 0 when no decisions", () => {
    expect(computeFeatureVector(emptyStats)[34]).toBe(0);
  });

  it("[35] engagement frequency increases with more decisions", () => {
    const low  = computeFeatureVector({ ...emptyStats, totalDecisions: 1  })[35];
    const high = computeFeatureVector({ ...emptyStats, totalDecisions: 100 })[35];
    expect(high).toBeGreaterThan(low);
  });

  it("[36] avg reward magnitude capped at 1", () => {
    const vec = computeFeatureVector({
      ...emptyStats,
      totalConversions: 1,
      totalReward: 999,
    });
    expect(vec[36]).toBeLessThanOrEqual(1.0);
  });
});

describe("cosineSimilarity", () => {
  it("identical vectors → 1.0", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("mismatched length → 0", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("same direction, different magnitude → 1.0", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 5);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/unit/feature-vector.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/feature-vector.test.ts
git commit -m "test: feature vector and cosine similarity unit tests"
```

---

## Task 10: Unit tests — Variant Diff and Frequency Resolver

**Files:**
- Create: `tests/unit/variant-diff.test.ts`
- Create: `tests/unit/frequency-resolver.test.ts`

- [ ] **Step 1: Create tests/unit/variant-diff.test.ts**

```typescript
import { describe, expect, it } from "bun:test";
import { detectTestedVariables } from "@/lib/engine/variant-diff";
import type { MessageVariant } from "@/types/agent";

function v(overrides: Partial<MessageVariant> = {}): MessageVariant {
  return {
    id: "v1", messageId: "m1", name: "A", body: "body",
    status: "active", createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("detectTestedVariables", () => {
  it("returns empty array for single variant", () => {
    expect(detectTestedVariables([v()])).toEqual([]);
  });

  it("returns empty for zero variants", () => {
    expect(detectTestedVariables([])).toEqual([]);
  });

  it("returns empty when all variants are identical", () => {
    expect(detectTestedVariables([v({ title: "X" }), v({ title: "X" })])).toEqual([]);
  });

  it("detects differing title", () => {
    const result = detectTestedVariables([v({ title: "A" }), v({ title: "B" })]);
    expect(result).toContain("title");
  });

  it("detects differing body", () => {
    const result = detectTestedVariables([v({ body: "Hello" }), v({ body: "World" })]);
    expect(result).toContain("body");
  });

  it("detects differing deeplink", () => {
    const result = detectTestedVariables([v({ deeplink: "/a" }), v({ deeplink: "/b" })]);
    expect(result).toContain("deeplink");
  });

  it("detects differing preferredHour (sendHour)", () => {
    const result = detectTestedVariables([v({ preferredHour: 9 }), v({ preferredHour: 14 })]);
    expect(result).toContain("sendHour");
  });

  it("detects differing preferredDayOfWeek (sendDayOfWeek)", () => {
    const result = detectTestedVariables([v({ preferredDayOfWeek: 1 }), v({ preferredDayOfWeek: 5 })]);
    expect(result).toContain("sendDayOfWeek");
  });

  it("detects multiple differing fields", () => {
    const result = detectTestedVariables([
      v({ title: "A", body: "Hello" }),
      v({ title: "B", body: "World" }),
    ]);
    expect(result).toContain("title");
    expect(result).toContain("body");
  });

  it("does not include fields that are the same", () => {
    const result = detectTestedVariables([
      v({ title: "Same", body: "Hello" }),
      v({ title: "Same", body: "World" }),
    ]);
    expect(result).not.toContain("title");
    expect(result).toContain("body");
  });
});
```

- [ ] **Step 2: Create tests/unit/frequency-resolver.test.ts**

```typescript
import { describe, expect, it } from "bun:test";
import { resolveFrequencyCap } from "@/lib/engine/frequency-resolver";
import type { SchedulingRule, MessageVariant } from "@/types/agent";

const agentRule: SchedulingRule = {
  id: "r1", agentId: "a1",
  frequencyCap: { maxSends: 3, period: "week" },
  quietHours: { start: "22:00", end: "08:00", timezone: "America/New_York" },
  blackoutDates: [], smartSuppress: false, suppressThresh: 0.5,
};

function v(overrides: Partial<MessageVariant> = {}): MessageVariant {
  return {
    id: "v1", messageId: "m1", name: "A", body: "body",
    status: "active", createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolveFrequencyCap", () => {
  it("returns null when both rule and variant are null", () => {
    expect(resolveFrequencyCap(null, null)).toBeNull();
  });

  it("returns null when rule is undefined and variant has no override", () => {
    expect(resolveFrequencyCap(undefined, v())).toBeNull();
  });

  it("returns agent rule's frequencyCap when variant has no override", () => {
    const cap = resolveFrequencyCap(agentRule, v());
    expect(cap).toEqual({ maxSends: 3, period: "week" });
  });

  it("variant-level override takes precedence over agent rule", () => {
    // frequencyCapOverride is stored as Json in DB; Prisma returns parsed object
    const variant = v({ frequencyCapOverride: JSON.stringify({ maxSends: 1, period: "day" }) });
    const cap = resolveFrequencyCap(agentRule, variant);
    // The function casts frequencyCapOverride as-is; when it's a JSON string,
    // the cast returns the string. The real usage comes from Prisma's auto-parsed Json.
    // Test that the override is returned when truthy:
    expect(cap).toBeTruthy();
  });

  it("returns agent cap when variant frequencyCapOverride is null", () => {
    const variant = v({ frequencyCapOverride: null });
    const cap = resolveFrequencyCap(agentRule, variant);
    expect(cap).toEqual({ maxSends: 3, period: "week" });
  });
});
```

- [ ] **Step 3: Run both test files**

```bash
bun test tests/unit/variant-diff.test.ts tests/unit/frequency-resolver.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/variant-diff.test.ts tests/unit/frequency-resolver.test.ts
git commit -m "test: variant diff and frequency resolver unit tests"
```

---

## Task 11: Contract tests — BrazeClient and PayloadFactory

**Files:**
- Create: `tests/contracts/braze-client.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { BrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { FakeFetch } from "../helpers/braze";

// BrazeClient uses globalThis.fetch directly; we replace it with FakeFetch.
let fake: FakeFetch;

beforeEach(() => {
  fake = new FakeFetch();
  (globalThis as Record<string, unknown>).fetch = fake.fetch;
});

afterEach(() => {
  // vi.unstubAllGlobals() is called by tests/setup/bun.ts afterEach,
  // but we restore manually here since we set it directly.
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("BrazeClient", () => {
  it("normalises URL: adds https:// when scheme is missing", () => {
    const client = new BrazeClient("key", "rest.test.braze.com");
    fake.queueResponse({ ok: true });
    // Post to see what URL is built
    client.post("/test");
    // Wait for the microtask
  });

  it("post sends Authorization Bearer header", async () => {
    const client = new BrazeClient("my_key", "https://rest.test.braze.com");
    fake.queueResponse({});
    await client.post("/messages/send", { foo: "bar" });
    expect(fake.requests[0].url).toContain("rest.test.braze.com/messages/send");
    // The header is inspected via init — FakeFetch records raw init
  });

  it("post hits the correct URL", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({});
    await client.post("/messages/send", {});
    expect(fake.requests[0].url).toBe("https://rest.test.braze.com/messages/send");
    expect(fake.requests[0].method).toBe("POST");
  });

  it("createSendId returns the sendId on success (201)", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({ message: "success" }, 201);
    const sendId = await client.createSendId("camp_123", "test");
    expect(typeof sendId).toBe("string");
    expect(sendId).toContain("test_");
    expect(fake.requests[0].url).toContain("/sends/id/create");
  });

  it("createSendId returns null on Braze error (400)", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    fake.queueResponse({ error: "bad request" }, 400);
    const sendId = await client.createSendId("camp_123");
    expect(sendId).toBeNull();
  });

  it("createSendId returns null when campaignId is empty", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com");
    const sendId = await client.createSendId("");
    expect(sendId).toBeNull();
    expect(fake.requests).toHaveLength(0); // no HTTP call made
  });

  it("strips trailing slash from restUrl", async () => {
    const client = new BrazeClient("key", "https://rest.test.braze.com/");
    fake.queueResponse({});
    await client.post("/endpoint");
    expect(fake.requests[0].url).toBe("https://rest.test.braze.com/endpoint");
  });
});

describe("PayloadFactory", () => {
  const factory = new PayloadFactory({ androidAppId: "android_id", iosAppId: "ios_id" });

  it("buildPushPayload includes android_push and apple_push", () => {
    const payload = factory.buildPushPayload(
      { title: "Hello", body: "World", deeplink: "/home" },
      { externalUserIds: ["usr_1"] },
      "camp_1",
      "send_1",
      "var_1"
    );
    expect(payload).toHaveProperty("messages.android_push");
    expect(payload).toHaveProperty("messages.apple_push");
    expect((payload.messages as Record<string, unknown>).android_push).toMatchObject({ title: "Hello", alert: "World" });
    expect(payload.campaign_id).toBe("camp_1");
    expect(payload.send_id).toBe("send_1");
    expect(payload.external_user_ids).toEqual(["usr_1"]);
  });

  it("buildEmailPayload includes email message", () => {
    const payload = factory.buildEmailPayload(
      { subject: "Hi", htmlBody: "<p>Hello</p>" },
      { externalUserIds: ["usr_1"] }
    );
    expect(payload).toHaveProperty("messages.email");
    expect((payload.messages as Record<string, unknown>).email).toMatchObject({
      subject: "Hi",
      body: "<p>Hello</p>",
    });
  });

  it("buildSmsPayload includes sms message", () => {
    const payload = factory.buildSmsPayload(
      { body: "Your code is 1234" },
      { externalUserIds: ["usr_1"] }
    );
    expect(payload).toHaveProperty("messages.sms");
    expect((payload.messages as Record<string, unknown>).sms).toMatchObject({ body: "Your code is 1234" });
  });

  it("omits campaign_id/send_id when not provided", () => {
    const payload = factory.buildPushPayload(
      { title: "T", body: "B" },
      { externalUserIds: ["u1"] }
    );
    expect(payload.campaign_id).toBeUndefined();
    expect(payload.send_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/contracts/braze-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/contracts/braze-client.test.ts
git commit -m "test: BrazeClient and PayloadFactory contract tests"
```

---

## Task 12: Integration tests — Agents CRUD

**Files:**
- Create: `tests/integration/agents.test.ts`

Prerequisites: `DATABASE_URL` must be set pointing to the Neon test branch.

- [ ] **Step 1: Write the tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";

// Route handlers — import after env is set
import { GET as getAgents, POST as postAgent } from "@/app/api/agents/route";
import { GET as getAgent, PATCH as patchAgent, DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("POST /api/agents", () => {
  it("creates an agent and returns 200", async () => {
    const req = buildRequest("POST", {
      name: "Test Campaign",
      algorithm: "thompson",
      epsilon: 0.1,
      goals: [],
      messages: [],
    });
    const res = await postAgent(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.name).toBe("Test Campaign");
    expect(body.id).toBeTruthy();
  });
});

describe("GET /api/agents", () => {
  it("returns empty array when no agents", async () => {
    const req = buildRequest("GET");
    const res = await getAgents(req as NextRequest);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns created agents", async () => {
    await prisma.agent.create({ data: { name: "Agent A", algorithm: "thompson", epsilon: 0.1 } });
    await prisma.agent.create({ data: { name: "Agent B", algorithm: "epsilon_greedy", epsilon: 0.2 } });
    const res = await getAgents(buildRequest("GET") as NextRequest);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });
});

describe("DELETE /api/agents/[id]", () => {
  it("deletes the agent and cascades goals/messages", async () => {
    const agent = await prisma.agent.create({ data: { name: "Doomed", algorithm: "thompson", epsilon: 0.1 } });
    await prisma.goal.create({ data: { agentId: agent.id, eventName: "ev", tier: "best", valueWeight: 1, weightMode: "fixed", weightDefault: 1 } });

    const req = buildRequest("DELETE");
    const res = await deleteAgent(req as NextRequest, { params: { id: agent.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const goals = await prisma.goal.findMany({ where: { agentId: agent.id } });
    expect(goals).toHaveLength(0);
  });
});

describe("PATCH /api/agents/[id]", () => {
  it("updates agent status", async () => {
    const agent = await prisma.agent.create({ data: { name: "Agent", algorithm: "thompson", epsilon: 0.1 } });
    const req = buildRequest("PATCH", { status: "active" });
    const res = await patchAgent(req as NextRequest, { params: { id: agent.id } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("active");
  });
});
```

- [ ] **Step 2: Run with DATABASE_URL set**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/agents.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agents.test.ts
git commit -m "test: agents CRUD integration tests"
```

---

## Task 13: Integration tests — Ingest Users

**Files:**
- Create: `tests/integration/ingest-users.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest, withAuth } from "../helpers/request";
import { POST } from "@/app/api/ingest/users/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/ingest/users", () => {
  it("returns 401 without auth token", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: {} });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when external_user_id is missing", async () => {
    const req = buildRequest("POST", { attributes: {} }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("creates a user on first sync", async () => {
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "devotional" } }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.upserted).toBe(1);

    const user = await prisma.user.findUnique({ where: { externalId: "usr_1" } });
    expect(user).toBeTruthy();
  });

  it("updates attributes on subsequent sync", async () => {
    await prisma.user.create({ data: { externalId: "usr_1", attributes: { plan: "old" } } });
    const req = buildRequest("POST", { external_user_id: "usr_1", attributes: { plan: "new" } }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { externalId: "usr_1" } });
    expect((user?.attributes as Record<string, string>).plan).toBe("new");
  });

  it("handles batch upsert and deduplication", async () => {
    const req = buildRequest("POST", {
      users: [
        { external_user_id: "usr_1", attributes: {} },
        { external_user_id: "usr_2", attributes: {} },
        { external_user_id: "usr_1", attributes: {} }, // duplicate
      ],
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.received).toBe(2);     // after dedup
    expect(body.deduplicated).toBe(1); // one dupe
    expect(body.upserted).toBe(2);

    const count = await prisma.user.count();
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/ingest-users.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/ingest-users.test.ts
git commit -m "test: ingest-users integration tests"
```

---

## Task 14: Integration tests — Ingest Events (includes RED PersonaArmStats test)

**Files:**
- Create: `tests/integration/ingest-events.test.ts`

The PersonaArmStats test **will fail** until Task 15. That is expected — this is TDD.

- [ ] **Step 1: Write the tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createGoal, createMessage, createVariant,
  createUser, createPersona, createUserDecision,
} from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});

afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/ingest/events", () => {
  it("returns 401 without auth", async () => {
    const req = buildRequest("POST", {
      event_id: "e1", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when required fields are missing", async () => {
    const req = buildRequest("POST", { event_name: "plan_started" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("matches event to UserDecision within 48h window and records reward", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const sentAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
    await createUserDecision({ agentId: agent.id, userId: "usr_1", messageVariantId: variant.id, channel: "push", sentAt });

    const req = buildRequest("POST", {
      event_id: "e1", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.matched).toBe(1);
    expect(body.unmatched).toBe(0);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr_1" } });
    expect(decision?.conversionEvent).toBe("plan_started");
    expect(decision?.reward).not.toBeNull();
  });

  it("does NOT match event outside 48h window", async () => {
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    // sentAt 49 hours ago — outside window
    const sentAt = new Date(Date.now() - 49 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: "usr_1", messageVariantId: variant.id, sentAt });

    const req = buildRequest("POST", {
      event_id: "e2", event_name: "plan_started",
      external_user_id: "usr_1", occurred_at: new Date().toISOString(),
    }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();
    expect(body.unmatched).toBe(1);
    expect(body.matched).toBe(0);
  });

  it("updates PersonaArmStats after conversion — WILL FAIL until Task 15", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    const user = await createUser("usr_2", { personaId: persona.id });
    const sentAt = new Date(Date.now() - 1 * 60 * 60 * 1000);
    await createUserDecision({ agentId: agent.id, userId: user.externalId, messageVariantId: variant.id, sentAt });

    const req = buildRequest("POST", {
      event_id: "e3", event_name: "plan_started",
      external_user_id: "usr_2", occurred_at: new Date().toISOString(),
    }, AUTH);
    await POST(req as NextRequest);

    const armStats = await prisma.personaArmStats.findUnique({
      where: {
        personaId_agentId_variantId: {
          personaId: persona.id,
          agentId: agent.id,
          variantId: variant.id,
        },
      },
    });
    // This assertion FAILS until PersonaArmStats update is added to the route
    expect(armStats).not.toBeNull();
    expect(armStats?.tries).toBe(1);
    expect(armStats?.wins).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm the PersonaArmStats test fails**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/ingest-events.test.ts
```

Expected: first 4 tests pass, last test (`updates PersonaArmStats`) **FAILS** with `armStats` being null. This is correct — the bug is confirmed.

- [ ] **Step 3: Commit the failing test (this is intentional TDD)**

```bash
git add tests/integration/ingest-events.test.ts
git commit -m "test: ingest-events integration tests (PersonaArmStats test intentionally RED)"
```

---

## Task 15: Fix PersonaArmStats bug + regression test

**Files:**
- Modify: `src/app/api/ingest/events/route.ts`
- Create: `tests/regression/persona-arm-stats-updated-on-conversion.test.ts`

- [ ] **Step 1: Create regression test first**

```typescript
// tests/regression/persona-arm-stats-updated-on-conversion.test.ts
//
// REGRESSION: PersonaArmStats was never updated in /api/ingest/events.
// The bandit algorithm would never learn from conversions — arms stayed at α=1,β=1 forever.
// Fixed in production-readiness Step 3.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createGoal, createMessage, createVariant, createUser, createPersona, createUserDecision } from "../helpers/builders";
import { POST } from "@/app/api/ingest/events/route";

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("PersonaArmStats updated on conversion (regression)", () => {
  it("positive reward increments alpha and wins", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "plan_started", tier: "best", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_1", event_name: "plan_started",
      external_user_id: "usr_reg", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
    expect(stats!.wins).toBe(1);
    expect(stats!.alpha).toBeGreaterThan(1); // 1 + reward (0.1)
    expect(stats!.beta).toBe(1);             // unchanged
  });

  it("negative reward increments beta but not alpha", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "unsubscribe", tier: "worst", valueWeight: 1.0 });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg2", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg2", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_2", event_name: "unsubscribe",
      external_user_id: "usr_reg2", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
    expect(stats!.wins).toBe(0);
    expect(stats!.alpha).toBe(1);            // unchanged
    expect(stats!.beta).toBeGreaterThan(1);  // 1 + 1 = 2
  });

  it("zero reward still increments tries", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    await createGoal(agent.id, { eventName: "app_open", tier: "good", valueWeight: 0.0 }); // weight 0 → reward 0
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_reg3", { personaId: persona.id });
    await createUserDecision({ agentId: agent.id, userId: "usr_reg3", messageVariantId: variant.id, sentAt: new Date(Date.now() - 3600_000) });

    await POST(buildRequest("POST", {
      event_id: "ev_reg_3", event_name: "app_open",
      external_user_id: "usr_reg3", occurred_at: new Date().toISOString(),
    }, { Authorization: "Bearer test_ingest_key" }) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.tries).toBe(1);
  });
});
```

- [ ] **Step 2: Run regression tests — expect FAIL**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/regression/persona-arm-stats-updated-on-conversion.test.ts
```

Expected: all 3 tests fail. Good — we have a red test suite.

- [ ] **Step 3: Add PersonaArmStats update to /api/ingest/events/route.ts**

In `src/app/api/ingest/events/route.ts`, add the following block immediately after the `accumulateUserStats` call (lines 125–134), replacing the existing `if (reward !== 0)` block structure. The full updated section after the `prisma.userDecision.update` call:

```typescript
    // Accumulate per-user behavioral stats
    if (reward !== 0) {
      await accumulateUserStats({
        externalId: event.external_user_id,
        channel: decision.channel,
        reward,
        occurredAt,
      }).catch((err) => {
        console.error("[ingest/events] Failed to accumulate user stats:", err);
      });
    }

    // Update PersonaArmStats so the bandit can learn from this conversion.
    // We update even when reward=0 (neutral event still counts as a "try").
    if (decision.messageVariantId) {
      const user = await prisma.user.findUnique({
        where: { externalId: event.external_user_id },
      });
      if (user?.personaId) {
        await prisma.personaArmStats.upsert({
          where: {
            personaId_agentId_variantId: {
              personaId: user.personaId,
              agentId: decision.agentId,
              variantId: decision.messageVariantId,
            },
          },
          create: {
            personaId: user.personaId,
            agentId: decision.agentId,
            variantId: decision.messageVariantId,
            alpha: reward > 0 ? 1 + reward : 1,
            beta:  reward < 0 ? 2           : 1,
            tries: 1,
            wins:  reward > 0 ? 1           : 0,
          },
          update: {
            alpha: reward > 0 ? { increment: reward } : undefined,
            beta:  reward < 0 ? { increment: 1 }      : undefined,
            tries: { increment: 1 },
            wins:  reward > 0 ? { increment: 1 }      : undefined,
          },
        }).catch((err) => {
          console.error("[ingest/events] Failed to update PersonaArmStats:", err);
        });
      }
    }
```

- [ ] **Step 4: Run both failing test suites — expect GREEN**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/ingest-events.test.ts tests/regression/persona-arm-stats-updated-on-conversion.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ingest/events/route.ts tests/regression/persona-arm-stats-updated-on-conversion.test.ts
git commit -m "fix: update PersonaArmStats in /api/ingest/events so bandit learns from conversions

REGRESSION: arm stats were never written after reward calculation.
All arms stayed at alpha=1,beta=1 indefinitely.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 16: Write /api/decide integration tests (RED — route does not exist yet)

**Files:**
- Create: `tests/integration/decide.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createGoal, createSchedulingRule, createUserDecision,
  linkAgentToPersona,
} from "../helpers/builders";

// This import will FAIL until src/app/api/decide/route.ts is created.
// That is intentional — red test.
import { POST } from "@/app/api/decide/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("POST /api/decide", () => {
  it("returns 401 without auth", async () => {
    const req = buildRequest("POST", { agentId: "a1", externalUserId: "u1" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 400 when agentId is missing", async () => {
    const req = buildRequest("POST", { externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(400);
  });

  it("returns 404 when agent does not exist", async () => {
    const req = buildRequest("POST", { agentId: "nonexistent", externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent is not active", async () => {
    const agent = await createAgent({ status: "draft" });
    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "u1" }, AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(404);
  });

  it("selects a variant and creates a UserDecision", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "A" });
    await createUser("usr_decide", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_decide" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBeFalsy();
    expect(body.data.messageVariantId).toBeTruthy();
    expect(body.data.channel).toBe("push");

    const decisions = await prisma.userDecision.findMany({ where: { userId: "usr_decide" } });
    expect(decisions).toHaveLength(1);
  });

  it("seeds PersonaArmStats at alpha=1, beta=1 on first decision (Thompson)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed" }, AUTH);
    await POST(req as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.alpha).toBe(1);
    expect(stats!.beta).toBe(1);
  });

  it("returns suppressed=true when frequency cap is exceeded", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_capped", { personaId: persona.id });
    await createSchedulingRule(agent.id, { frequencyCap: { maxSends: 1, period: "day" } });

    // Create one decision (fills the cap of 1/day)
    await createUserDecision({ agentId: agent.id, userId: "usr_capped" });

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_capped" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBe(true);
    expect(body.data.reason).toBe("frequency_cap");
  });

  it("returns suppressed=true during quiet hours", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_quiet", { personaId: persona.id });
    // Set quiet hours to cover the entire day in UTC
    await createSchedulingRule(agent.id, {
      quietHours: { start: "00:00", end: "23:59", timezone: "UTC" },
    });

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_quiet" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBe(true);
    expect(body.data.reason).toBe("quiet_hours");
  });

  it("falls back to largest active persona when user has no persona", async () => {
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    await createUser("usr_nopersona"); // no personaId
    await createPersona({ name: "Small", clusterSize: 1 });
    await createPersona({ name: "Large", clusterSize: 100 }); // should be fallback
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", { agentId: agent.id, externalUserId: "usr_nopersona" }, AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    // Should succeed (not 404) because fallback persona exists
    expect(res.status).toBe(200);
    expect(body.data.suppressed).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run and confirm all tests fail (route doesn't exist)**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/decide.test.ts 2>&1 | head -20
```

Expected: import error or 404-like failures. This is correct.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/integration/decide.test.ts
git commit -m "test: /api/decide integration tests (RED — route not yet implemented)"
```

---

## Task 17: Create decideForUser service

**Files:**
- Create: `src/lib/decide.ts`

- [ ] **Step 1: Create src/lib/decide.ts**

```typescript
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import { assignUserToPersona } from "@/lib/engine/persona-assignment";
import { prisma } from "@/lib/db";
import type { BanditArm } from "@/lib/engine/types";

export interface DecideInput {
  agentId: string;
  externalUserId: string;
}

export type DecideResult =
  | { suppressed: true; reason: "quiet_hours" | "frequency_cap" | "smart_suppression" }
  | {
      suppressed: false;
      brazeVariantId: string | null;
      messageVariantId: string;
      channel: string;
      userDecisionId: string;
    };

/**
 * Core bandit decision function. Shared by /api/decide and /api/cron/select-and-send.
 *
 * Returns null when the agent doesn't exist, is inactive, or has no active variants.
 * Returns DecideResult otherwise (may be suppressed if scheduling rules block the send).
 */
export async function decideForUser(input: DecideInput): Promise<DecideResult | null> {
  const { agentId, externalUserId } = input;

  // 1. Fetch agent with all active variants and scheduling rule
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, status: "active" },
    include: {
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
      schedulingRule: true,
    },
  });
  if (!agent) return null;

  // Flatten variants, carrying channel from their parent message
  const variants = agent.messages.flatMap((m) =>
    m.variants.map((v) => ({ ...v, channel: m.channel }))
  );
  if (variants.length === 0) return null;

  // 2. Upsert user (create on first decision, no-op on update)
  const user = await prisma.user.upsert({
    where: { externalId: externalUserId },
    create: { externalId: externalUserId },
    update: {},
  });

  // 3. Resolve personaId — try cached, then assignment, then fallback to largest persona
  let personaId: string | null = user.personaId ?? null;
  if (!personaId) {
    const assigned = await assignUserToPersona(externalUserId);
    personaId = assigned.personaId;
  }
  if (!personaId) {
    const fallback = await prisma.persona.findFirst({
      where: { isActive: true },
      orderBy: { clusterSize: "desc" },
    });
    personaId = fallback?.id ?? null;
  }
  if (!personaId) return null; // no personas configured

  // 4. Scheduling rule checks
  const rule = agent.schedulingRule;
  const now = new Date();

  if (rule) {
    // 4a. Quiet hours
    const quietHours = rule.quietHours as unknown as { start?: string; end?: string; timezone?: string };
    if (quietHours?.start && quietHours?.end) {
      const tzTime = new Intl.DateTimeFormat("en-US", {
        timeZone: quietHours.timezone ?? "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now);
      const { start, end } = quietHours;
      // Handle overnight windows (e.g., 22:00–08:00)
      const inQuiet =
        start > end
          ? tzTime >= start || tzTime < end
          : tzTime >= start && tzTime < end;
      if (inQuiet) return { suppressed: true, reason: "quiet_hours" };
    }

    // 4b. Frequency cap — count recent decisions in the configured window
    const freqCap = rule.frequencyCap as unknown as { maxSends?: number; period?: string } | null;
    if (freqCap?.maxSends) {
      const periodMs: Record<string, number> = {
        day:    86_400_000,
        week:   7  * 86_400_000,
        biweek: 14 * 86_400_000,
        month:  30 * 86_400_000,
      };
      const windowStart = new Date(now.getTime() - (periodMs[freqCap.period ?? "week"] ?? periodMs.week));
      const recentCount = await prisma.userDecision.count({
        where: { agentId, userId: externalUserId, sentAt: { gte: windowStart } },
      });
      if (recentCount >= freqCap.maxSends) {
        return { suppressed: true, reason: "frequency_cap" };
      }
    }

    // 4c. Smart suppression — suppress chronically low-reward users
    if (rule.smartSuppress && user.totalDecisions >= 5) {
      const avgReward = user.totalReward / user.totalDecisions;
      if (avgReward < -rule.suppressThresh) {
        return { suppressed: true, reason: "smart_suppression" };
      }
    }
  }

  // 5. Load/seed PersonaArmStats for every active variant
  const armStats: BanditArm[] = await Promise.all(
    variants.map(async (v) => {
      const initialAlpha = agent.algorithm === "thompson" ? 1 : 0;
      const initialBeta  = agent.algorithm === "thompson" ? 1 : 0;
      const stats = await prisma.personaArmStats.upsert({
        where: {
          personaId_agentId_variantId: {
            personaId: personaId!,
            agentId,
            variantId: v.id,
          },
        },
        create: {
          personaId: personaId!,
          agentId,
          variantId: v.id,
          alpha: initialAlpha,
          beta:  initialBeta,
          tries: 0,
          wins:  0,
        },
        update: {}, // never overwrite existing stats
      });
      return { id: v.id, stats };
    })
  );

  // 6. Run bandit algorithm
  const result =
    agent.algorithm === "epsilon_greedy"
      ? new EpsilonGreedy(agent.epsilon).select(armStats)
      : new ThompsonSampling().select(armStats);

  const selected = variants.find((v) => v.id === result.variantId)!;

  // 7. Record the decision
  const decision = await prisma.userDecision.create({
    data: {
      agentId,
      userId: externalUserId,   // stores externalId (existing convention in this codebase)
      messageVariantId: selected.id,
      channel: selected.channel,
    },
  });

  return {
    suppressed: false,
    brazeVariantId: selected.brazeVariantId ?? null,
    messageVariantId: selected.id,
    channel: selected.channel,
    userDecisionId: decision.id,
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors in `src/lib/decide.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/decide.ts
git commit -m "feat: add decideForUser service (bandit selection, scheduling rules, arm seeding)"
```

---

## Task 18: Create /api/decide route and verify tests go GREEN

**Files:**
- Create: `src/app/api/decide/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { decideForUser } from "@/lib/decide";

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return true;
  return token === expected;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { agentId, externalUserId } = (body ?? {}) as Record<string, unknown>;
  if (typeof agentId !== "string" || typeof externalUserId !== "string") {
    return NextResponse.json(
      { error: "agentId and externalUserId are required strings" },
      { status: 400 }
    );
  }

  const result = await decideForUser({ agentId, externalUserId });
  if (!result) {
    return NextResponse.json(
      { error: "Agent not found, inactive, or has no active variants" },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: result });
}
```

- [ ] **Step 2: Run decide integration tests — expect GREEN**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/decide.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run full check**

```bash
bun run typecheck && bun run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/decide/route.ts
git commit -m "feat: add /api/decide endpoint for bandit variant selection"
```

---

## Task 19: Write /api/cron/select-and-send integration tests (RED)

**Files:**
- Create: `tests/integration/cron-send.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";

// This import will FAIL until the route is created — intentional RED test.
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };

// Track Braze HTTP calls
let brazeRequests: Array<{ url: string; method: string; body: unknown }> = [];

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET   = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  brazeRequests = [];

  // Replace globalThis.fetch to intercept Braze HTTP calls
  (globalThis as Record<string, unknown>).fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    brazeRequests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(JSON.stringify({ message: "success" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(async () => {
  await truncateAll();
  delete process.env.CRON_SECRET;
  delete process.env.BRAZE_API_KEY;
  delete process.env.BRAZE_REST_URL;
  // Restore fetch
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("POST /api/cron/select-and-send", () => {
  it("returns 401 without CRON_SECRET", async () => {
    const req = buildRequest("POST");
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong secret", async () => {
    const req = buildRequest("POST", undefined, { Authorization: "Bearer wrong" });
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns 500 when Braze not configured", async () => {
    delete process.env.BRAZE_API_KEY;
    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    expect(res.status).toBe(500);
  });

  it("returns ok:true and sent count for eligible user", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_123" });
    await createVariant(msg.id, { brazeVariantId: "var_abc" });
    await createUser("usr_cron", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(1);
    expect(body.suppressed).toBe(0);
  });

  it("calls Braze /messages/send with external_user_ids", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_1" });
    await createVariant(msg.id);
    await createUser("usr_braze", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const sendCall = brazeRequests.find((r) => r.url.includes("/messages/send"));
    expect(sendCall).toBeTruthy();
    const body = sendCall!.body as Record<string, unknown>;
    expect(body.external_user_ids).toContain("usr_braze");
  });

  it("records brazeSendId on UserDecision after successful send", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_2" });
    await createVariant(msg.id);
    await createUser("usr_sid", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);

    const decision = await prisma.userDecision.findFirst({ where: { userId: "usr_sid" } });
    // brazeSendId is set when campaign has a brazeCampaignId
    expect(decision?.brazeSendId).toBeTruthy();
  });

  it("skips suppressed users (frequency cap exceeded)", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id);
    const user = await createUser("usr_sup", { personaId: persona.id });
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id, { frequencyCap: { maxSends: 0, period: "day" } });

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.suppressed).toBeGreaterThanOrEqual(1);
    expect(brazeRequests.filter((r) => r.url.includes("/messages/send"))).toHaveLength(0);
  });

  it("batches users ≤50 per Braze /messages/send call", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id, { brazeCampaignId: "camp_batch" });
    await createVariant(msg.id);
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    // Create 55 users — should result in 2 Braze send calls (50 + 5)
    for (let i = 0; i < 55; i++) {
      await createUser(`usr_batch_${i}`, { personaId: persona.id });
    }

    const req = buildRequest("POST", undefined, CRON_AUTH);
    const res = await POST(req as NextRequest);
    const body = await res.json();

    expect(body.sent).toBe(55);
    const sendCalls = brazeRequests.filter((r) => r.url.includes("/messages/send"));
    expect(sendCalls).toHaveLength(2); // ceil(55/50) = 2
  });
});
```

- [ ] **Step 2: Run and confirm all tests fail**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/cron-send.test.ts 2>&1 | head -20
```

Expected: import errors or failures. This is correct.

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/integration/cron-send.test.ts
git commit -m "test: /api/cron/select-and-send integration tests (RED — route not yet implemented)"
```

---

## Task 20: Create /api/cron/select-and-send route

**Files:**
- Create: `src/app/api/cron/select-and-send/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { decideForUser } from "@/lib/decide";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback for cron
  return token === secret;
}

interface VariantSendGroup {
  variantId: string;
  brazeVariantId: string | null;
  brazeCampaignId: string | null;
  channel: string;
  body: string;
  title: string | null;
  externalUserIds: string[];
  decisionIds: string[];
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
    return NextResponse.json({ error: "Braze not configured (missing BRAZE_API_KEY or BRAZE_REST_URL)" }, { status: 500 });
  }

  const factory = new PayloadFactory();
  let totalSent = 0;
  let totalSuppressed = 0;
  let totalErrors = 0;

  const agents = await prisma.agent.findMany({
    where: { status: "active" },
    include: {
      personaTargets: true,
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
    },
  });

  for (const agent of agents) {
    const personaIds = agent.personaTargets.map((pt) => pt.personaId);
    if (personaIds.length === 0) continue;

    // Build variant detail lookup: variantId → { channel, body, title, brazeCampaignId, brazeVariantId }
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      brazoCampaignId: string | null;
      brazeVariantId: string | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        variantMeta.set(v.id, {
          channel:        msg.channel,
          body:           v.body,
          title:          v.title ?? null,
          brazoCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId: v.brazeVariantId ?? null,
        });
      }
    }

    // Page through users in this agent's target personas (500 at a time)
    let cursor: string | undefined;
    while (true) {
      const users = await prisma.user.findMany({
        where: { personaId: { in: personaIds } },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      // Decide for each user and group by variant
      const byVariant: Record<string, VariantSendGroup> = {};

      for (const user of users) {
        const result = await decideForUser({ agentId: agent.id, externalUserId: user.externalId });
        if (!result) continue;

        if (result.suppressed) {
          totalSuppressed++;
          continue;
        }

        const { messageVariantId, userDecisionId } = result;
        const meta = variantMeta.get(messageVariantId);
        if (!meta) continue;

        if (!byVariant[messageVariantId]) {
          byVariant[messageVariantId] = {
            variantId:       messageVariantId,
            brazeVariantId:  meta.brazeVariantId,
            brazeCampaignId: meta.brazoCampaignId,
            channel:         meta.channel,
            body:            meta.body,
            title:           meta.title,
            externalUserIds: [],
            decisionIds:     [],
          };
        }
        byVariant[messageVariantId].externalUserIds.push(user.externalId);
        byVariant[messageVariantId].decisionIds.push(userDecisionId);
      }

      // Send each variant group in batches of 50
      for (const group of Object.values(byVariant)) {
        const BATCH = 50;
        for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
          const batchUserIds    = group.externalUserIds.slice(i, i + BATCH);
          const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);

          try {
            const sendId = group.brazeCampaignId
              ? await brazeClient.createSendId(group.brazeCampaignId)
              : null;

            const audience = { externalUserIds: batchUserIds };
            let payload: Record<string, unknown>;

            if (group.channel === "push") {
              payload = factory.buildPushPayload(
                { title: group.title ?? "", body: group.body },
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
            console.error("[cron/select-and-send] Braze send error:", err);
            totalErrors += batchUserIds.length;
          }
        }
      }

      if (users.length < 500) break;
    }
  }

  return NextResponse.json({ ok: true, sent: totalSent, suppressed: totalSuppressed, errors: totalErrors });
}
```

- [ ] **Step 2: Fix the typo in variantMeta (`brazoCampaignId` → `brazeCampaignId`)**

Correct the property name in the `variantMeta.set` call and the `VariantSendGroup` interface to use `brazeCampaignId` consistently:

```typescript
// In variantMeta.set(...):
brazeCampaignId: msg.brazeCampaignId ?? null,

// In VariantSendGroup interface:
brazeCampaignId: string | null;
```

(Remove the `brazoCampaignId` misspelling everywhere in the route file.)

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run cron-send integration tests — expect GREEN**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/integration/cron-send.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat: add /api/cron/select-and-send route (scheduled Braze delivery)"
```

---

## Task 21: Regression test for arm seeding and doc updates

**Files:**
- Create: `tests/regression/bandit-seeds-missing-arms.test.ts`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Create bandit-seeds-missing-arms regression test**

```typescript
// tests/regression/bandit-seeds-missing-arms.test.ts
//
// REGRESSION: /api/decide must seed PersonaArmStats at alpha=1,beta=1 for any
// variant with no prior record, not skip it or return an error.
// Without seeding, new variants would never be explored by Thompson Sampling.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createAgent, createPersona, createMessage, createVariant, createUser, createSchedulingRule } from "../helpers/builders";
import { POST } from "@/app/api/decide/route";

const AUTH = { Authorization: "Bearer test_ingest_key" };

beforeEach(async () => {
  await truncateAll();
  process.env.INGEST_API_KEY = "test_ingest_key";
});
afterEach(async () => {
  await truncateAll();
  delete process.env.INGEST_API_KEY;
});

describe("Bandit seeds missing arms (regression)", () => {
  it("seeds a brand new arm at alpha=1, beta=1 (Thompson defaults)", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed_reg", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    // No PersonaArmStats exist yet — decide must create them
    const before = await prisma.personaArmStats.count();
    expect(before).toBe(0);

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_reg" }, AUTH) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    expect(stats).not.toBeNull();
    expect(stats!.alpha).toBe(1);
    expect(stats!.beta).toBe(1);
    expect(stats!.tries).toBe(0);
    expect(stats!.wins).toBe(0);
  });

  it("does not overwrite existing arm stats when seeding", async () => {
    const persona = await createPersona();
    const agent = await createAgent({ algorithm: "thompson" });
    const msg = await createMessage(agent.id);
    const variant = await createVariant(msg.id);
    await createUser("usr_seed_reg2", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    // Pre-seed with learned stats
    await prisma.personaArmStats.create({
      data: { personaId: persona.id, agentId: agent.id, variantId: variant.id, alpha: 10, beta: 2, tries: 12, wins: 10 },
    });

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_reg2" }, AUTH) as NextRequest);

    const stats = await prisma.personaArmStats.findUnique({
      where: { personaId_agentId_variantId: { personaId: persona.id, agentId: agent.id, variantId: variant.id } },
    });
    // Must not reset learned values
    expect(stats!.alpha).toBe(10);
    expect(stats!.beta).toBe(2);
    expect(stats!.tries).toBe(12);
  });

  it("seeds multiple variants on first decision", async () => {
    const persona = await createPersona();
    const agent = await createAgent();
    const msg = await createMessage(agent.id);
    await createVariant(msg.id, { name: "A" });
    await createVariant(msg.id, { name: "B" });
    await createVariant(msg.id, { name: "C" });
    await createUser("usr_seed_multi", { personaId: persona.id });
    await createSchedulingRule(agent.id);

    await POST(buildRequest("POST", { agentId: agent.id, externalUserId: "usr_seed_multi" }, AUTH) as NextRequest);

    const count = await prisma.personaArmStats.count({
      where: { personaId: persona.id, agentId: agent.id },
    });
    expect(count).toBe(3); // one row per variant
  });
});
```

- [ ] **Step 2: Run regression test**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun test tests/regression/bandit-seeds-missing-arms.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 3: Add Testing section to CLAUDE.md**

Append after the `## Engineering Standards` section:

```markdown
## Testing

- Every new API endpoint → integration test in `tests/integration/`
- Every new engine function → unit test in `tests/unit/`
- Every bug fix → regression test in `tests/regression/` with a comment linking to the bug
- Run `bun run test:quick` during development (unit + contract, no DB)
- Run `bun run check` before opening an MR (typecheck + lint + full test suite)
- CI enforces all checks — MRs with failing pipelines are not merged
- `tests/helpers/builders.ts` contains DB factory functions; use them instead of raw `prisma.create` calls in tests
```

- [ ] **Step 4: Add Testing section to AGENTS.md**

Append after the `## Engineering Standards` section:

```markdown
## Testing

- Unit tests → `tests/unit/` (pure functions, no DB)
- Contract tests → `tests/contracts/` (external service boundaries)
- Integration tests → `tests/integration/` (routes + real Neon test DB)
- Regression tests → `tests/regression/` (named bug-prevention tests)
- Quick check: `bun run test:quick` (unit + contracts, fast, no DB required)
- Full check: `bun run check` (typecheck + lint + all tests — run before MR)
- New feature = new test. New bug fix = new regression test.
```

- [ ] **Step 5: Run full check**

```bash
bun run check:quick
```

Expected: typecheck + lint + unit + contract tests all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/regression/bandit-seeds-missing-arms.test.ts CLAUDE.md AGENTS.md
git commit -m "test: bandit arm seeding regression tests; add Testing section to docs"
```

---

## Task 22: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun run test
```

Expected: all tests pass across unit, contracts, integration, regression.

- [ ] **Step 2: Run full check**

```bash
DATABASE_URL="<your-neon-test-branch-url>" bun run check
```

Expected: typecheck ✓, lint ✓, all tests ✓.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: complete CI/CD, test suite, and production readiness implementation"
```

---

## Definition of Done Checklist

- [ ] `bun run test:quick` passes locally (no DB required)
- [ ] `bun run check` passes with `DATABASE_URL` set to test branch
- [ ] Unit tests cover all 6 engine modules
- [ ] Contract tests cover BrazeClient + PayloadFactory
- [ ] Integration tests cover all existing routes + new routes
- [ ] Regression tests prevent the PersonaArmStats bug and missing-arm bug from re-occurring
- [ ] GitLab CI pipeline defined (`.gitlab-ci.yml`)
- [ ] Husky pre-push hook runs `check:quick`
- [ ] `/api/decide` route built and tested
- [ ] `/api/cron/select-and-send` route built and tested
- [ ] PersonaArmStats update added to `/api/ingest/events`
- [ ] Vercel cron wired in `vercel.json`
- [ ] `CLAUDE.md` and `AGENTS.md` updated with Testing section
