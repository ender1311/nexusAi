# P0 Safety Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze today's Braze send behaviour in recorded-output (snapshot) tests before the pluggable refactor touches it, and fix the two engine bugs the audit found: LinUCB lost updates and the spiritual-depth feature reading keys that never arrive.

**Architecture:**
- **Recorded-output tests.** Three snapshot layers:
  1. the pure grouping step (`groupDecisionsByVariant`);
  2. the Braze HTTP layer (`sendVariantGroup`), using the existing `FakeFetch` and a recording Prisma stub;
  3. one full cron run, with seeded randomness and a frozen clock, against the local test DB.

  Snapshots use Bun's built-in `toMatchSnapshot()`, stored in `__snapshots__/` next to each test.
- **LinUCB fix.** Make `LinUCBArm` writes compare-and-swap on a new `version` column, and make every stale-arm reset bump the version.
- **Spiritual-depth fix.** Dim [8] reads the keys Hightouch actually sends (`*_current_year_count`), converted to a daily rate. The engine stays pure because the caller passes the date in.

**Tech Stack:** Bun test runner (`bun:test`), Prisma v7 + Postgres, Next.js route handlers, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-13-pluggable-martech-stack-design.md` (§2 bugs, §9 P0 row, §10 recorded-output tests).

## Global Constraints

- **Engine purity:** no DB calls, no `Date.now()`, no globals in `src/lib/engine/` (`src/lib/engine/CLAUDE.md`). Time comes in as a parameter.
- **Every bug fix gets a regression test** in `tests/regression/` with a header comment describing the bug (`CLAUDE.md` → Testing).
- **Never run `prisma migrate dev` or `db push` against the test DB.** `prisma.config.ts` loads `.env.local`, which is the production DB. Apply migration SQL to `nexus_test` with `psql` only.
- **Production migration order:** the `LinUCBArm.version` migration must be applied to production **before** the code that reads `version` is deployed, or Prisma queries on `LinUCBArm` fail. Applying it to production is Dan's call; this plan stops at a local commit.
- **Commit only the files each task names.** The working tree has an unrelated uncommitted change in `src/lib/engine/thompson-sampling.ts`, and many untracked `*.png` files. Never `git add -A` or `git add .`.
- **Checks:**
  - Fast loop: `bun run check:quick` (typecheck + lint + unit/contract).
  - Integration and regression tests need the local DB `nexus_test`, run with `TEST_DB=true`, which comes from `.env.test`.
  - Single integration file: `bun test --timeout 30000 tests/integration/<file>`.
- **Snapshots must be deterministic.** Freeze time with `setSystemTime` from `bun:test`, seed `Math.random`, and replace generated IDs (cuid/uuid) with stable placeholders before snapshotting.

## Review Focus

1. **Snapshot flakiness:** a generated cuid or uuid, or a `new Date()`, leaks into a snapshot and fails on the next run. Expected: tests are byte-stable across runs. Tasks 1–3 each run their test twice.
2. **Two first-time updates race on a brand-new arm.** Expected: both rewards end up in the arm. Today the init `upsert` resets the arm to identity and can erase a concurrent update. Task 4 includes a test that starts from a missing arm.
3. **A stale-dimension reset in the cron or `decide` runs while a reward update is in flight.** Expected: the reward write retries against the reset arm instead of overwriting it. Task 4 checks that the reset bumps `version`.
4. **Attribute values arrive as strings** (`"12"`), or the date is 1 January (day-of-year = 1). Expected: no NaN or Infinity, and the value stays in [0,1]. Task 5 tests both.
5. **Compare-and-swap retries run out under heavy contention.** Expected: a warning is logged, and the stored arm stays one consistent prior state, never a half-written one. Task 4 tests this with a stub that never matches.

---

### Task 1: Snapshot the pure grouping step

**Files:**
- Create: `tests/unit/characterization/send-grouping.snapshot.test.ts`
- Create (generated): `tests/unit/characterization/__snapshots__/send-grouping.snapshot.test.ts.snap`

**Interfaces:**
- Consumes: `groupDecisionsByVariant(inputs, variantMeta, decisionIdByUser, localization?, givingMultiplier?)` and `type VariantMeta` from `src/lib/cron/send-grouping.ts`; `GIVING_LINK_SENTINEL` from `src/lib/engine/giving-link.ts`.
- Produces: `normalizeGroups(groups)` (local to this file). It turns a `Record<string, VariantSendGroup>` into a JSON-safe, order-stable value: Sets become sorted arrays, Dates become ISO strings, and groups are sorted by key.

- [ ] **Step 1: Write the test.** It covers push, email, content-card, in-app and modal variants; a Braze-only user; a giving-sentinel deeplink; a local-time split; a localized user; and a user with no decision ID, who must be dropped.

```ts
// tests/unit/characterization/send-grouping.snapshot.test.ts
//
// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): freezes the current
// output of groupDecisionsByVariant across every channel before the pluggable
// refactor. A diff here means send behaviour changed. Update the snapshot
// (`bun test -u`) ONLY when the change is intended and reviewed.
import { describe, expect, it } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta, type VariantSendGroup } from "@/lib/cron/send-grouping";
import { GIVING_LINK_SENTINEL } from "@/lib/engine/giving-link";

function meta(overrides: Partial<VariantMeta> = {}): VariantMeta {
  return {
    channel: "push",
    body: "hello",
    title: "Title",
    deeplink: "app://home",
    brazeCampaignId: "camp-1",
    brazeVariantId: "var-1",
    givingHandleStrategy: null,
    iconImageUrl: null,
    cta: null,
    ...overrides,
  };
}

const user = (externalId: string, brazeId: string | null = null, attributes: unknown = {}) => ({
  externalId,
  brazeId,
  attributes,
});

function normalizeGroups(groups: Record<string, VariantSendGroup>): unknown {
  return Object.keys(groups)
    .sort()
    .map((key) => {
      const g = groups[key];
      return {
        key,
        ...g,
        scheduledAt: g.scheduledAt ? g.scheduledAt.toISOString() : null,
        externalUserIds: [...g.externalUserIds].sort(),
        decisionIds: [...g.decisionIds].sort(),
        brazeOnlyIds: [...g.brazeOnlyIds].sort(),
      };
    });
}

const AT = new Date("2026-05-30T12:00:00Z");
const LATER = new Date("2026-05-30T18:30:00Z");

describe("characterization: groupDecisionsByVariant", () => {
  it("groups every channel the same way it did before the refactor", () => {
    const variantMeta = new Map<string, VariantMeta>([
      ["v-push", meta()],
      ["v-email", meta({ channel: "email", title: "Subject", body: "<p>Hi</p>", brazeVariantId: "var-email" })],
      ["v-card", meta({ channel: "content-card", cta: "Read", brazeVariantId: "var-card" })],
      ["v-slideup", meta({ channel: "in-app", title: null, brazeVariantId: "var-slide" })],
      ["v-modal", meta({ channel: "modal-iam", cta: "Open", brazeVariantId: "var-modal" })],
      ["v-give", meta({ deeplink: GIVING_LINK_SENTINEL, brazeVariantId: "var-give" })],
    ]);
    const decisionIdByUser = new Map([
      ["u1", "d1"], ["u2", "d2"], ["braze-abc", "d3"], ["u4", "d4"],
      ["u5", "d5"], ["u6", "d6"], ["u7", "d7"], ["u8", "d8"],
      // u9 has no decision id → must be dropped
    ]);

    const groups = groupDecisionsByVariant(
      [
        { user: user("u1"), variantId: "v-push", scheduledAt: AT, inLocalTime: false },
        { user: user("u2"), variantId: "v-push", scheduledAt: AT, inLocalTime: true },
        { user: user("braze-abc", "braze-abc"), variantId: "v-push", scheduledAt: AT, inLocalTime: false },
        { user: user("u4", null, { language_tag: "es" }), variantId: "v-push", scheduledAt: LATER, inLocalTime: false },
        { user: user("u5"), variantId: "v-email", scheduledAt: AT, inLocalTime: false },
        { user: user("u6"), variantId: "v-card", scheduledAt: AT, inLocalTime: false },
        { user: user("u7"), variantId: "v-slideup", scheduledAt: AT, inLocalTime: false },
        { user: user("u8", null, { gift_amount_most_recent: 40 }), variantId: "v-give", scheduledAt: AT, inLocalTime: false },
        { user: user("u9"), variantId: "v-modal", scheduledAt: AT, inLocalTime: false },
      ],
      variantMeta,
      decisionIdByUser,
    );

    expect(normalizeGroups(groups)).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to write the snapshot.**

Run: `bun test tests/unit/characterization/send-grouping.snapshot.test.ts`
Expected: PASS, and a new `__snapshots__/send-grouping.snapshot.test.ts.snap` is written.

- [ ] **Step 3: Check the snapshot by hand.** Open the `.snap` file and confirm:
  - `u9` is absent;
  - `braze-abc` appears in `brazeOnlyIds`;
  - the `v-give` deeplink no longer contains `GIVING_LINK_SENTINEL`;
  - `u1` and `u2` are in different groups (`inLocalTime` split).

  If any of these is wrong, stop and report it. The snapshot would be freezing a bug.

- [ ] **Step 4: Run it again to prove it's stable.**

Run: `bun test tests/unit/characterization/send-grouping.snapshot.test.ts`
Expected: PASS with no snapshot written. If it fails, find the field that changed and add it to `normalizeGroups`.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/characterization/send-grouping.snapshot.test.ts tests/unit/characterization/__snapshots__/send-grouping.snapshot.test.ts.snap
git commit -m "test: characterize groupDecisionsByVariant output across channels"
```

---

### Task 2: Snapshot the Braze HTTP layer per channel

**Files:**
- Create: `tests/unit/characterization/send-variant-group.snapshot.test.ts`
- Create (generated): `tests/unit/characterization/__snapshots__/send-variant-group.snapshot.test.ts.snap`

**Interfaces:**
- Consumes:
  - `sendVariantGroup(group, batchUserIds, batchDecisionIds, brazeClient, factory, agentId, prisma, onSuccessfulBatch?)` from `src/lib/cron/send-grouping.ts`;
  - `createBrazeClient()` from `src/lib/braze/client.ts`;
  - `PayloadFactory` from `src/lib/braze/payload-factory.ts` (constructor takes optional `opts`);
  - `FakeFetch` from `tests/helpers/braze.ts`.
- Produces: `recordingPrisma()` (local to this file). It returns `{ client, calls }`, where `client` implements only `userDecision.updateMany` and `failedBrazeSend.create`, and `calls` records `{ op, args }` with UUIDs replaced by `"<uuid>"`.

- [ ] **Step 1: Write the test.** It covers each channel twice, once immediate and once scheduled more than 2 minutes out, plus one Braze failure (HTTP 400) to freeze the `FailedBrazeSend` write.

```ts
// tests/unit/characterization/send-variant-group.snapshot.test.ts
//
// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): freezes the exact
// Braze endpoints + request bodies + DB side-effects sendVariantGroup produces
// per channel. This is the contract the future Activator(braze) adapter must
// reproduce byte-for-byte. Update with `bun test -u` only for reviewed changes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { sendVariantGroup, type VariantSendGroup } from "@/lib/cron/send-grouping";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { FakeFetch } from "../../helpers/braze";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const scrub = (v: unknown): unknown => JSON.parse(JSON.stringify(v ?? null).replace(UUID_RE, "<uuid>"));

function recordingPrisma() {
  const calls: Array<{ op: string; args: unknown }> = [];
  const client = {
    userDecision: {
      updateMany: async (args: unknown) => { calls.push({ op: "userDecision.updateMany", args: scrub(args) }); return { count: 1 }; },
    },
    failedBrazeSend: {
      create: async (args: unknown) => { calls.push({ op: "failedBrazeSend.create", args: scrub(args) }); return {}; },
    },
  };
  return { client: client as unknown as typeof import("@/lib/db").prisma, calls };
}

const ENV = {
  BRAZE_API_KEY: "test_key",
  BRAZE_REST_ENDPOINT: "https://rest.test.braze.com",
  BRAZE_NEXUS_CAMPAIGN_ID: "nexus-campaign",
  BRAZE_CONTENT_CARD_CAMPAIGN_ID: "cc-campaign",
  BRAZE_NEXUS_SLIDEUP_CANVAS_ID: "slideup-canvas",
  BRAZE_NEXUS_MODAL_CANVAS_ID: "modal-canvas",
  BRAZE_IOS_APP_ID: "ios-app",
  BRAZE_ANDROID_APP_ID: "android-app",
};
const NOW = new Date("2026-05-30T12:00:00Z");
const FUTURE = new Date("2026-05-30T15:00:00Z"); // > 2 min out → schedule endpoints

function group(channel: string, scheduledAt: Date, extra: Partial<VariantSendGroup> = {}): VariantSendGroup {
  return {
    variantId: `v-${channel}`,
    brazeVariantId: `bv-${channel}`,
    brazeCampaignId: "db-campaign",
    channel,
    title: channel === "in-app" ? null : "Title",
    body: channel === "email" ? "<p>Body</p>" : "Body",
    cta: "Open",
    deeplink: "youversion://home",
    iosImageUrl: null,
    androidImageUrl: null,
    inLocalTime: false,
    scheduledAt,
    externalUserIds: ["u1", "braze-only-1"],
    brazeOnlyIds: new Set(["braze-only-1"]),
    decisionIds: ["d1", "d2"],
    ...extra,
  };
}

let fake: FakeFetch;
let originalFetch: typeof globalThis.fetch;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  setSystemTime(NOW);
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setSystemTime();
});
beforeEach(() => { fake = new FakeFetch(); originalFetch = globalThis.fetch; globalThis.fetch = fake.fetch as typeof fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

async function run(g: VariantSendGroup) {
  const { client, calls } = recordingPrisma();
  const result = await sendVariantGroup(
    g, g.externalUserIds, g.decisionIds, createBrazeClient(), new PayloadFactory(), "agent-1", client,
  );
  return {
    result,
    requests: fake.requests.map((r) => ({ method: r.method, url: r.url, body: scrub(r.body) })),
    db: calls,
  };
}

describe("characterization: sendVariantGroup Braze contract", () => {
  for (const channel of ["push", "email", "sms", "content-card", "in-app", "modal-iam"]) {
    it(`${channel} — immediate`, async () => {
      expect(await run(group(channel, NOW))).toMatchSnapshot();
    });
    it(`${channel} — scheduled`, async () => {
      fake.queueResponse({ message: "success", schedule_id: "sched-1" }, 201);
      expect(await run(group(channel, FUTURE))).toMatchSnapshot();
    });
  }

  it("push — Braze 400 records FailedBrazeSend", async () => {
    fake.queueResponse({ message: "Invalid request" }, 400);
    expect(await run(group("push", NOW))).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run it to write the snapshots.**

Run: `bun test tests/unit/characterization/send-variant-group.snapshot.test.ts`
Expected: PASS (13 tests), and the snapshot file is written.

If a channel throws because `sendVariantGroup` reads another Prisma model or env var, add exactly that method or variable to `recordingPrisma` or `ENV`, then re-run.

- [ ] **Step 3: Check the snapshot by hand.** Confirm:
  - push, email and sms immediate hit `/messages/send`, and scheduled hits `/messages/schedule/create`;
  - content-card hits `/campaigns/trigger/send` and `/campaigns/trigger/schedule/create` with `campaign_id: "cc-campaign"`;
  - in-app and modal hit `/canvas/trigger/...` with their canvas IDs;
  - `braze-only-1` goes out as a `braze_id` recipient;
  - the 400 case has a `failedBrazeSend.create` entry.

  Anything else is a finding to report, not something to silently freeze.

- [ ] **Step 4: Run it again to prove it's stable.**

Run: `bun test tests/unit/characterization/send-variant-group.snapshot.test.ts`
Expected: PASS, no snapshot written.

- [ ] **Step 5: Commit.**

```bash
git add tests/unit/characterization/send-variant-group.snapshot.test.ts tests/unit/characterization/__snapshots__/send-variant-group.snapshot.test.ts.snap
git commit -m "test: characterize sendVariantGroup Braze requests and DB writes per channel"
```

---

### Task 3: Snapshot one full cron run

**Files:**
- Create: `tests/integration/characterization-select-and-send.test.ts`
- Create (generated): `tests/integration/__snapshots__/characterization-select-and-send.test.ts.snap`
- Create: `tests/helpers/seeded-random.ts`

**Interfaces:**
- Consumes: `POST` from `src/app/api/cron/select-and-send/route.ts`; the builders `createAgent`, `createPersona`, `createMessage`, `createVariant`, `createUser`, `createSchedulingRule`, `linkAgentToPersona` from `tests/helpers/builders.ts`; `truncateAll`, `prisma` from `tests/helpers/db.ts`; `buildRequest` from `tests/helpers/request.ts`.
- Produces:
  - `seedRandom(seed: number): () => void` in `tests/helpers/seeded-random.ts`. It replaces `Math.random` with mulberry32 and returns a restore function. Later phases reuse it.
  - The snapshot of normalized Braze requests plus resulting `UserDecision` rows.

- [ ] **Step 1: Write the seeded-random helper.**

```ts
// tests/helpers/seeded-random.ts
// Deterministic Math.random for characterization tests (mulberry32, public domain).
export function seedRandom(seed: number): () => void {
  const original = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => { Math.random = original; };
}
```

- [ ] **Step 2: Confirm the builder signatures the test relies on.** These were checked against `tests/helpers/builders.ts` on 2026-10-13: `createMessage(agentId, { channel?, brazeCampaignId? })`, `createVariant(messageId, { name?, body?, brazeVariantId?, … })`, `createUser(externalId, { personaId?, funnelStage?, attributes?, … })`, `createSchedulingRule(agentId)`, `linkAgentToPersona(agentId, personaId)`. Run `grep -n "^export async function" tests/helpers/builders.ts`. If any signature has changed since then, update the calls in Step 3 to match.

- [ ] **Step 3: Write the test.**

```ts
// tests/integration/characterization-select-and-send.test.ts
//
// CHARACTERIZATION (P0 safety net, spec 2026-10-13 §10): one end-to-end cron
// run with seeded randomness and a frozen clock. Freezes WHICH users get
// WHICH variant via WHICH Braze call. The P2 refactor (Activator extraction,
// queue) must keep this snapshot green. Update with `bun test -u` only for
// intended, reviewed behaviour changes.
import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { seedRandom } from "../helpers/seeded-random";
import {
  createAgent, createPersona, createMessage, createVariant,
  createUser, createSchedulingRule, linkAgentToPersona,
} from "../helpers/builders";
import { POST } from "@/app/api/cron/select-and-send/route";

const CRON_AUTH = { Authorization: "Bearer test_cron_secret" };
const NOW = new Date("2026-05-30T15:00:00Z");
const ID_RE = /\b(c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g;

let brazeRequests: Array<{ url: string; body: unknown }> = [];
let originalFetch: typeof globalThis.fetch;
let restoreRandom: () => void;

/** Replace generated ids with stable, first-seen-order placeholders. */
function stabilize(value: unknown, names: Map<string, string>): unknown {
  const json = JSON.stringify(value).replace(ID_RE, (id) => {
    if (!names.has(id)) names.set(id, `<id${names.size + 1}>`);
    return names.get(id)!;
  });
  return JSON.parse(json);
}

beforeEach(async () => {
  await truncateAll();
  process.env.CRON_SECRET = "test_cron_secret";
  process.env.BRAZE_API_KEY = "test_braze_key";
  process.env.BRAZE_REST_URL = "https://rest.test.braze.com";
  process.env.BRAZE_NEXUS_CAMPAIGN_ID = "nexus-campaign";
  brazeRequests = [];
  setSystemTime(NOW);
  restoreRandom = seedRandom(42);
  originalFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("rest.test.braze.com")) {
      brazeRequests.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ message: "success" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  restoreRandom();
  setSystemTime();
  await truncateAll();
  for (const k of ["CRON_SECRET", "BRAZE_API_KEY", "BRAZE_REST_URL", "BRAZE_NEXUS_CAMPAIGN_ID"]) delete process.env[k];
});

describe("characterization: one select-and-send run", () => {
  it("sends the same variants to the same users via the same Braze calls", async () => {
    // Setup mirrors the passing send case in tests/integration/cron-send.test.ts:85-89
    // (thompson push agent, wau users), widened to two variants and five users
    // with fixed externalIds u1..u5 and fixed brazeVariantIds "bv-A" / "bv-B".
    const persona = await createPersona({ name: "Char Persona" });
    const agent = await createAgent({ name: "Char Agent", algorithm: "thompson", funnelStage: "wau" });
    const message = await createMessage(agent.id, { channel: "push", brazeCampaignId: "camp_char" });
    await createVariant(message.id, { name: "A", body: "Variant A", brazeVariantId: "bv-A" });
    await createVariant(message.id, { name: "B", body: "Variant B", brazeVariantId: "bv-B" });
    for (const id of ["u1", "u2", "u3", "u4", "u5"]) {
      await createUser(id, { personaId: persona.id, funnelStage: "wau" });
    }
    await linkAgentToPersona(agent.id, persona.id);
    await createSchedulingRule(agent.id);

    const res = await POST(buildRequest("POST", undefined, CRON_AUTH) as NextRequest);
    expect(res.status).toBe(200);

    const decisions = await prisma.userDecision.findMany({
      where: { agentId: agent.id },
      orderBy: { userId: "asc" },
      select: { userId: true, variantId: true, channel: true, brazeSendId: true, sentAt: true },
    });
    const names = new Map<string, string>();
    const snapshot = {
      brazeRequests: brazeRequests
        .map((r) => ({ url: r.url, body: r.body }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      decisions: decisions.map((d) => ({ ...d, brazeSendId: d.brazeSendId ? "<set>" : null, sentAt: d.sentAt?.toISOString() ?? null })),
    };
    expect(decisions.length).toBeGreaterThan(0);
    expect(stabilize(snapshot, names)).toMatchSnapshot();
  });
});
```

- [ ] **Step 4: Run it against the test DB to write the snapshot.**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/characterization-select-and-send.test.ts`
Expected: PASS, and the snapshot is written.

If the builder calls in Step 3 don't match the real signatures from Step 2, fix them to the real ones; the assertions stay as they are.

If `decisions.length` is 0, the setup isn't eligible. Compare it with the passing "sends" case in `cron-send.test.ts` and add the missing field. Don't loosen the assertion.

- [ ] **Step 5: Run it two more times to prove it's stable.**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/characterization-select-and-send.test.ts` (twice)
Expected: PASS both times, no snapshot written.

If it flakes, the cause is randomness or time not covered by the seed. Find the source (`crypto.randomUUID` in a payload, or `Date.now()` captured before `setSystemTime`) and normalize it in `stabilize`.

- [ ] **Step 6: Commit.**

```bash
git add tests/helpers/seeded-random.ts tests/integration/characterization-select-and-send.test.ts tests/integration/__snapshots__/characterization-select-and-send.test.ts.snap
git commit -m "test: characterize a full select-and-send run with seeded RNG and frozen clock"
```

---

### Task 4: Fix LinUCB lost updates (compare-and-swap on `version`)

**Files:**
- Create: `prisma/migrations/20261013120000_linucb_arm_version/migration.sql`
- Modify: `prisma/schema.prisma:322-334` (model `LinUCBArm`)
- Modify: `src/lib/arm-stats.ts:114-185` (`updateLinUCBArm`)
- Modify: `src/app/api/cron/select-and-send/route.ts` (the stale-reset `prisma.linUCBArm.update` at ~1053 and ~1810)
- Modify: `src/lib/decide.ts` (the stale-reset `prisma.linUCBArm.update` at ~234)
- Test: `tests/regression/linucb-concurrent-updates.test.ts`

**Interfaces:**
- Consumes: `LinUCB` (`initialArm(dim)`, `update(aInv, b, x, r)`) from `src/lib/engine/linucb.ts`; `FEATURE_DIM` from `src/lib/engine/feature-vector.ts`.
- Produces:
  - `LinUCBArm.version Int @default(0)`.
  - `updateLinUCBArm(params)` keeps its signature but now uses compare-and-swap.
  - New exported constant `LINUCB_MAX_CAS_ATTEMPTS = 5` in `src/lib/arm-stats.ts`.
  - **Rule for every other writer:** any code that overwrites `aInv` or `b` must also set `version: { increment: 1 }`.

- [ ] **Step 1: Write the migration and schema change.**

```sql
-- prisma/migrations/20261013120000_linucb_arm_version/migration.sql
-- Optimistic-concurrency version for LinUCBArm (spec 2026-10-13 §6.7).
-- updateLinUCBArm compare-and-swaps on this column so concurrent rewards for
-- the same arm retry instead of overwriting each other (lost update bug).
-- ADD COLUMN with a constant default is metadata-only on PG 11+.
ALTER TABLE "LinUCBArm" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
```

In `prisma/schema.prisma`, model `LinUCBArm`, add after `tries`:

```prisma
  // Optimistic-concurrency token: every write that changes aInv/b increments it.
  version   Int    @default(0)
```

- [ ] **Step 2: Apply it to the test DB and regenerate the client.**

```bash
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" -f prisma/migrations/20261013120000_linucb_arm_version/migration.sql
npx prisma generate
```

Expected: `ALTER TABLE`, then the client is regenerated. (`prisma generate` doesn't touch any database.)

- [ ] **Step 3: Write the failing regression test.**

```ts
// tests/regression/linucb-concurrent-updates.test.ts
//
// REGRESSION (audit 2026-10-13, spec §2 "LinUCB lost updates"):
// updateLinUCBArm did findUnique → Sherman-Morrison in JS → update with no
// lock or version check. Concurrent rewards for the same arm overwrote each
// other (last writer wins), silently discarding learning. The first-update
// path also upserted an identity arm that could reset a concurrent update.
// Fix: compare-and-swap on LinUCBArm.version with bounded retry.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { updateLinUCBArm } from "@/lib/arm-stats";
import { LinUCB } from "@/lib/engine/linucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

function contexts(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: FEATURE_DIM }, (_, d) => ((i + 1) * (d + 3)) % 7 / 7),
  );
}

/** Expected arm after applying every (x, r) sequentially — A and b are order-independent sums. */
function sequential(xs: number[][], r: number) {
  const lin = new LinUCB();
  let { aInv, b } = lin.initialArm(FEATURE_DIM);
  for (const x of xs) ({ aInv, b } = lin.update(aInv, b, x, r));
  return { aInv, b };
}

async function readArm() {
  const row = await prisma.linUCBArm.findUniqueOrThrow({
    where: { agentId_variantId: { agentId: "agent-1", variantId: "variant-1" } },
  });
  return { aInv: row.aInv as number[], b: row.b as number[], tries: row.tries, version: row.version };
}

describe("regression: concurrent LinUCB updates are not lost", () => {
  it("8 concurrent updates on a NEW arm all land", async () => {
    const xs = contexts(8);
    await Promise.all(xs.map((contextVec) =>
      updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec, reward: 1 }),
    ));
    const arm = await readArm();
    const want = sequential(xs, 1);
    expect(arm.tries).toBe(8);
    want.b.forEach((v, i) => expect(arm.b[i]).toBeCloseTo(v, 6));
    want.aInv.forEach((v, i) => expect(arm.aInv[i]).toBeCloseTo(v, 6));
  });

  it("a stale-dimension reset bumps version so an in-flight update retries", async () => {
    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(1)[0], reward: 1 });
    const before = await readArm();
    const fresh = new LinUCB().initialArm(FEATURE_DIM);
    await prisma.linUCBArm.update({
      where: { agentId_variantId: { agentId: "agent-1", variantId: "variant-1" } },
      data: { aInv: fresh.aInv, b: fresh.b, tries: 0, version: { increment: 1 } },
    });
    expect((await readArm()).version).toBe(before.version + 1);
  });
});
```

- [ ] **Step 4: Run it and confirm the first test fails.**

Run: `TEST_DB=true bun test --timeout 30000 tests/regression/linucb-concurrent-updates.test.ts`
Expected: the first test FAILS on the `b`/`aInv` closeness assertion, because some updates were lost. The second test passes once the column exists.

- [ ] **Step 5: Implement compare-and-swap in `updateLinUCBArm`.** Replace everything after the two input-validation `if` blocks (from `const linUCB = new LinUCB();` to the end of the function) with:

```ts
  const linUCB = new LinUCB();

  for (let attempt = 0; attempt < LINUCB_MAX_CAS_ATTEMPTS; attempt++) {
    const arm = await loadOrCreateLinUCBArm(agentId, variantId, linUCB);
    const { aInv: newAInv, b: newB } = linUCB.update(arm.aInv, arm.b, contextVec, reward);

    // Compare-and-swap on version: a concurrent writer bumps it first, this
    // write matches 0 rows, and we retry from a fresh read instead of
    // overwriting their update (A and b are sums, so retry order is irrelevant).
    const { count } = await prisma.linUCBArm.updateMany({
      where: { agentId, variantId, version: arm.version },
      data: {
        aInv: newAInv as unknown as Prisma.InputJsonValue,
        b: newB as unknown as Prisma.InputJsonValue,
        tries: arm.stale ? 1 : { increment: 1 },
        version: { increment: 1 },
      },
    });
    if (count === 1) return;
  }

  console.warn(
    `[updateLinUCBArm] dropped reward after ${LINUCB_MAX_CAS_ATTEMPTS} contended attempts agent=${agentId} variant=${variantId}`,
  );
}

/**
 * Read the arm, creating an identity-prior row if it does not exist. Never
 * overwrites an existing row: a concurrent creator's row (and any update
 * already applied to it) wins via skipDuplicates. A row with the wrong
 * dimension is returned as identity + stale=true; the caller's CAS write
 * replaces it wholesale.
 */
async function loadOrCreateLinUCBArm(
  agentId: string,
  variantId: string,
  linUCB: LinUCB,
): Promise<{ aInv: number[]; b: number[]; version: number; stale: boolean }> {
  const where = { agentId_variantId: { agentId, variantId } };
  const initial = linUCB.initialArm(FEATURE_DIM);

  let row = await prisma.linUCBArm.findUnique({ where });
  if (!row) {
    await prisma.linUCBArm.createMany({
      data: [{
        agentId,
        variantId,
        aInv: initial.aInv as unknown as Prisma.InputJsonValue,
        b: initial.b as unknown as Prisma.InputJsonValue,
        tries: 0,
      }],
      skipDuplicates: true,
    });
    row = await prisma.linUCBArm.findUniqueOrThrow({ where });
  }

  const hasValidShape =
    Array.isArray(row.aInv) && (row.aInv as number[]).length === FEATURE_DIM * FEATURE_DIM &&
    Array.isArray(row.b) && (row.b as number[]).length === FEATURE_DIM;
  if (!hasValidShape) {
    return { aInv: initial.aInv, b: initial.b, version: row.version, stale: true };
  }
  return { aInv: row.aInv as number[], b: row.b as number[], version: row.version, stale: false };
}
```

Add the constant near `ARM_STATS_WRITE_CONCURRENCY` at the top of the file:

```ts
// Bounded retries for the LinUCBArm compare-and-swap; contention beyond this
// is logged and the reward dropped rather than spinning a cron/ingest worker.
export const LINUCB_MAX_CAS_ATTEMPTS = 5;
```

Also update the function's doc comment. Replace "Loads the arm (creating with identity prior if missing), applies LinUCB.update(), and persists the new aInv and b to the database." with "Loads the arm (creating with identity prior if missing), applies LinUCB.update(), and persists the new aInv and b with a compare-and-swap on `version`, retrying on contention."

- [ ] **Step 6: Make every other `aInv`/`b` writer bump `version`.** Add `version: { increment: 1 },` to the `data` object of each of these calls:
  - `src/app/api/cron/select-and-send/route.ts`: the stale-reset `prisma.linUCBArm.update` (~line 1053) and the one at ~line 1810.
  - `src/lib/decide.ts`: the `prisma.linUCBArm.update` at ~line 234.

Don't change the cron's seeding `upsert` (~line 1026). Its `update: {}` never overwrites anything, so it's already safe.

Then run:
```bash
grep -rn "linUCBArm\.\(update\|upsert\)" src | grep -v generated
```
Expected: every hit that sets `aInv` also sets `version: { increment: 1 }`.

- [ ] **Step 7: Run the regression test, then the LinUCB-related suites.**

```bash
TEST_DB=true bun test --timeout 30000 tests/regression/linucb-concurrent-updates.test.ts
bun test tests/unit/linucb.test.ts
TEST_DB=true bun test --timeout 30000 tests/integration/decide.test.ts
```
Expected: all PASS.

- [ ] **Step 8: Add the retry-exhaustion test (Review Focus 5).** Append to `tests/regression/linucb-concurrent-updates.test.ts`:

```ts
import { mock, spyOn } from "bun:test";
import { LINUCB_MAX_CAS_ATTEMPTS } from "@/lib/arm-stats";

describe("regression: CAS retry exhaustion", () => {
  it("gives up after LINUCB_MAX_CAS_ATTEMPTS without corrupting the arm", async () => {
    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(1)[0], reward: 1 });
    const before = await readArm();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const updateMany = spyOn(prisma.linUCBArm, "updateMany").mockResolvedValue({ count: 0 });

    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(2)[1], reward: 1 });

    expect(updateMany).toHaveBeenCalledTimes(LINUCB_MAX_CAS_ATTEMPTS);
    expect(warn).toHaveBeenCalled();
    updateMany.mockRestore();
    warn.mockRestore();
    expect(await readArm()).toEqual(before);
    mock.restore();
  });
});
```

Merge the new imports into the file's existing import lines. Don't duplicate `import ... from "bun:test"`.

Run: `TEST_DB=true bun test --timeout 30000 tests/regression/linucb-concurrent-updates.test.ts`
Expected: 3 tests PASS. If `spyOn` can't patch the extended Prisma client's model delegate, instead spy on the module function by exporting `loadOrCreateLinUCBArm` for tests only. Report which approach you used.

- [ ] **Step 9: Run the quick suite.**

Run: `bun run check:quick`
Expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git add prisma/migrations/20261013120000_linucb_arm_version/migration.sql prisma/schema.prisma src/lib/arm-stats.ts src/app/api/cron/select-and-send/route.ts src/lib/decide.ts tests/regression/linucb-concurrent-updates.test.ts
git commit -m "fix(engine): compare-and-swap LinUCBArm updates to stop lost rewards"
```

---

### Task 5: Fix spiritual depth (dim [8]) to read the keys that actually arrive

**Background:**
- Dim [8] reads `gp_current_month_count`, `gs_current_month_count` and `badge_lifetime_count`.
- Neither ingest (`src/app/api/ingest/users/route.ts:1029-1034`) nor any Hightouch template in `docs/json/` supplies those keys. They supply `gp_current_year_count`, `gs_current_year_count` and `badge_current_year_count`. So three of the five inputs are always 0 in production.
- **The fix keeps the old keys when they're present** (the existing unit test at `tests/unit/feature-vector.test.ts:145` uses them). Otherwise it falls back to the year counts, converted to the same daily rate: `count / dayOfYear(asOf)`, capped at 1.
- `asOf` comes in through `UserStatsInput`, so the engine stays pure. When `asOf` is absent, the divisor is 365. That's the conservative case and is used only by callers with no clock.

**Files:**
- Modify: `src/lib/engine/feature-vector.ts:41-50` (add `asOf` to `UserStatsInput`) and `:122-128` (dim [8])
- Modify: the callers of `computeFeatureVector`, which must pass `asOf`:
  - `src/app/api/cron/select-and-send/route.ts:1361` and `:1864`
  - `src/lib/decide.ts:245`
  - `src/lib/services/persona-service.ts:40`, `:117`, `:183`
- Modify: `src/app/demo/deep-dive/feature-vectors/page.tsx:169-173` (the documented formula)
- Test: `tests/unit/feature-vector.test.ts` (new cases); `tests/regression/feature-vector-spiritual-depth-keys.test.ts`

**Interfaces:**
- Produces: `UserStatsInput.asOf?: Date`, and the exported pure helper `dayOfYearUtc(d: Date): number` (1-based, UTC) from `src/lib/engine/feature-vector.ts`.
- **Effect on LinUCB:** dim [8] values change for every YouVersion user, so LinUCB contexts shift. The arm shapes are unchanged, so no reset happens. Existing arms keep learning with the corrected signal. Note this in the commit body.

- [ ] **Step 1: Write the failing regression test.**

```ts
// tests/regression/feature-vector-spiritual-depth-keys.test.ts
//
// REGRESSION (audit 2026-10-13, spec §2 "Spiritual depth reads missing keys"):
// dim [8] read gp_current_month_count / gs_current_month_count /
// badge_lifetime_count, but ingest + every Hightouch template only send the
// *_current_year_count keys, so 3 of 5 inputs were always 0 in production.
// Fix: fall back to the year counts as a daily rate (count / day-of-year).
import { describe, expect, it } from "bun:test";
import { computeFeatureVector, dayOfYearUtc } from "@/lib/engine/feature-vector";
import type { UserStatsInput } from "@/lib/engine/feature-vector";

const base: UserStatsInput = {
  totalDecisions: 0, totalConversions: 0, totalReward: 0,
  channelStats: {}, hourlyStats: [], dailyStats: [],
};
const MAY_30 = new Date("2026-05-30T12:00:00Z"); // day 150

describe("regression: spiritual depth uses the keys Hightouch sends", () => {
  it("dayOfYearUtc is 1-based", () => {
    expect(dayOfYearUtc(new Date("2026-01-01T00:00:00Z"))).toBe(1);
    expect(dayOfYearUtc(MAY_30)).toBe(150);
  });

  it("year-count keys contribute when month/lifetime keys are absent", () => {
    const attrs = { gp_current_year_count: 75, gs_current_year_count: 150, badge_current_year_count: 10 };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: MAY_30 })[8];
    const prayer = 75 / 150;
    const scripture = Math.min(1, 150 / 150);
    const badge = Math.log(1 + 10) / Math.log(201);
    expect(v).toBeCloseTo((prayer + scripture + badge) / 5, 6);
  });

  it("month/lifetime keys win when present", () => {
    const attrs = { gp_current_month_count: 15, gp_current_year_count: 999 };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: MAY_30 })[8];
    expect(v).toBeCloseTo((15 / 30) / 5, 6);
  });

  it("string values and Jan 1 stay finite and in [0,1]", () => {
    const attrs = { gp_current_year_count: "3", gs_current_year_count: "12", badge_current_year_count: "4" };
    const v = computeFeatureVector({ ...base, attributes: attrs, asOf: new Date("2026-01-01T08:00:00Z") })[8];
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it("without asOf the year count is divided by 365", () => {
    const v = computeFeatureVector({ ...base, attributes: { gp_current_year_count: 73 } })[8];
    expect(v).toBeCloseTo((73 / 365) / 5, 6);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `bun test tests/regression/feature-vector-spiritual-depth-keys.test.ts`
Expected: FAIL with "dayOfYearUtc is not a function" / "not exported".

- [ ] **Step 3: Implement it in `src/lib/engine/feature-vector.ts`.** Add to `UserStatsInput`:

```ts
  /** Evaluation date for year-to-date rates. Callers pass their clock; the engine never reads Date.now(). */
  asOf?: Date;
```

Add the exported helper below the interface:

```ts
/** 1-based day of the year in UTC (Jan 1 → 1). */
export function dayOfYearUtc(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - start) / 86_400_000) + 1;
}
```

Replace the dim [8] block (the `streak` through `vec[8] =` lines) with:

```ts
  // [8] Spiritual depth — mean of five engagement depth signals, each in [0,1].
  // Hightouch sends *_current_year_count; *_current_month_count / badge_lifetime_count
  // are honoured when present. Year counts become a daily rate: count / day-of-year
  // (or /365 when the caller passes no asOf), the same "share of days" meaning as month/30.
  const has = (key: string): boolean => attrs[key] !== undefined && attrs[key] !== null;
  const daysElapsed = stats.asOf ? dayOfYearUtc(stats.asOf) : 365;
  const dailyRate = (monthKey: string, yearKey: string): number =>
    has(monthKey)
      ? Math.min(1, num(monthKey) / 30)
      : Math.min(1, num(yearKey) / daysElapsed);
  const streak    = Math.min(1, num("plan_day_current_month_count") / 31);
  const plan      = Math.log(1 + num("plan_finish_lifetime_count")) / Math.log(501);
  const prayer    = dailyRate("gp_current_month_count", "gp_current_year_count");
  const scripture = dailyRate("gs_current_month_count", "gs_current_year_count");
  const badgeCount = has("badge_lifetime_count") ? num("badge_lifetime_count") : num("badge_current_year_count");
  const badge     = Math.log(1 + Math.max(0, badgeCount)) / Math.log(201);
  vec[8] = (streak + plan + prayer + scripture + badge) / 5;
```

- [ ] **Step 4: Run the regression test and the existing feature-vector tests.**

```bash
bun test tests/regression/feature-vector-spiritual-depth-keys.test.ts tests/unit/feature-vector.test.ts
```
Expected: all PASS. The existing `[8]` tests still pass, because the month and lifetime keys take priority.

- [ ] **Step 5: Pass `asOf` from every caller.** Each `computeFeatureVector({ ... })` call listed under Files gets one more property. In the cron route, use the run's existing "now" variable (find it with `grep -n "const now" src/app/api/cron/select-and-send/route.ts`). In `decide.ts` and `persona-service.ts`, use the function's existing `now` if there is one, otherwise `new Date()` (these are services, not engine code). For example:

```ts
              : computeFeatureVector({
                  // ...existing fields unchanged...
                  asOf: now,
                })
```

Then run:
```bash
grep -rn "computeFeatureVector(" src | grep -v generated
```
and confirm each of the 6 call sites passes `asOf`.

- [ ] **Step 6: Update the documented formula on the demo page.** In `src/app/demo/deep-dive/feature-vectors/page.tsx`, replace the `prayer`, `scripture` and `badge` lines (169-173) with:

```tsx
        {`prayer   = gp_current_month_count/30  else  gp_current_year_count / day_of_year`}{"\n"}
        {`scripture= gs_current_month_count/30  else  gs_current_year_count / day_of_year`}{"\n"}
        {`badge    = log(1 + badge_lifetime_count | badge_current_year_count) / log(201)`}{"\n\n"}
```

Keep the existing `streak` and `plan` lines.

- [ ] **Step 7: Run the quick suite, then the integration suites that compute vectors.**

```bash
bun run check:quick
TEST_DB=true bun test --timeout 30000 tests/integration/decide.test.ts
TEST_DB=true bun test --timeout 30000 tests/integration/characterization-select-and-send.test.ts
```
Expected: all PASS.

The cron snapshot from Task 3 may change if its fixture users have year-count attributes. They don't (Task 3 sets none), so it should stay green. If it changes, stop and report it. Don't update the snapshot.

- [ ] **Step 8: Commit.**

```bash
git add src/lib/engine/feature-vector.ts src/app/api/cron/select-and-send/route.ts src/lib/decide.ts src/lib/services/persona-service.ts src/app/demo/deep-dive/feature-vectors/page.tsx tests/regression/feature-vector-spiritual-depth-keys.test.ts
git commit -m "fix(engine): spiritual-depth feature reads the year-count keys Hightouch sends

Dim [8] read *_current_month_count / badge_lifetime_count, which no ingest
path supplies, so 3 of 5 inputs were always 0. Fall back to the year
counts as a daily rate. Dim [8] values shift for all users; LinUCB arm
shapes are unchanged so arms keep learning with the corrected signal."
```

---

### Task 6: Full verification and handoff

**Files:** none modified.

- [ ] **Step 1: Run the full check.**

Run: `TEST_DB=true bun run check`
Expected: PASS (typecheck, lint, unit, contract, integration, regression). If an unrelated pre-existing test fails, run it alone on the commit before Task 1 (`git stash`; check out the base commit; run it; return). Report whether it was already failing. Don't fix unrelated tests in this plan.

- [ ] **Step 2: Confirm nothing outside the plan was committed.**

Run: `git log --stat --oneline -6` and `git status --short src/lib/engine/thompson-sampling.ts`
Expected:
- the 5 commits touch only the files named in their tasks;
- `thompson-sampling.ts` is still listed as modified and uncommitted.

- [ ] **Step 3: Write the handoff note** (in the final message to Dan, not a file):
  - The production migration `20261013120000_linucb_arm_version` must be applied before deploying. Dan decides when, for example with `npx prisma migrate deploy`, which reads `.env.local`, the production DB.
  - Dim [8] values change for all YouVersion users from this deploy on.
  - The three snapshot files are now the contract that P2 has to keep green.
