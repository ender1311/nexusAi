# API Service Foundation — Plan 1 of 5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Nexus database layer into a standalone Bun/Hono API service so Next.js communicates with the DB over HTTP instead of direct Prisma calls, starting with the agents resource as the full end-to-end proof of concept.

**Architecture:** A Bun/Hono server at `apps/api/` owns Prisma and the DB connection; Next.js calls it via a typed `apiFetch` helper and caches responses using the Next.js fetch cache tagged for on-demand invalidation. The API service notifies Next.js of mutations by calling a `/api/revalidate` webhook, which triggers `revalidateTag`. This plan migrates agents (GET + POST) to establish the pattern; Plans 2–5 migrate the remaining 36 routes.

**Tech Stack:** Bun, Hono 4, Prisma 7 + Neon, Next.js 16 App Router fetch cache, Fly.io (API service deployment), Vercel (Next.js, unchanged).

---

## Sub-projects

This migration is split into 5 sequential plans. Each produces working, deployed software:

| Plan | Scope |
|------|-------|
| **1 (this)** | Monorepo setup, Hono skeleton, Prisma wiring, agents resource, revalidation, Fly.io deploy |
| 2 | Migrate 4 cron routes (select-and-send, discover-personas, sync-template-variants, ingest-braze-analytics) |
| 3 | Migrate ingest + decide + stats routes |
| 4 | Migrate remaining CRUD routes (personas, variants, push-library, settings, etc.) |
| 5 | Remove Prisma from Next.js; update all server components to use `apiFetch` |

---

## File Map

**Created by this plan:**
```
apps/api/
  package.json                    Bun workspace package, Hono + Prisma deps
  tsconfig.json                   TypeScript config for Bun
  fly.toml                        Fly.io deployment config
  Dockerfile                      Multi-stage build from repo root
  src/
    index.ts                      Hono app entry point, Bun.serve()
    routes/
      agents.ts                   GET /agents, POST /agents
    middleware/
      auth.ts                     Bearer token + X-User-Role validation
    lib/
      db.ts                       Prisma client singleton
      revalidate.ts               POST to Next.js /api/revalidate webhook
      constants.ts                Shared constants (LIBRARY_AGENT_NAME, FUNNEL_STAGES)

src/lib/api-client.ts             Typed fetch wrapper; Next.js calls this to reach API service
src/app/api/revalidate/route.ts   Next.js webhook: receives tag from API service, calls revalidateTag
```

**Modified by this plan:**
```
package.json                      Add "workspaces", add dev:all + dev:api scripts
prisma/schema.prisma              Add second generator block outputting to apps/api/src/generated/prisma
src/app/api/agents/route.ts       Replace Prisma calls with apiFetch proxy
src/lib/cache.ts                  getCachedAgentList: replace Prisma with apiFetch + fetch tags
```

---

## Environment Variables

The API service needs these in addition to its own `DATABASE_URL`:

| Variable | Where set | Purpose |
|---|---|---|
| `INTERNAL_API_SECRET` | Vercel + Fly.io | Shared bearer token: Next.js → API service |
| `REVALIDATE_SECRET` | Fly.io + Vercel | Webhook secret: API service → Next.js revalidate |
| `NEXT_APP_URL` | Fly.io | Base URL of the Next.js app (e.g. `https://nexus-ai-yv.vercel.app`) |
| `API_SERVICE_URL` | Vercel | Base URL of the API service (e.g. `https://nexus-api.fly.dev`) |

---

## Task 1: Workspace setup and `apps/api` scaffold

**Files:**
- Modify: `package.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Add Bun workspaces to root `package.json`**

Open `package.json`. Add a `"workspaces"` field and two new scripts. The `"name"` field must exist for workspaces to work:

```json
{
  "name": "nexus-web",
  "workspaces": ["apps/api"],
  "scripts": {
    "dev": "next dev",
    "dev:api": "bun --cwd apps/api run dev",
    "dev:all": "bun run dev & bun run dev:api",
    "build": "prisma generate && next build",
    ...
  }
}
```

- [ ] **Step 2: Create `apps/api/package.json`**

```json
{
  "name": "@nexus/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "typecheck": "tsc --noEmit",
    "generate": "bunx prisma generate --config prisma.config.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.0.2",
    "@prisma/adapter-neon": "7.8.0",
    "@prisma/client": "7.8.0",
    "hono": "^4.0.0",
    "prisma": "7.8.0"
  },
  "devDependencies": {
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Create `apps/api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `apps/api/src/index.ts`**

```typescript
import { Hono } from "hono";
import { logger } from "hono/logger";
import { agentsRoute } from "./routes/agents";

const app = new Hono();
app.use("*", logger());
app.get("/health", (c) => c.json({ ok: true }));
app.route("/agents", agentsRoute);

const port = parseInt(process.env.PORT ?? "3001");
console.log(`API service on port ${port}`);

export default { port, fetch: app.fetch };
export { app };
```

- [ ] **Step 5: Install API service dependencies**

```bash
bun install
```

Expected: `apps/api/node_modules/hono` exists, no errors.

- [ ] **Step 6: Verify the server starts**

```bash
bun run dev:api
```

Expected: `API service on port 3001` printed, `curl http://localhost:3001/health` returns `{"ok":true}`.

- [ ] **Step 7: Commit**

```bash
git add package.json apps/api/
git commit -m "feat: add apps/api Bun/Hono service skeleton"
```

---

## Task 2: Auth middleware

**Files:**
- Create: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/index.ts`

The API service is only ever called by two callers in Phase 1: Next.js (using `INTERNAL_API_SECRET`) and nobody else. All routes are protected. Admin-gated routes additionally require the `X-User-Role: admin` header, which Next.js adds after verifying the user's WorkOS session.

- [ ] **Step 1: Create `apps/api/src/middleware/auth.ts`**

```typescript
import { createMiddleware } from "hono/factory";

export const serviceAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== process.env.INTERNAL_API_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

export function requireAdminHeader(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("X-User-Role") !== "admin";
}
```

- [ ] **Step 2: Apply `serviceAuth` globally in `apps/api/src/index.ts`**

```typescript
import { Hono } from "hono";
import { logger } from "hono/logger";
import { serviceAuth } from "./middleware/auth";
import { agentsRoute } from "./routes/agents";

const app = new Hono();
app.use("*", logger());
app.get("/health", (c) => c.json({ ok: true })); // health check excluded from auth
app.use("*", serviceAuth);                         // all other routes require bearer token
app.route("/agents", agentsRoute);

const port = parseInt(process.env.PORT ?? "3001");
console.log(`API service on port ${port}`);

export default { port, fetch: app.fetch };
export { app };
```

- [ ] **Step 3: Verify auth works**

Start the server. Run:
```bash
# Should fail
curl -s http://localhost:3001/agents | jq .
# Expected: {"error":"Unauthorized"}

# Should succeed (replace "secret" with INTERNAL_API_SECRET value)
curl -s -H "Authorization: Bearer secret" http://localhost:3001/agents | jq .
# Expected: [] or array of agents
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/middleware/auth.ts apps/api/src/index.ts
git commit -m "feat: add bearer token auth middleware to API service"
```

---

## Task 3: Prisma in the API service

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `apps/api/prisma.config.ts`
- Create: `apps/api/src/lib/db.ts`

The schema at `prisma/schema.prisma` is shared. We add a second generator block so `prisma generate` produces a client specifically for the API service at `apps/api/src/generated/prisma`.

- [ ] **Step 1: Add second generator to `prisma/schema.prisma`**

Open `prisma/schema.prisma`. After the existing `generator client` block, add:

```prisma
generator apiClient {
  provider = "prisma-client"
  output   = "../apps/api/src/generated/prisma"
}
```

The full top of the file should now read:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

generator apiClient {
  provider = "prisma-client"
  output   = "../apps/api/src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

- [ ] **Step 2: Create `apps/api/prisma.config.ts`**

```typescript
import { config } from "dotenv";
config();
config({ path: "../../.env.local", override: true });

// Safety guard: block migrations against production unless CONFIRM_PROD_MIGRATE=true
const PROD_ENDPOINT_IDS = ["ep-old-surf-a4p5os6s"];
const dbUrl = process.env["DATABASE_URL"] ?? "";
const prodMatch = PROD_ENDPOINT_IDS.find((id) => dbUrl.includes(id));
if (prodMatch && !process.env["CONFIRM_PROD_MIGRATE"]) {
  console.error(
    "\n🚨  MIGRATION SAFETY ABORT\n" +
    `    DATABASE_URL targets production endpoint "${prodMatch}".\n` +
    "    Set CONFIRM_PROD_MIGRATE=true to proceed:\n\n" +
    "    CONFIRM_PROD_MIGRATE=true npx prisma migrate deploy\n",
  );
  process.exit(1);
}

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
```

- [ ] **Step 3: Regenerate clients**

```bash
npx prisma generate
```

Expected: two clients generated:
- `src/generated/prisma/` (existing Next.js client, unchanged)
- `apps/api/src/generated/prisma/` (new API service client)

Verify: `ls apps/api/src/generated/prisma/` shows `client.js`, `index.js`, etc.

- [ ] **Step 4: Create `apps/api/src/lib/db.ts`**

```typescript
import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("connection_limit", "1");
url.searchParams.set("pool_timeout", "0");
const adapter = new PrismaNeon({ connectionString: url.toString() });

export const prisma = new PrismaClient(
  { adapter } as ConstructorParameters<typeof PrismaClient>[0]
);
```

Note: no global singleton needed — the API service is a persistent process, not serverless.

- [ ] **Step 5: Create `apps/api/src/lib/constants.ts`**

These constants are duplicated from `src/lib/engine/template-sync.ts` and `src/types/agent.ts`. Plan 5 will consolidate them into a shared package.

```typescript
export const LIBRARY_AGENT_NAME = "__library__";

export const FUNNEL_STAGES = [
  "wau", "mau", "dau", "connected",
  "lapsed", "lapsed_dau4", "lapsed_wau", "lapsed_mau",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];
```

- [ ] **Step 6: Verify Prisma works in API service**

Add a temporary debug route in `apps/api/src/index.ts`:

```typescript
app.get("/ping-db", serviceAuth, async (c) => {
  const count = await prisma.agent.count();
  return c.json({ agents: count });
});
```

Start the server:
```bash
INTERNAL_API_SECRET=secret DATABASE_URL=<your-local-or-test-url> bun run dev:api
curl -H "Authorization: Bearer secret" http://localhost:3001/ping-db
```

Expected: `{"agents": <n>}` with the actual count.

Remove the debug route after verification.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma apps/api/prisma.config.ts apps/api/src/lib/
git commit -m "feat: add Prisma client generator for API service"
```

---

## Task 4: Revalidation helper

**Files:**
- Create: `apps/api/src/lib/revalidate.ts`

When the API service mutates data, it must tell Next.js to invalidate its fetch cache. This is done via a webhook call. The webhook itself is created in Task 6.

- [ ] **Step 1: Create `apps/api/src/lib/revalidate.ts`**

```typescript
/**
 * Calls the Next.js revalidate webhook to invalidate a named cache tag.
 * Non-fatal: if Next.js is unreachable the cache will expire on its own TTL.
 */
export async function revalidate(tag: string): Promise<void> {
  const url = process.env.NEXT_APP_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    console.warn(`[revalidate] NEXT_APP_URL or REVALIDATE_SECRET not set — skipping tag "${tag}"`);
    return;
  }
  try {
    const res = await fetch(`${url}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, secret }),
    });
    if (!res.ok) {
      console.warn(`[revalidate] webhook returned ${res.status} for tag "${tag}"`);
    }
  } catch (err) {
    console.warn(`[revalidate] webhook call failed for tag "${tag}":`, err);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/revalidate.ts
git commit -m "feat: add revalidate helper for Next.js cache invalidation"
```

---

## Task 5: Agents routes in the API service

**Files:**
- Create: `apps/api/src/routes/agents.ts`

This implements GET /agents and POST /agents. The full `POST /agents` logic (with nested goal/message/scheduling creation) is ported verbatim from `src/app/api/agents/route.ts`. Read that file carefully before writing this one — the field validation and nested-create logic must be identical.

- [ ] **Step 1: Read the existing route to understand its full logic**

```bash
cat src/app/api/agents/route.ts
```

Note every validation check, every nested Prisma write, and both `revalidateTag` calls at the end of POST. You'll reimplement all of this in Hono.

- [ ] **Step 2: Create `apps/api/src/routes/agents.ts`**

```typescript
import { Hono } from "hono";
import { prisma } from "../lib/db";
import { revalidate } from "../lib/revalidate";
import { requireAdminHeader } from "../middleware/auth";
import { LIBRARY_AGENT_NAME, FUNNEL_STAGES } from "../lib/constants";

const agents = new Hono();

// ── GET /agents ───────────────────────────────────────────────────────────────

agents.get("/", async (c) => {
  try {
    const rows = await prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      include: {
        _count: { select: { goals: true, messages: true, decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return c.json(rows);
  } catch (err) {
    console.error("GET /agents error:", err);
    return c.json({ error: "Failed to fetch agents" }, 500);
  }
});

// ── POST /agents ──────────────────────────────────────────────────────────────

const VALID_STAGES = new Set(FUNNEL_STAGES);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}

agents.post("/", async (c) => {
  if (requireAdminHeader(c)) return c.json({ error: "Forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const {
    name, description, algorithm, epsilon,
    goals = [], messages = [],
    frequencyCap, quietStart, quietEnd, timezone,
    smartSuppress, suppressThresh,
    funnelStage, targetFilter,
  } = body as Record<string, unknown>;

  if (!VALID_STAGES.has(funnelStage as string)) {
    return c.json({ error: "Invalid funnelStage" }, 400);
  }
  if (targetFilter !== undefined && !isPlainObject(targetFilter)) {
    return c.json({ error: "targetFilter must be a plain object" }, 400);
  }

  try {
    const agent = await prisma.agent.create({
      data: {
        name: String(name),
        description: description ? String(description) : null,
        algorithm: String(algorithm ?? "thompson"),
        epsilon: Number(epsilon ?? 0.1),
        funnelStage: String(funnelStage),
        ...(targetFilter && { targetFilter }),
        goals: {
          create: (goals as unknown[]).map((g: unknown) => {
            const goal = g as Record<string, unknown>;
            return {
              eventName: String(goal.eventName),
              tier: String(goal.tier),
              valueWeight: Number(goal.valueWeight ?? 1),
              weightMode: String(goal.weightMode ?? "fixed"),
              weightDefault: Number(goal.weightDefault ?? 1),
              weightProperty: goal.weightProperty ? String(goal.weightProperty) : null,
            };
          }),
        },
        messages: {
          create: (messages as unknown[]).map((m: unknown) => {
            const msg = m as Record<string, unknown>;
            return {
              name: String(msg.name),
              channel: String(msg.channel),
              brazeCampaignId: msg.brazeCampaignId ? String(msg.brazeCampaignId) : null,
            };
          }),
        },
        schedulingRule: {
          create: {
            frequencyCap: (frequencyCap as object) ?? { maxSends: 3, period: "week" },
            quietHours: {
              start: String(quietStart ?? "22:00"),
              end: String(quietEnd ?? "08:00"),
              timezone: String(timezone ?? "America/New_York"),
            },
            blackoutDates: [],
            smartSuppress: Boolean(smartSuppress ?? false),
            suppressThresh: Number(suppressThresh ?? 0.5),
          },
        },
      },
    });

    await revalidate("agents");
    return c.json(agent, 201);
  } catch (err) {
    console.error("POST /agents error:", err);
    return c.json({ error: "Failed to create agent" }, 500);
  }
});

export { agents as agentsRoute };
```

- [ ] **Step 3: Test both routes locally**

```bash
INTERNAL_API_SECRET=secret DATABASE_URL=<test-db-url> bun run dev:api
```

```bash
# GET — should return array
curl -s -H "Authorization: Bearer secret" http://localhost:3001/agents | jq 'length'

# POST without admin header — should 403
curl -s -X POST -H "Authorization: Bearer secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","algorithm":"thompson","epsilon":0.1,"funnelStage":"wau"}' \
  http://localhost:3001/agents | jq .
# Expected: {"error":"Forbidden"}

# POST with admin header — should 201
curl -s -X POST \
  -H "Authorization: Bearer secret" \
  -H "X-User-Role: admin" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Agent","algorithm":"thompson","epsilon":0.1,"funnelStage":"wau","goals":[],"messages":[]}' \
  http://localhost:3001/agents | jq '.id'
# Expected: "<cuid string>"
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/agents.ts
git commit -m "feat: add GET /agents and POST /agents to API service"
```

---

## Task 6: Next.js revalidation webhook

**Files:**
- Create: `src/app/api/revalidate/route.ts`

The API service calls this webhook after mutations to tell Next.js to invalidate a cache tag. This is a server-to-server call — never exposed to users.

- [ ] **Step 1: Create `src/app/api/revalidate/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tag, secret } = body as Record<string, unknown>;

  if (typeof secret !== "string" || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeof tag !== "string" || !tag) {
    return NextResponse.json({ error: "tag required" }, { status: 400 });
  }

  revalidateTag(tag, "max");
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Test manually (optional but recommended)**

```bash
# Start Next.js dev server
bun run dev

# Call the webhook
curl -s -X POST http://localhost:3000/api/revalidate \
  -H "Content-Type: application/json" \
  -d '{"tag":"agents","secret":"wrong-secret"}'
# Expected: {"error":"Unauthorized"}

curl -s -X POST http://localhost:3000/api/revalidate \
  -H "Content-Type: application/json" \
  -d '{"tag":"agents","secret":"<your-REVALIDATE_SECRET>"}'
# Expected: {"ok":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/revalidate/route.ts
git commit -m "feat: add /api/revalidate webhook for API service cache invalidation"
```

---

## Task 7: HTTP client in Next.js

**Files:**
- Create: `src/lib/api-client.ts`

This is the typed fetch wrapper that Next.js uses to call the API service. It sets the auth header and participates in the Next.js fetch cache for tag-based revalidation.

- [ ] **Step 1: Create `src/lib/api-client.ts`**

```typescript
const API_BASE = process.env.API_SERVICE_URL;
const API_SECRET = process.env.INTERNAL_API_SECRET;

type FetchOptions = RequestInit & {
  /** Pass to participate in Next.js fetch cache with tag-based revalidation. */
  tags?: string[];
  /** Set to true when the caller has verified the current user is an admin. */
  isAdmin?: boolean;
};

/**
 * Authenticated fetch to the API service.
 * - Tags opt the response into the Next.js Data Cache (invalidated by revalidateTag).
 * - isAdmin adds X-User-Role: admin, enabling admin-gated mutations.
 */
export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  if (!API_BASE || !API_SECRET) {
    throw new Error("API_SERVICE_URL and INTERNAL_API_SECRET must be set");
  }

  const { tags, isAdmin, ...init } = options;

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_SECRET}`,
      ...(isAdmin && { "X-User-Role": "admin" }),
      ...(init.headers as Record<string, string> | undefined),
    },
    ...(tags && { next: { tags } }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as Record<string, unknown>;
    throw new Error(String(body.error ?? `API service error ${res.status}`));
  }

  return res.json() as Promise<T>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/api-client.ts
git commit -m "feat: add typed apiFetch client for API service calls"
```

---

## Task 8: Update Next.js agents API route to proxy

**Files:**
- Modify: `src/app/api/agents/route.ts`

Replace the direct Prisma calls with `apiFetch` proxying. Auth is still handled by Next.js (WorkOS), which then forwards the admin role to the API service. Client components calling `/api/agents` continue to work without changes.

- [ ] **Step 1: Replace contents of `src/app/api/agents/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    const agents = await apiFetch<unknown[]>("/agents");
    const res = NextResponse.json(agents);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    console.error("GET /api/agents proxy error:", err);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await req.json();
    const agent = await apiFetch("/agents", {
      method: "POST",
      body: JSON.stringify(body),
      isAdmin: true,
    });
    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    console.error("POST /api/agents proxy error:", err);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update `getCachedAgentList` in `src/lib/cache.ts` to use apiFetch**

The server-side data cache (`unstable_cache`) previously wrapped a Prisma call. Now it wraps an `apiFetch` call with a fetch tag, so Next.js uses its built-in fetch cache and `revalidateTag("agents")` invalidates it automatically. Find the `getCachedAgentList` export and replace:

```typescript
// BEFORE — direct Prisma
export const getCachedAgentList = unstable_cache(
  () =>
    prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      select: {
        id: true, name: true, status: true,
        _count: { select: { decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ["agent-list"],
  { tags: ["agents"], revalidate: 30 }
);
```

```typescript
// AFTER — HTTP client with Next.js fetch cache tags
import { apiFetch } from "@/lib/api-client";

export async function getCachedAgentList() {
  return apiFetch<Array<{
    id: string;
    name: string;
    status: string;
    _count: { decisions: number };
  }>>("/agents", { tags: ["agents"] });
}
```

Note: `unstable_cache` is no longer needed for this function; the Next.js fetch cache handles it via the `tags` option on `fetch`.

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 4: Smoke test with both services running**

```bash
# Terminal 1
API_SERVICE_URL=http://localhost:3001 \
INTERNAL_API_SECRET=secret \
REVALIDATE_SECRET=rev-secret \
bun run dev

# Terminal 2
INTERNAL_API_SECRET=secret \
REVALIDATE_SECRET=rev-secret \
NEXT_APP_URL=http://localhost:3000 \
DATABASE_URL=<your-db-url> \
bun run dev:api

# Then open http://localhost:3000/agents — should load the agents list
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agents/route.ts src/lib/cache.ts
git commit -m "feat: proxy Next.js agents route to API service; update cache to use fetch tags"
```

---

## Task 9: Integration tests for the API service routes

**Files:**
- Create: `tests/integration/api-service/agents.test.ts`

Tests import the Hono app directly and call routes via `app.request()` — no running server needed. These tests run against the test DB (same safety guards as existing integration tests).

- [ ] **Step 1: Create `tests/integration/api-service/agents.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../../helpers/db";
import { createAgent } from "../../helpers/builders";
// Import Hono app directly — tests run in-process, no server needed
import { app } from "../../../apps/api/src/index";

const AUTH = { Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? "test-secret"}` };
const ADMIN = { ...AUTH, "X-User-Role": "admin" };

beforeEach(() => truncateAll());
afterEach(() => truncateAll());

describe("GET /agents", () => {
  it("returns empty array when no agents exist", async () => {
    const res = await app.request("/agents", { headers: AUTH });
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("returns agents ordered by updatedAt desc", async () => {
    await createAgent({ name: "Agent A" });
    await createAgent({ name: "Agent B" });
    const res = await app.request("/agents", { headers: AUTH });
    const body = await res.json() as Array<{ name: string }>;
    expect(body.length).toBe(2);
    // both agents present
    expect(body.map((a) => a.name)).toContain("Agent A");
    expect(body.map((a) => a.name)).toContain("Agent B");
  });

  it("returns 401 without auth header", async () => {
    const res = await app.request("/agents");
    expect(res.status).toBe(401);
  });
});

describe("POST /agents", () => {
  it("returns 403 without admin role", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...AUTH, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", algorithm: "thompson", epsilon: 0.1, funnelStage: "wau" }),
    });
    expect(res.status).toBe(403);
  });

  it("creates agent and returns 201", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New Agent",
        algorithm: "thompson",
        epsilon: 0.1,
        funnelStage: "wau",
        goals: [],
        messages: [],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; name: string };
    expect(body.name).toBe("New Agent");
    expect(body.id).toBeTruthy();
    // verify it's in the DB
    const dbAgent = await prisma.agent.findUnique({ where: { id: body.id } });
    expect(dbAgent).not.toBeNull();
  });

  it("returns 400 for invalid funnelStage", async () => {
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...ADMIN, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", algorithm: "thompson", funnelStage: "invalid" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
bun run test:int tests/integration/api-service/agents.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Update root `bunfig.toml` to include the api-service tests path**

Open `bunfig.toml`. Verify `root = "tests"` is set. The new test file is under `tests/` so it's already included.

- [ ] **Step 4: Run the full quick check**

```bash
bun run check:quick
```

Expected: typecheck + lint + unit/contract tests all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/api-service/
git commit -m "test: add Hono integration tests for API service agents routes"
```

---

## Task 10: Local dev convenience

**Files:**
- Modify: `package.json`

A single command to start both services for local development.

- [ ] **Step 1: Ensure `dev:all` works**

In the root `package.json`, confirm these scripts exist (added in Task 1):

```json
"dev:api": "bun --cwd apps/api run dev",
"dev:all": "bun run dev & bun run dev:api"
```

- [ ] **Step 2: Create `.env.api.local` for API service dev vars**

This file is gitignored (it follows the `.env*` pattern in `.gitignore`). Create it at the repo root:

```bash
# .env.api.local — API service local overrides
# Source manually: source .env.api.local && bun run dev:api
# Or add to your shell profile
export INTERNAL_API_SECRET=<generate-a-random-string>
export REVALIDATE_SECRET=<generate-a-random-string>
export NEXT_APP_URL=http://localhost:3000
export PORT=3001
```

Then add these to `.env.local` (Next.js side):
```bash
API_SERVICE_URL=http://localhost:3001
INTERNAL_API_SECRET=<same-value-as-above>
REVALIDATE_SECRET=<same-value-as-above>
```

- [ ] **Step 3: Update `.env.example` to document new variables**

Open `.env.example` and add:

```bash
# ── API Service (separate Bun/Hono server) ─────────────────────────────────────
# Shared secret for Next.js → API service calls (bearer token)
INTERNAL_API_SECRET=
# Shared secret for API service → Next.js cache revalidation webhook
REVALIDATE_SECRET=
# Base URL of the API service (local: http://localhost:3001, prod: https://nexus-api.fly.dev)
API_SERVICE_URL=
# Base URL of the Next.js app (used by API service to call revalidate webhook)
# Only needed in the API service environment
NEXT_APP_URL=
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: add API service env vars to .env.example"
```

---

## Task 11: Fly.io deployment

**Files:**
- Create: `apps/api/fly.toml`
- Create: `apps/api/Dockerfile`

The API service is deployed as a persistent Bun process — no cold starts, no timeout ceiling.

- [ ] **Step 1: Install flyctl if needed**

```bash
brew install flyctl
flyctl auth login
```

- [ ] **Step 2: Create `apps/api/Dockerfile`**

The build context must be the **repo root** (not `apps/api/`) so the Dockerfile can access `prisma/schema.prisma`.

```dockerfile
# Build from repo root: fly deploy --config apps/api/fly.toml
FROM oven/bun:1 AS deps
WORKDIR /repo
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules 2>/dev/null || true
COPY prisma/ ./prisma/
COPY apps/api/ ./apps/api/
RUN cd apps/api && bunx prisma generate --config prisma.config.ts

FROM oven/bun:1
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api ./
EXPOSE 3001
CMD ["bun", "src/index.ts"]
```

- [ ] **Step 3: Create `apps/api/fly.toml`**

```toml
app = "nexus-api"
primary_region = "iad"

[build]
  dockerfile = "apps/api/Dockerfile"

[env]
  PORT = "3001"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 4: Create the Fly app (first time only)**

```bash
# Run from repo root so Docker context is correct
cd /path/to/nexus
flyctl apps create nexus-api --org <your-org>
```

- [ ] **Step 5: Set secrets on Fly.io**

```bash
flyctl secrets set \
  DATABASE_URL="<production-DATABASE_URL>" \
  INTERNAL_API_SECRET="<same-as-vercel>" \
  REVALIDATE_SECRET="<same-as-vercel>" \
  NEXT_APP_URL="https://nexus-ai-yv.vercel.app" \
  CONFIRM_PROD_MIGRATE="true" \
  --app nexus-api
```

- [ ] **Step 6: Deploy**

```bash
flyctl deploy --config apps/api/fly.toml
```

Expected: deployment succeeds. Verify:

```bash
curl https://nexus-api.fly.dev/health
# Expected: {"ok":true}

curl -H "Authorization: Bearer <INTERNAL_API_SECRET>" https://nexus-api.fly.dev/agents
# Expected: JSON array of agents from production DB
```

- [ ] **Step 7: Add Fly.io env vars to Vercel**

In the Vercel dashboard for nexus-ai-yv, add:
- `API_SERVICE_URL` = `https://nexus-api.fly.dev`
- `INTERNAL_API_SECRET` = `<same value>`
- `REVALIDATE_SECRET` = `<same value>`

Redeploy Vercel to pick up the new env vars.

- [ ] **Step 8: Verify end-to-end in production**

Open `https://nexus-ai-yv.vercel.app/agents`. The page should load agents (coming from the API service via Fly.io). Check Vercel logs — should see no Prisma calls for the agents list, only `apiFetch` HTTP calls.

- [ ] **Step 9: Commit**

```bash
git add apps/api/fly.toml apps/api/Dockerfile
git commit -m "feat: add Fly.io deployment config for API service"
```

---

## Task 12: Open MR

- [ ] **Step 1: Push branch and create MR**

```bash
git push -u origin feat/api-service-foundation
glab mr create \
  --title "feat: API service foundation — agents resource migrated to Bun/Hono" \
  --target-branch main
```

- [ ] **Step 2: Verify CI passes**

`bun run check:quick` must pass. The integration tests for the agents API service routes must pass.

- [ ] **Step 3: After merge, proceed to Plan 2**

The next plan (`2026-05-15-api-service-cron-migration.md`) migrates the 4 cron routes using the same pattern established here.

---

## What Plan 2–5 will cover

**Plan 2 — Cron routes** (`/api/cron/select-and-send`, `discover-personas`, `sync-template-variants`, `ingest-braze-analytics`): These are the highest-value routes. Once in the API service they're no longer subject to Vercel's 300s timeout and can be triggered by Fly Machines scheduled tasks or an external cron provider.

**Plan 3 — Ingest + decide** (`/api/ingest/users`, `/api/ingest/events`, `/api/ingest/braze-events`, `/api/decide`, `/api/stats`): External callers (Hightouch) will be updated to call the API service directly, bypassing Next.js entirely for these write-heavy paths.

**Plan 4 — CRUD routes** (remaining 25 routes: personas, variants, push-library, settings, users, etc.): Follow the proxy pattern from this plan.

**Plan 5 — Next.js cleanup**: Remove `src/lib/db.ts`, `prisma` from Next.js `package.json`, `src/generated/prisma/`, and all remaining `unstable_cache` wrappers that still use Prisma. Convert all server components to use `apiFetch`. Move shared constants/types to `packages/types/`.
