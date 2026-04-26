# Nexus — Agent Guide

Multi-armed bandit optimization platform for personalizing Braze messages across user personas.

## Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS v4 · Prisma v7 + PostgreSQL (Neon) · shadcn/ui · Recharts

## Commands

```bash
bun run check      # lint + typecheck — run after every code change
bun run dev        # dev server on port 3000
bun run build      # production build
npx prisma migrate dev   # run DB migrations
npx prisma generate      # regenerate Prisma client after schema changes
npx prisma studio        # browse DB in browser
```

## Project Structure

```
src/
  app/
    api/
      agents/          # CRUD + metrics
      personas/        # CRUD + /discover (k-means clustering)
      ingest/          # /events and /users (Hightouch ingestion)
      settings/        # Braze keys + app config
    agents/            # Agent management UI
    personas/          # Persona management UI
    performance/       # Analytics
    settings/          # Settings UI
    control-tower/     # AI optimization command center
  components/
    agents/            # Agent-specific components
    charts/            # Recharts wrappers
    layout/            # Header, sidebar, shell
    personas/          # Persona components
    ui/                # shadcn/ui primitives
  lib/
    engine/            # Bandit algorithms + persona ML
    braze/             # Braze REST client + payload factory
    mock/              # Static mock data (used by most read pages)
    db.ts              # Prisma singleton
    utils.ts           # cn(), formatNumber(), formatDate()
  types/               # Shared TypeScript interfaces
  generated/prisma/    # Auto-generated — do not edit
```

## Key Conventions

- **Path alias:** `@/` → `src/`
- **Components:** Default to Server Components. Add `"use client"` only for interactivity.
- **Mock vs real:** Most dashboard pages use `src/lib/mock/` static data. API routes use real Prisma. To wire a page to real data, replace mock imports with `fetch('/api/...')` calls.
- **JSON fields:** `User.attributes`, `User.featureVector`, `User.channelStats`, `Persona.traits`, scheduling rule fields — all stored as serialized JSON strings in PostgreSQL text columns.
- **shadcn/ui:** Add components via `npx shadcn add <component>`. Use `cn()` from `@/lib/utils`.
- **Braze:** `createBrazeClient()` returns `null` if env vars are missing — always null-check before calling.

## Database Models

```
Agent → Goal[], Message → MessageVariant[], UserDecision
User → Persona (assigned), PersonaArmStats (per agent×variant×persona)
SchedulingRule (1:1 with Agent), ModelMetric, AppSetting
```

## Bandit Engine (`src/lib/engine/`)

- `thompson-sampling.ts` — Beta distribution sampling (α/β per arm)
- `epsilon-greedy.ts` — ε-explore / best-arm exploit
- `reward-calculator.ts` — maps event name → goal tier → scalar reward (-1 to +1)
- `feature-vector.ts` — 37-dim user vector (channel rates, timing histograms, frequency, reward)
- `persona-discovery.ts` — k-means++ clustering to create Persona records
- `persona-assignment.ts` — cosine similarity to assign users to nearest persona
- `user-stats.ts` — accumulates per-user channel/hour/day stats on conversion

## Ingest API (Hightouch → Nexus)

```
POST /api/ingest/users   — upsert user profiles
POST /api/ingest/events  — conversion events → reward loop
Auth: Authorization: Bearer <HIGHTOUCH_API_KEY>
```

Event flow: event arrives → match UserDecision (48h window) → calculate reward → update arm stats (α/β).

## Environment Variables

```bash
DATABASE_URL=postgresql://user:password@host/dbname   # PostgreSQL (Neon in prod)
HIGHTOUCH_API_KEY=       # shared secret for Hightouch auth
BRAZE_API_KEY=
BRAZE_REST_URL=rest.iad-01.braze.com
BRAZE_ANDROID_APP_ID=
BRAZE_IOS_APP_ID=
BRAZE_WEB_APP_ID=
BRAZE_APP_GROUP_ID=
```

## Engineering Standards

**TypeScript**
- No `any` — use `unknown` + type guards, or explicit unions. `as any` is a bug.
- JSON DB fields (`User.attributes`, `Persona.traits`, etc.) must be parsed and validated on read, never spread as raw strings into typed objects.
- API routes must type their return as `NextResponse<{ data: T } | { error: string }>`.

**API contracts**
- All routes return `{ data: T }` on success or `{ error: string }` on failure.
- Validate input at the route boundary before any DB access — reject bad payloads with 400.
- Never surface Prisma errors, stack traces, or internal IDs in HTTP responses.

**React / Next.js**
- No business logic in components — components orchestrate, `lib/` computes.
- Fetch in Server Components and pass data as props; avoid `useEffect` for data fetching.
- Keep `"use client"` at leaf nodes; minimize client/server boundary surface.

**Correctness**
- Explicit over clever — a clear 3-line `if` beats a terse one-liner needing a comment.
- Delete dead code; don't comment it out.
- No error handling for impossible paths — trust the type system and internal invariants.

**Engine / algorithmic code**
- Bandit engine functions must stay **pure** (no DB, no side effects) to remain unit-testable.
- Side effects (DB writes, Braze calls) belong in route handlers, not engine logic or render paths.
- Leave a formula/reference comment on any non-trivial statistical operation.

## Architecture Docs

Detailed Mermaid diagrams in `docs/`:
- `docs/system-overview.md` — full system + integrations
- `docs/data-model.md` — ER diagram of all DB models
- `docs/bandit-engine.md` — algorithm flows
- `docs/data-flows.md` — sequence diagrams for all key operations
- `docs/api-routes.md` — all endpoints + request/response shapes
- `docs/persona-discovery.md` — k-means + feature vector details
- `docs/braze-integration.md` — Braze client + payload factory

## Testing

- Unit tests → `tests/unit/` (pure functions, no DB)
- Contract tests → `tests/contracts/` (external service boundaries)
- Integration tests → `tests/integration/` (routes + real Neon test DB)
- Regression tests → `tests/regression/` (named bug-prevention tests)
- Quick check: `bun run test:quick` (unit + contracts, fast, no DB required)
- Full check: `bun run check` (typecheck + lint + all tests — run before MR)
- New feature = new test. New bug fix = new regression test.
