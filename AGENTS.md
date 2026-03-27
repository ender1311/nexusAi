# Nexus — Agent Guide

Multi-armed bandit optimization platform for personalizing Braze messages across user personas.

## Stack

Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS v4 · Prisma v7 + SQLite · shadcn/ui · Recharts

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
- **JSON fields:** `User.attributes`, `User.featureVector`, `User.channelStats`, `Persona.traits`, scheduling rule fields — all stored as serialized JSON strings in SQLite.
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
Auth: Authorization: Bearer <INGEST_API_KEY>
```

Event flow: event arrives → match UserDecision (48h window) → calculate reward → update arm stats (α/β).

## Environment Variables

```bash
DATABASE_URL=file:./prisma/dev.db
INGEST_API_KEY=          # shared secret for Hightouch auth
BRAZE_API_KEY=
BRAZE_REST_URL=rest.iad-01.braze.com
BRAZE_ANDROID_APP_ID=
BRAZE_IOS_APP_ID=
BRAZE_WEB_APP_ID=
BRAZE_APP_GROUP_ID=
```

## Architecture Docs

Detailed Mermaid diagrams in `docs/`:
- `docs/system-overview.md` — full system + integrations
- `docs/data-model.md` — ER diagram of all DB models
- `docs/bandit-engine.md` — algorithm flows
- `docs/data-flows.md` — sequence diagrams for all key operations
- `docs/api-routes.md` — all endpoints + request/response shapes
- `docs/persona-discovery.md` — k-means + feature vector details
- `docs/braze-integration.md` — Braze client + payload factory
