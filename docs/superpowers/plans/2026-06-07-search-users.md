# Audience › Search Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search an individual user by exact external ID, Braze ID, or email and view their full Nexus profile (identity, pinned + raw attributes, 30-day messaging timeline, arm stats, gifts) via a shared `UserDetail` component reused by Audience › Search Users and Control Tower.

**Architecture:** New `GET /api/users/search` (email via `$queryRaw` against an expression index; ID/brazeId via `findUnique`). Extend `GET /api/users/[externalId]` with attributes/funnel/channelStats/messagingHistory. Two pure lib helpers (`pinned-properties`, `messaging-history`) hold all formatting logic. One presentational `UserDetail` component; `/audience/search` and Control Tower's `UserInspector` both render it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon), Bun test runner, happy-dom, lucide-react, shadcn/ui.

---

## Constraints (read before starting)

- **DB safety:** NEVER run `prisma migrate dev` (it loads `.env.local` = PROD). Apply DDL idempotently to PROD and test, hand-create the migration folder, then `prisma migrate resolve --applied`.
- **PG env bleed:** prefix any test-DB command with `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test"`.
- **Tests:** NEVER run in background. Use `bun run check:quick` while iterating; `bun run check` before the MR. Use `tests/helpers/builders.ts`; `truncateAll` (not TRUNCATE CASCADE).
- **Code:** No `any`; routes return `{data:T}`/`{error}`; lib helpers PURE; JSON DB fields narrowed/validated on read.
- **`prisma.trackedUser` maps to DB table `"User"`; `Persona` table is `"Persona"`. `externalId` + `brazeId` are `@unique`. `attributes`/`channelStats` are Prisma `Json` → returned as JS values, narrow before use.**

## File Structure

- Create `src/lib/users/pinned-properties.ts` — pure: user/attrs → ordered display rows.
- Create `src/lib/users/messaging-history.ts` — pure: decisions → timeline events.
- Create `src/app/api/users/search/route.ts` — GET search endpoint.
- Modify `src/app/api/users/[externalId]/route.ts` — extend response.
- Create `src/components/users/user-detail.tsx` — shared presentational view (owns `BetaBar`).
- Modify `src/components/control-tower/user-inspector.tsx` — render `<UserDetail>`; re-export `BetaBar` from new home.
- Create `src/components/users/user-search.tsx` — client search UI.
- Modify `src/app/audience/search/page.tsx` — replace `ComingSoon` with shell + `<UserSearch>`.
- Create migration folder `prisma/migrations/<ts>_user_attributes_email_idx/migration.sql`.
- Tests: `tests/regression/users-email-index.test.ts`, `tests/unit/pinned-properties.test.ts`, `tests/unit/messaging-history.test.ts`, `tests/integration/users-search.test.ts`, `tests/integration/user-detail-extended.test.ts`, `tests/regression/audience-search-page.test.tsx`.

---

## Shared Types (define exactly as written; reused across tasks)

```ts
// in src/lib/users/messaging-history.ts
export type TimelineEvent = {
  id: string;            // `${decisionId}:${type}` — unique per event
  decisionId: string;
  type: "sent" | "open" | "conversion";
  time: string;          // ISO 8601
  channel: string;
  agentName: string | null;
  variantName: string | null;
  variantTitle: string | null;
  conversionEvent: string | null;  // populated only for type === "conversion"
  reward: number | null;
};

export type DecisionForTimeline = {
  id: string;
  sentAt: Date | string;
  channel: string;
  pushOpenAt: Date | string | null;
  conversionAt: Date | string | null;
  conversionEvent: string | null;
  reward: number | null;
  variant: {
    name: string;
    title: string | null;
    message: { agent: { name: string } };
  } | null;
};
```

```ts
// in src/lib/users/pinned-properties.ts
export type PinnedProperty = { label: string; value: string };
export type PinnedInput = {
  attributes: Record<string, unknown>;
  funnelStage: string | null;
  timezone: string | null;
  personaName: string | null;
};
```

```ts
// SearchHit — returned by /api/users/search, consumed by UserSearch
type SearchHit = {
  externalId: string;
  brazeId: string | null;
  email: string | null;
  name: string | null;
  funnelStage: string | null;
  personaName: string | null;
};
```

---

### Task 1: Email expression index migration + regression guard

**Files:**
- Create: `prisma/migrations/<timestamp>_user_attributes_email_idx/migration.sql`
- Test: `tests/regression/users-email-index.test.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
// tests/regression/users-email-index.test.ts
//
// REGRESSION: email search MUST use the PostgreSQL JSON-path column expression
// attributes->>'email' (backed by index "User_attributes_email_idx"), NOT Prisma's
// JSON-path filter DSL which does not reliably hit the expression index on 34.6M rows.
// This test pins the exact SQL shape so a future refactor to prisma.findFirst({ where:
// { attributes: { path: ['email'] } } }) breaks here instead of silently full-scanning.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUser } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: email lookup uses attributes->>'email' column expression", () => {
  it("returns the user whose attributes email matches via the ->> expression", async () => {
    await createUser("u-email-1", { attributes: { email: "match@example.com", name: "Match" } });
    await createUser("u-email-2", { attributes: { email: "other@example.com" } });

    const rows = await prisma.$queryRaw<Array<{ externalId: string; email: string | null }>>`
      SELECT u."externalId", u."attributes"->>'email' AS email
      FROM "User" u
      WHERE u."attributes"->>'email' = ${"match@example.com"}
      LIMIT 25
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe("u-email-1");
    expect(rows[0]!.email).toBe("match@example.com");
  });

  it("the User_attributes_email_idx index exists in the schema", async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'User' AND indexname = 'User_attributes_email_idx'
    `;
    expect(idx).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/regression/users-email-index.test.ts`
Expected: FAIL on the second test (`User_attributes_email_idx` does not exist). First test should pass (the `->>` operator works without the index).

- [ ] **Step 3: Apply the idempotent DDL to the test DB**

Run:
```bash
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
  psql "postgresql://localhost:5432/nexus_test" -v ON_ERROR_STOP=1 \
  -c 'CREATE INDEX IF NOT EXISTS "User_attributes_email_idx" ON "User" ((attributes->>'"'"'email'"'"'));'
```
Expected: `CREATE INDEX`.

- [ ] **Step 4: Apply the same DDL to PROD**

Run (uses `.env.local` → PROD Neon via `DATABASE_URL_UNPOOLED`):
```bash
source .env.local && psql "$DATABASE_URL_UNPOOLED" -v ON_ERROR_STOP=1 \
  -c 'CREATE INDEX IF NOT EXISTS "User_attributes_email_idx" ON "User" ((attributes->>'"'"'email'"'"'));'
```
Expected: `CREATE INDEX` (building over 34.6M rows may take a minute; this is a btree on a single text expression so it is bounded). If `.env.local` lacks `DATABASE_URL_UNPOOLED`, fall back to `DATABASE_URL`.

- [ ] **Step 5: Create the migration folder so history reconciles**

Create `prisma/migrations/<timestamp>_user_attributes_email_idx/migration.sql` (use a timestamp greater than the latest existing migration folder, format `YYYYMMDDHHMMSS`):
```sql
-- Expression index for exact email lookup on the User.attributes JSON column.
-- Prisma's JSON-path filter does not reliably use this index, so /api/users/search
-- queries it via $queryRaw WHERE attributes->>'email' = $1.
CREATE INDEX IF NOT EXISTS "User_attributes_email_idx" ON "User" ((attributes->>'email'));
```

- [ ] **Step 6: Mark the migration applied on both DBs (do NOT run migrate dev)**

Run:
```bash
# test DB
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT \
  DATABASE_URL="postgresql://localhost:5432/nexus_test" \
  npx prisma migrate resolve --applied <timestamp>_user_attributes_email_idx
# prod
npx prisma migrate resolve --applied <timestamp>_user_attributes_email_idx
```
Expected: "Migration ... marked as applied." for each.

- [ ] **Step 7: Re-run the regression test to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/regression/users-email-index.test.ts`
Expected: PASS (2/2).

- [ ] **Step 8: Commit**

```bash
git add prisma/migrations tests/regression/users-email-index.test.ts
git commit -m "feat(db): expression index for User.attributes email exact lookup"
```

---

### Task 2: Pure helper — pinned-properties

**Files:**
- Create: `src/lib/users/pinned-properties.ts`
- Test: `tests/unit/pinned-properties.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/pinned-properties.test.ts
import { describe, expect, it } from "bun:test";
import { buildPinnedProperties } from "@/lib/users/pinned-properties";

describe("buildPinnedProperties", () => {
  it("always includes Funnel stage and Persona, using — for null", () => {
    const rows = buildPinnedProperties({ attributes: {}, funnelStage: null, timezone: null, personaName: null });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Funnel stage"]).toBe("—");
    expect(map["Persona"]).toBe("—");
  });

  it("formats booleans as Yes/No and skips missing optional keys", () => {
    const rows = buildPinnedProperties({
      attributes: { email: "a@b.com", name: "Ann", newsletter_push_enabled: true, newsletter_email_enabled: false, language_tag: "en" },
      funnelStage: "wau",
      timezone: "America/New_York",
      personaName: "Engaged",
    });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Email"]).toBe("a@b.com");
    expect(map["Name"]).toBe("Ann");
    expect(map["Newsletter push"]).toBe("Yes");
    expect(map["Newsletter email"]).toBe("No");
    expect(map["Language"]).toBe("en");
    expect(map["Funnel stage"]).toBe("wau");
    expect(map["Persona"]).toBe("Engaged");
    expect(map["Timezone"]).toBe("America/New_York");
    expect(map).not.toHaveProperty("Country"); // country_latest missing → skipped
  });

  it("derives Name from first_name + last_name when name absent", () => {
    const rows = buildPinnedProperties({ attributes: { first_name: "Jo", last_name: "Lee" }, funnelStage: null, timezone: null, personaName: null });
    const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
    expect(map["Name"]).toBe("Jo Lee");
  });

  it("preserves the canonical row order", () => {
    const rows = buildPinnedProperties({
      attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
      funnelStage: "wau", timezone: "UTC", personaName: "P",
    });
    const labels = rows.map((r) => r.label);
    expect(labels.indexOf("Name")).toBeLessThan(labels.indexOf("Email"));
    expect(labels.indexOf("Email")).toBeLessThan(labels.indexOf("Funnel stage"));
    expect(labels.indexOf("Funnel stage")).toBeLessThan(labels.indexOf("Persona"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/pinned-properties.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/users/pinned-properties.ts
export type PinnedProperty = { label: string; value: string };
export type PinnedInput = {
  attributes: Record<string, unknown>;
  funnelStage: string | null;
  timezone: string | null;
  personaName: string | null;
};

function fmt(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function deriveName(attrs: Record<string, unknown>): string | null {
  const direct = fmt(attrs.name);
  if (direct) return direct;
  const parts = [attrs.first_name, attrs.last_name].map(fmt).filter((p): p is string => p !== null);
  return parts.length ? parts.join(" ") : null;
}

export function buildPinnedProperties(input: PinnedInput): PinnedProperty[] {
  const a = input.attributes;
  // Each entry: [label, computed value, core?]. Core rows always render (— when null).
  const candidates: Array<[string, string | null, boolean]> = [
    ["Name", deriveName(a), false],
    ["Email", fmt(a.email), false],
    ["Funnel stage", fmt(input.funnelStage), true],
    ["Persona", fmt(input.personaName), true],
    ["Language", fmt(a.language_tag), false],
    ["Country", fmt(a.country_latest), false],
    ["Timezone", fmt(input.timezone), false],
    ["Days since last open", fmt(a.days_since_last_open), false],
    ["Preferred channel (30d)", fmt(a.preferred_channel_overall_30_days), false],
    ["Newsletter push", fmt(a.newsletter_push_enabled), false],
    ["Newsletter email", fmt(a.newsletter_email_enabled), false],
    ["Recurring gift", fmt(a.has_recurring_gift), false],
    ["Lifetime gifts", fmt(a.gift_count_lifetime), false],
  ];
  return candidates
    .filter(([, value, core]) => core || value !== null)
    .map(([label, value]) => ({ label, value: value ?? "—" }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/unit/pinned-properties.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/users/pinned-properties.ts tests/unit/pinned-properties.test.ts
git commit -m "feat(users): pure pinned-properties formatter"
```

---

### Task 3: Pure helper — messaging-history

**Files:**
- Create: `src/lib/users/messaging-history.ts`
- Test: `tests/unit/messaging-history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/messaging-history.test.ts
import { describe, expect, it } from "bun:test";
import { buildMessagingTimeline } from "@/lib/users/messaging-history";

const variant = { name: "Var A", title: "Hello", message: { agent: { name: "Agent X" } } };

describe("buildMessagingTimeline", () => {
  it("expands a sent-only decision into a single sent event", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant,
    }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("sent");
    expect(events[0]!.id).toBe("d1:sent");
    expect(events[0]!.agentName).toBe("Agent X");
    expect(events[0]!.variantName).toBe("Var A");
  });

  it("expands sent + open + conversion into three events sorted by time desc", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: "2026-06-01T11:00:00.000Z", conversionAt: "2026-06-01T12:00:00.000Z",
      conversionEvent: "gift_given", reward: 5, variant,
    }]);
    expect(events.map((e) => e.type)).toEqual(["conversion", "open", "sent"]);
    const conv = events.find((e) => e.type === "conversion")!;
    expect(conv.conversionEvent).toBe("gift_given");
    expect(conv.reward).toBe(5);
  });

  it("sorts events across multiple decisions newest-first", () => {
    const events = buildMessagingTimeline([
      { id: "old", sentAt: "2026-05-01T10:00:00.000Z", channel: "push", pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant },
      { id: "new", sentAt: "2026-06-01T10:00:00.000Z", channel: "email", pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant },
    ]);
    expect(events.map((e) => e.decisionId)).toEqual(["new", "old"]);
  });

  it("tolerates a null variant", () => {
    const events = buildMessagingTimeline([{
      id: "d1", sentAt: "2026-06-01T10:00:00.000Z", channel: "push",
      pushOpenAt: null, conversionAt: null, conversionEvent: null, reward: null, variant: null,
    }]);
    expect(events[0]!.variantName).toBeNull();
    expect(events[0]!.agentName).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/messaging-history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/users/messaging-history.ts
export type TimelineEvent = {
  id: string;
  decisionId: string;
  type: "sent" | "open" | "conversion";
  time: string;
  channel: string;
  agentName: string | null;
  variantName: string | null;
  variantTitle: string | null;
  conversionEvent: string | null;
  reward: number | null;
};

export type DecisionForTimeline = {
  id: string;
  sentAt: Date | string;
  channel: string;
  pushOpenAt: Date | string | null;
  conversionAt: Date | string | null;
  conversionEvent: string | null;
  reward: number | null;
  variant: {
    name: string;
    title: string | null;
    message: { agent: { name: string } };
  } | null;
};

function iso(t: Date | string): string {
  return typeof t === "string" ? new Date(t).toISOString() : t.toISOString();
}

export function buildMessagingTimeline(decisions: DecisionForTimeline[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const d of decisions) {
    const base = {
      decisionId: d.id,
      channel: d.channel,
      agentName: d.variant?.message.agent.name ?? null,
      variantName: d.variant?.name ?? null,
      variantTitle: d.variant?.title ?? null,
    };
    events.push({ ...base, id: `${d.id}:sent`, type: "sent", time: iso(d.sentAt), conversionEvent: null, reward: null });
    if (d.pushOpenAt) {
      events.push({ ...base, id: `${d.id}:open`, type: "open", time: iso(d.pushOpenAt), conversionEvent: null, reward: null });
    }
    if (d.conversionAt) {
      events.push({ ...base, id: `${d.id}:conversion`, type: "conversion", time: iso(d.conversionAt), conversionEvent: d.conversionEvent, reward: d.reward });
    }
  }
  return events.sort((a, b) => b.time.localeCompare(a.time));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/unit/messaging-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/users/messaging-history.ts tests/unit/messaging-history.test.ts
git commit -m "feat(users): pure messaging-history timeline builder"
```

---

### Task 4: `GET /api/users/search` endpoint

**Files:**
- Create: `src/app/api/users/search/route.ts`
- Test: `tests/integration/users-search.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/users-search.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUser, createPersona } from "../helpers/builders";

const { GET } = await import("@/app/api/users/search/route");

function req(q: string | null) {
  const url = q === null ? "http://localhost/api/users/search" : `http://localhost/api/users/search?q=${encodeURIComponent(q)}`;
  return new Request(url);
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/users/search", () => {
  it("returns 400 when q is empty", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is missing", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(400);
  });

  it("finds a user by exact externalId", async () => {
    const persona = await createPersona({ name: "Engaged" });
    await createUser("ext-123", { personaId: persona.id, funnelStage: "wau", attributes: { email: "x@y.com", name: "Xy" } });
    const res = await GET(req("ext-123"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ externalId: "ext-123", email: "x@y.com", name: "Xy", funnelStage: "wau", personaName: "Engaged" });
  });

  it("finds a user by exact brazeId", async () => {
    await createUser("ext-9", { brazeId: "braze-abc", attributes: { email: "b@y.com" } });
    const res = await GET(req("braze-abc"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].externalId).toBe("ext-9");
  });

  it("finds a user by exact email (contains @)", async () => {
    await createUser("ext-mail", { attributes: { email: "find@me.com", name: "Finder" } });
    const res = await GET(req("find@me.com"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ externalId: "ext-mail", email: "find@me.com", name: "Finder" });
  });

  it("returns 200 with [] when nothing matches", async () => {
    const res = await GET(req("nobody-here"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/users-search.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/users/search/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

type SearchHit = {
  externalId: string;
  brazeId: string | null;
  email: string | null;
  name: string | null;
  funnelStage: string | null;
  personaName: string | null;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function emailOf(attrs: Record<string, unknown>): string | null {
  return typeof attrs.email === "string" ? attrs.email : null;
}

function nameOf(attrs: Record<string, unknown>): string | null {
  if (typeof attrs.name === "string" && attrs.name) return attrs.name;
  const parts = [attrs.first_name, attrs.last_name].filter((p): p is string => typeof p === "string" && p.length > 0);
  return parts.length ? parts.join(" ") : null;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return fail("Query parameter 'q' is required", 400);

  try {
    if (q.includes("@")) {
      // Email exact match via the expression index (User_attributes_email_idx).
      // Prisma's JSON-path filter does NOT reliably use it — see the regression test.
      const rows = await prisma.$queryRaw<Array<{
        externalId: string; brazeId: string | null; email: string | null; name: string | null;
        funnelStage: string | null; personaName: string | null;
      }>>`
        SELECT u."externalId", u."brazeId",
               u."attributes"->>'email' AS email,
               u."attributes"->>'name'  AS name,
               u."funnelStage",
               p."name" AS "personaName"
        FROM "User" u
        LEFT JOIN "Persona" p ON p."id" = u."personaId"
        WHERE u."attributes"->>'email' = ${q}
        LIMIT 25
      `;
      return ok<SearchHit[]>(rows);
    }

    // Exact identifier lookup: externalId first, then brazeId (both @unique).
    const user =
      (await prisma.trackedUser.findUnique({ where: { externalId: q }, include: { persona: true } })) ??
      (await prisma.trackedUser.findUnique({ where: { brazeId: q }, include: { persona: true } }));

    if (!user) return ok<SearchHit[]>([]);

    const attrs = asRecord(user.attributes);
    const hit: SearchHit = {
      externalId: user.externalId,
      brazeId: user.brazeId,
      email: emailOf(attrs),
      name: nameOf(attrs),
      funnelStage: user.funnelStage,
      personaName: user.persona?.name ?? null,
    };
    return ok<SearchHit[]>([hit]);
  } catch (err) {
    return handleRouteError("GET /api/users/search", err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/users-search.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/users/search/route.ts tests/integration/users-search.test.ts
git commit -m "feat(api): GET /api/users/search by id, brazeId, or email"
```

---

### Task 5: Extend `GET /api/users/[externalId]`

**Files:**
- Modify: `src/app/api/users/[externalId]/route.ts`
- Test: `tests/integration/user-detail-extended.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/user-detail-extended.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUser, createPersona, createAgent, createMessage, createVariant, createUserDecision } from "../helpers/builders";

const { GET } = await import("@/app/api/users/[externalId]/route");

function ctx(externalId: string) {
  return { params: Promise.resolve({ externalId }) };
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/users/[externalId] — extended fields", () => {
  it("returns parsed attributes, funnel, timezone, channelStats, and messagingHistory", async () => {
    const persona = await createPersona({ name: "Engaged" });
    await createUser("ext-1", {
      personaId: persona.id,
      funnelStage: "wau",
      attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
    });
    // set fields not covered by the builder
    await prisma.trackedUser.update({
      where: { externalId: "ext-1" },
      data: { timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
              channelStats: { push: { sent: 3, converted: 1 } }, funnelStageUpdatedAt: new Date("2026-06-01T00:00:00Z") },
    });

    const agent = await createAgent({ name: "Agent X" });
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, { name: "Var A", title: "Hello" });
    await createUserDecision({
      agentId: agent.id, userId: "ext-1", messageVariantId: variant.id, channel: "push",
      sentAt: new Date("2026-06-05T10:00:00Z"), conversionEvent: "gift_given", conversionAt: new Date("2026-06-05T12:00:00Z"),
    });

    const res = await GET(new Request("http://localhost/"), ctx("ext-1"));
    const body = await res.json();
    expect(res.status).toBe(200);

    expect(body.data.user).toMatchObject({
      externalId: "ext-1", personaName: "Engaged", funnelStage: "wau",
      timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
    });
    expect(body.data.attributes).toMatchObject({ email: "a@b.com", name: "Ann", language_tag: "en" });
    expect(body.data.channelStats).toMatchObject({ push: { sent: 3, converted: 1 } });

    const types = body.data.messagingHistory.map((e: { type: string }) => e.type);
    expect(types).toContain("sent");
    expect(types).toContain("conversion");
    const conv = body.data.messagingHistory.find((e: { type: string }) => e.type === "conversion");
    expect(conv.conversionEvent).toBe("gift_given");
    expect(conv.agentName).toBe("Agent X");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await GET(new Request("http://localhost/"), ctx("missing"));
    expect(res.status).toBe(404);
  });

  it("excludes decisions older than 30 days from messagingHistory", async () => {
    await createUser("ext-old", {});
    const agent = await createAgent({ name: "A" });
    const message = await createMessage(agent.id, { channel: "push" });
    const variant = await createVariant(message.id, {});
    await createUserDecision({ agentId: agent.id, userId: "ext-old", messageVariantId: variant.id, sentAt: new Date(Date.now() - 40 * 86_400_000) });

    const res = await GET(new Request("http://localhost/"), ctx("ext-old"));
    const body = await res.json();
    expect(body.data.messagingHistory).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/user-detail-extended.test.ts`
Expected: FAIL — `attributes`/`messagingHistory` undefined on response.

- [ ] **Step 3: Rewrite the route**

Replace the entire contents of `src/app/api/users/[externalId]/route.ts` with:

```ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { buildMessagingTimeline } from "@/lib/users/messaging-history";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ externalId: string }> }
) {
  const { externalId } = await params;

  try {
    const user = await prisma.trackedUser.findUnique({
      where: { externalId },
      include: { persona: true },
    });
    if (!user) return fail("User not found", 404);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const [decisions, totalDecisions, totalConversions, rewardAgg, armStats, giftAgg, mostRecentGift] = await Promise.all([
      prisma.userDecision.findMany({
        where: { userId: externalId, sentAt: { gte: thirtyDaysAgo } },
        orderBy: { sentAt: "desc" },
        take: 200,
        select: {
          id: true, sentAt: true, channel: true, pushOpenAt: true,
          conversionAt: true, conversionEvent: true, reward: true,
          variant: {
            select: { name: true, title: true, message: { select: { agent: { select: { name: true } } } } },
          },
        },
      }),
      prisma.userDecision.count({ where: { userId: externalId } }),
      prisma.userDecision.count({ where: { userId: externalId, conversionAt: { not: null } } }),
      prisma.userDecision.aggregate({ where: { userId: externalId }, _sum: { reward: true } }),
      user.personaId
        ? prisma.personaArmStats.findMany({ where: { personaId: user.personaId }, orderBy: { tries: "desc" }, take: 20 })
        : Promise.resolve([]),
      prisma.userDecision.aggregate({
        where: { userId: externalId, conversionEvent: "gift_given" },
        _count: { _all: true }, _sum: { conversionValue: true },
      }),
      prisma.userDecision.findFirst({
        where: { userId: externalId, conversionEvent: "gift_given", conversionAt: { not: null } },
        orderBy: { conversionAt: "desc" },
        select: { sentAt: true, conversionAt: true, conversionValue: true, agent: { select: { name: true } } },
      }),
    ]);

    // Enrich arm stats with variant + agent names
    const variantIds = [...new Set(armStats.map((s) => s.variantId))];
    const variants = variantIds.length
      ? await prisma.messageVariant.findMany({
          where: { id: { in: variantIds } },
          select: { id: true, name: true, title: true, body: true, message: { select: { channel: true, agent: { select: { id: true, name: true } } } } },
        })
      : [];
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const enrichedArmStats = armStats.map((s) => ({
      ...s,
      variant: variantMap.get(s.variantId) ?? null,
      expectedReward: s.alpha / Math.max(1, s.alpha + s.beta),
    }));

    const mostRecent = mostRecentGift && mostRecentGift.conversionAt
      ? {
          usd: mostRecentGift.conversionValue ?? 0,
          agentName: mostRecentGift.agent?.name ?? null,
          timeToGiftHours: (mostRecentGift.conversionAt.getTime() - mostRecentGift.sentAt.getTime()) / 3_600_000,
          conversionAt: mostRecentGift.conversionAt.toISOString(),
        }
      : null;

    return ok({
      user: {
        externalId: user.externalId,
        brazeId: user.brazeId,
        personaId: user.personaId,
        personaName: user.persona?.name ?? null,
        personaConfidence: user.personaConfidence,
        funnelStage: user.funnelStage,
        funnelStageUpdatedAt: user.funnelStageUpdatedAt?.toISOString() ?? null,
        timezone: user.timezone,
        preferredSendHour: user.preferredSendHour,
        preferredSendMinute: user.preferredSendMinute,
        createdAt: user.createdAt.toISOString(),
        totalDecisions,
        totalConversions,
        totalReward: rewardAgg._sum.reward ?? 0,
      },
      attributes: asRecord(user.attributes),
      channelStats: asRecord(user.channelStats),
      messagingHistory: buildMessagingTimeline(decisions),
      armStats: enrichedArmStats,
      gifts: {
        count: giftAgg._count._all,
        totalUsd: giftAgg._sum.conversionValue ?? 0,
        mostRecent,
      },
    });
  } catch (err) {
    return handleRouteError(`GET /api/users/${externalId}`, err);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/user-detail-extended.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Check the old consumer test still references valid shape**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/regression/user-inspector-live-decision-counts.test.ts`
Expected: If it asserts on `recentDecisions`, it will FAIL — that field is gone. Update that test to assert on `messagingHistory`/`totalDecisions` instead (the live decision *count* still comes from `user.totalDecisions`). If it only checks counts, it passes. Make the minimal edit to keep it green; do not weaken its intent.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/users/\[externalId\]/route.ts tests/integration/user-detail-extended.test.ts tests/regression/user-inspector-live-decision-counts.test.ts
git commit -m "feat(api): extend user detail with attributes, funnel, channelStats, messaging timeline"
```

---

### Task 6: Shared `UserDetail` component

**Files:**
- Create: `src/components/users/user-detail.tsx` (owns `BetaBar`)
- Test: `tests/regression/user-detail-component.test.tsx`

This is a presentational component. It receives the full detail payload from Task 5 as a prop and renders: header summary · Pinned properties (via `buildPinnedProperties`) · All properties (collapsible raw `<details>` table) · Messaging history timeline · Arm stats (with `BetaBar`) · Gifts. No fetching.

- [ ] **Step 1: Write the failing component test**

```tsx
// tests/regression/user-detail-component.test.tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

const data: UserDetailData = {
  user: {
    externalId: "ext-1", brazeId: "b1", personaId: "p1", personaName: "Engaged",
    personaConfidence: 0.8, funnelStage: "wau", funnelStageUpdatedAt: "2026-06-01T00:00:00.000Z",
    timezone: "America/New_York", preferredSendHour: 9, preferredSendMinute: 30,
    createdAt: "2026-01-01T00:00:00.000Z", totalDecisions: 5, totalConversions: 2, totalReward: 12.5,
  },
  attributes: { email: "a@b.com", name: "Ann", language_tag: "en" },
  channelStats: { push: { sent: 3, converted: 1 } },
  messagingHistory: [
    { id: "d1:sent", decisionId: "d1", type: "sent", time: "2026-06-05T10:00:00.000Z", channel: "push", agentName: "Agent X", variantName: "Var A", variantTitle: "Hello", conversionEvent: null, reward: null },
  ],
  armStats: [],
  gifts: { count: 0, totalUsd: 0, mostRecent: null },
};

describe("UserDetail", () => {
  it("renders identity, pinned email, and a messaging event", () => {
    const html = renderToStaticMarkup(<UserDetail data={data} />);
    expect(html).toContain("ext-1");
    expect(html).toContain("Engaged");
    expect(html).toContain("a@b.com");
    expect(html).toContain("Var A");
  });

  it("renders the raw all-properties table inside a details element", () => {
    const html = renderToStaticMarkup(<UserDetail data={data} />);
    expect(html).toContain("language_tag");
    expect(html).toContain("<details");
  });

  it("renders an empty messaging-history note when there are no events", () => {
    const html = renderToStaticMarkup(<UserDetail data={{ ...data, messagingHistory: [] }} />);
    expect(html).toContain("No messages in the last 30 days");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/regression/user-detail-component.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/users/user-detail.tsx
"use client";

import { CheckCircle, Clock, MailOpen, Brain, Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyableId } from "@/components/ui/copyable-id";
import { buildPinnedProperties } from "@/lib/users/pinned-properties";
import type { TimelineEvent } from "@/lib/users/messaging-history";

export type ArmStat = {
  variantId: string;
  alpha: number;
  beta: number;
  tries: number;
  wins: number;
  expectedReward: number;
  variant: { id: string; name: string; title: string | null; body: string; message: { channel: string; agent: { id: string; name: string } } } | null;
};

export type UserDetailData = {
  user: {
    externalId: string;
    brazeId: string | null;
    personaId: string | null;
    personaName: string | null;
    personaConfidence: number | null;
    funnelStage: string | null;
    funnelStageUpdatedAt: string | null;
    timezone: string | null;
    preferredSendHour: number | null;
    preferredSendMinute: number | null;
    createdAt: string;
    totalDecisions: number;
    totalConversions: number;
    totalReward: number;
  };
  attributes: Record<string, unknown>;
  channelStats: Record<string, unknown>;
  messagingHistory: TimelineEvent[];
  armStats: ArmStat[];
  gifts: { count: number; totalUsd: number; mostRecent: { usd: number; agentName: string | null; timeToGiftHours: number; conversionAt: string } | null };
};

export function BetaBar({ alpha, beta }: { alpha: number; beta: number }) {
  const denom = alpha + beta;
  const pct = denom > 0 ? Math.round((alpha / denom) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function EventIcon({ type }: { type: TimelineEvent["type"] }) {
  if (type === "conversion") return <CheckCircle className="h-3.5 w-3.5 text-green-500" />;
  if (type === "open") return <MailOpen className="h-3.5 w-3.5 text-blue-500" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />;
}

export function UserDetail({ data }: { data: UserDetailData }) {
  const { user } = data;
  const pinned = buildPinnedProperties({
    attributes: data.attributes,
    funnelStage: user.funnelStage,
    timezone: user.timezone,
    personaName: user.personaName,
  });
  const convRate = user.totalDecisions > 0 ? `${((user.totalConversions / user.totalDecisions) * 100).toFixed(0)}%` : "—";

  return (
    <div className="space-y-4">
      {/* Header summary */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <CopyableId id={user.externalId} className="text-xs bg-muted px-2 py-0.5 rounded" />
              {user.personaName && <Badge variant="secondary" className="text-xs">{user.personaName}</Badge>}
              {user.personaConfidence !== null && (
                <span className="text-xs text-muted-foreground">{Math.round((user.personaConfidence ?? 0) * 100)}% confidence</span>
              )}
            </div>
            <div className="flex gap-4 text-center">
              {[
                { label: "Decisions", value: user.totalDecisions },
                { label: "Conversions", value: user.totalConversions },
                { label: "Conv. Rate", value: convRate },
              ].map(({ label, value }) => (
                <div key={label}>
                  <div className="text-base font-bold">{value}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pinned properties */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Properties</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {pinned.map((p) => (
              <div key={p.label} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.label}</dt>
                <dd className="text-sm truncate">{p.value}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-4">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">All properties</summary>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {Object.entries(data.attributes).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-1 pr-3 font-mono text-muted-foreground align-top whitespace-nowrap">{k}</td>
                    <td className="py-1 break-all">{v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </CardContent>
      </Card>

      {/* Gifts */}
      {data.gifts.count > 0 && (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Gift className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Gifts via Nexus</p>
          </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Messaging history */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Messaging History (30d)</h3>
            </div>
            {data.messagingHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground">No messages in the last 30 days</p>
            ) : (
              data.messagingHistory.map((e) => (
                <div key={e.id} className="flex items-start gap-2.5">
                  <div className="mt-0.5 shrink-0"><EventIcon type={e.type} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium truncate">{e.variantName ?? "Unknown variant"}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">via {e.agentName ?? e.channel}</span>
                    </div>
                    {e.variantTitle && <p className="text-[10px] text-muted-foreground truncate">&ldquo;{e.variantTitle}&rdquo;</p>}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground capitalize">{e.type}</span>
                      <span className="text-[10px] text-muted-foreground">{fmtTime(e.time)}</span>
                      {e.conversionEvent && (
                        <Badge variant="outline" className="text-[9px] py-0 px-1 h-4 text-green-700 border-green-300">{e.conversionEvent}</Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Arm stats */}
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-3">
              <Brain className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Arm Stats — {user.personaName ?? "No persona"}</h3>
            </div>
            {data.armStats.length === 0 ? (
              <p className="text-xs text-muted-foreground">No arm stats yet</p>
            ) : (
              data.armStats.map((s) => (
                <div key={s.variantId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-medium truncate block">{s.variant?.name ?? s.variantId.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground">{s.variant?.message.agent.name} · {s.tries} tries · {s.wins} wins</span>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono font-semibold">{(s.expectedReward * 100).toFixed(1)}%</div>
                      <div className="text-[10px] text-muted-foreground font-mono">α{s.alpha.toFixed(1)} β{s.beta.toFixed(1)}</div>
                    </div>
                  </div>
                  <BetaBar alpha={s.alpha} beta={s.beta} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/regression/user-detail-component.test.tsx`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/components/users/user-detail.tsx tests/regression/user-detail-component.test.tsx
git commit -m "feat(users): shared presentational UserDetail component"
```

---

### Task 7: Wire up `/audience/search` page + refactor Control Tower inspector

**Files:**
- Create: `src/components/users/user-search.tsx` (client)
- Modify: `src/app/audience/search/page.tsx` (replace `ComingSoon`)
- Modify: `src/components/control-tower/user-inspector.tsx` (fetch + render `<UserDetail>`; re-export `BetaBar`)
- Test: `tests/regression/audience-search-page.test.tsx`

- [ ] **Step 1: Write the failing page test**

```tsx
// tests/regression/audience-search-page.test.tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SearchPage from "@/app/audience/search/page";

describe("Audience › Search Users page", () => {
  it("renders the page header and search affordance, not the Coming soon placeholder", () => {
    const html = renderToStaticMarkup(<SearchPage />);
    expect(html).toContain("Search Users");
    expect(html).not.toContain("Coming soon");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/regression/audience-search-page.test.tsx`
Expected: FAIL — page still renders `ComingSoon` ("Coming soon").

- [ ] **Step 3: Implement the `UserSearch` client component**

```tsx
// src/components/users/user-search.tsx
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

type SearchHit = {
  externalId: string;
  brazeId: string | null;
  email: string | null;
  name: string | null;
  funnelStage: string | null;
  personaName: string | null;
};

export function UserSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [detail, setDetail] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDetail(externalId: string) {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(externalId)}`);
      if (!res.ok) { setError(res.status === 404 ? "User not found" : "Failed to load user"); return; }
      const body = await res.json() as { data: UserDetailData };
      setDetail(body.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setHits(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setError("Search failed"); return; }
      const body = await res.json() as { data: SearchHit[] };
      setHits(body.data);
      if (body.data.length === 1) await loadDetail(body.data[0]!.externalId);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="External ID, Braze ID, or email…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {hits && hits.length === 0 && <p className="text-sm text-muted-foreground">No users found.</p>}

      {hits && hits.length > 1 && !detail && (
        <div className="rounded-lg border divide-y max-w-xl">
          {hits.map((h) => (
            <button
              key={h.externalId}
              onClick={() => loadDetail(h.externalId)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted text-sm"
            >
              <span className="truncate">{h.name ?? h.email ?? h.externalId}</span>
              <span className="text-xs text-muted-foreground shrink-0">{h.funnelStage ?? "—"}</span>
            </button>
          ))}
        </div>
      )}

      {detail && <UserDetail data={detail} />}
    </div>
  );
}
```

- [ ] **Step 4: Replace the placeholder page**

Replace the entire contents of `src/app/audience/search/page.tsx` with:

```tsx
import { Header } from "@/components/layout/header";
import { UserSearch } from "@/components/users/user-search";

export default function SearchUsersPage() {
  return (
    <>
      <Header title="Search Users" description="Look up an individual user by external ID, Braze ID, or email." />
      <div className="flex-1 p-6">
        <UserSearch />
      </div>
    </>
  );
}
```

(Verify `@/components/layout/header` exports `Header` with `{ title, description }` — it is used by `ComingSoon`. If the page wrapper differs from sibling pages, match the existing layout pattern in `src/app/audience/segments/page.tsx`.)

- [ ] **Step 5: Refactor Control Tower `UserInspector` to render `<UserDetail>`**

Edit `src/components/control-tower/user-inspector.tsx`:
- Remove the local `ArmStat`/`Decision`/`UserData` interfaces and the inline result-rendering JSX (summary/gifts/recent-decisions/arm-stats blocks).
- Keep the search box + `lookup(id)` fetch to `/api/users/${id}`.
- Type the fetched result as `UserDetailData` and render `<UserDetail data={result} />` when present.
- Re-export `BetaBar` for backward compatibility: `export { BetaBar } from "@/components/users/user-detail";` (other modules may import it from here).

Resulting structure:

```tsx
"use client";

import { useState } from "react";
import { Search, User } from "lucide-react";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

export { BetaBar } from "@/components/users/user-detail";

export function UserInspector() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id.trim())}`);
      if (res.status === 404) { setError("User not found"); return; }
      if (!res.ok) { setError("Failed to fetch user"); return; }
      const body = await res.json() as { data: UserDetailData };
      setResult(body.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">User Inspector</h2>
        </div>
        <span className="text-xs text-muted-foreground">Live profile + arm stats per user</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup(query)}
            placeholder="Enter user external ID…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => lookup(query)}
          disabled={loading || !query.trim()}
          className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? "…" : "Inspect"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <UserDetail data={result} />}
    </div>
  );
}
```

Then grep for other importers of `BetaBar` and confirm they still resolve:
Run: `grep -rn "BetaBar" src/ tests/`
If any import `BetaBar` from `@/components/control-tower/user-inspector`, the re-export keeps them working; if cleaner, repoint them to `@/components/users/user-detail`.

- [ ] **Step 6: Run page test + control-tower regression**

Run: `bun test tests/regression/audience-search-page.test.tsx tests/regression/user-inspector-live-decision-counts.test.ts`
Expected: PASS. If the control-tower regression test asserts removed inline markup, update it to assert via the new `<UserDetail>` output (or the fetch behavior) without weakening intent.

- [ ] **Step 7: Commit**

```bash
git add src/components/users/user-search.tsx src/app/audience/search/page.tsx src/components/control-tower/user-inspector.tsx tests/regression/audience-search-page.test.tsx
git commit -m "feat(audience): Search Users page + Control Tower inspector on shared UserDetail"
```

---

## Final verification

- [ ] Run the full quick suite: `bun run check:quick` → EXIT 0.
- [ ] Run the full suite before MR: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun run check` → EXIT 0.
- [ ] Manually exercise `/audience/search` in `bun run dev`: search by external ID (auto-loads), by email, by Braze ID, and a no-match query; confirm Control Tower inspector still renders.
- [ ] Ship: push `feat/audience-search-users`, `glab mr create`, poll `glab api projects/lifechurch%2Fyouversion%2Fmarketing-group%2Fnexus/merge_requests/N` until `detailed_merge_status == "mergeable"`, then `glab mr merge`.

## Self-Review (completed)

- **Spec coverage:** §1 search endpoint → Task 4; §2 email index → Task 1; §3 extended detail → Task 5; §4 pure helpers → Tasks 2–3; §5 UserDetail → Task 6; §6 pages/wiring → Task 7; §7 tests → distributed across all tasks. All covered.
- **Placeholder scan:** none — every code step has complete code.
- **Type consistency:** `SearchHit`, `UserDetailData`, `TimelineEvent`, `DecisionForTimeline`, `PinnedProperty`/`PinnedInput`, `ArmStat` defined once and referenced consistently; the detail route's response object matches `UserDetailData` field-for-field; `buildMessagingTimeline` input matches the route's `select`.
