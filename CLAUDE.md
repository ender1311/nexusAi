# Nexus - CLAUDE.md

## Commands

**After significant code changes, always run:**
```bash
npm run check    # lint + typecheck (run this before considering a task done)
```

```bash
npm run dev        # Start dev server (Next.js on port 3000)
npm run build      # Production build
npm run start      # Start production server
npm run lint       # ESLint only
npm run typecheck  # tsc --noEmit only
npm run check      # lint + typecheck together

# Database
npx prisma migrate dev   # Run migrations (uses prisma.config.ts)
npx prisma generate      # Regenerate Prisma client
npx prisma studio        # Browse DB in browser
```

## Architecture

**Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Prisma v7 + SQLite (via libsql), Recharts, shadcn/ui components.

**Directory structure:**
```
src/
  app/                   # Next.js App Router pages
    api/                 # Route handlers
      agents/            # CRUD + metrics endpoints
      personas/          # CRUD + /discover endpoint
      ingest/            # /events and /users ingestion endpoints
      settings/          # App settings (Braze keys, etc.)
    agents/              # Agent management pages
    messages/            # Message & variant pages
    personas/            # Persona pages
    performance/         # Performance analytics page
    settings/            # Settings page (Braze config, persona discovery)
  components/
    agents/              # Agent-specific components
    charts/              # Recharts wrappers (MetricCard, TimeSeriesChart, etc.)
    layout/              # Header, sidebar, shell
    personas/            # Persona-specific components
    ui/                  # shadcn/ui primitives (badge, card, dialog, etc.)
  lib/
    braze/               # Braze REST client, payload factory, analytics
    engine/              # Bandit engine: thompson-sampling, epsilon-greedy,
                         # reward-calculator, feature-vector, persona-assignment,
                         # persona-discovery, user-stats, types
    mock/                # Static mock data (agents, personas, metrics)
    db.ts                # Prisma client singleton
    utils.ts             # cn(), formatNumber(), formatDate()
  generated/prisma/      # Auto-generated Prisma client (do not edit)
  types/                 # Shared TypeScript interfaces
```

**Bandit engine (`src/lib/engine/`):**
- Two algorithms: Thompson Sampling (`thompson-sampling.ts`) and Epsilon-Greedy (`epsilon-greedy.ts`)
- Each agent stores per-arm Beta distribution stats (`alpha`/`beta`) in `PersonaArmStats` table, segmented by persona
- `reward-calculator.ts` maps conversion events to scalar rewards using goal tiers and weights
- `persona-discovery.ts` runs k-means clustering on user feature vectors to discover personas
- `persona-assignment.ts` assigns users to nearest persona centroid

**Braze integration (`src/lib/braze/`):**
- `client.ts`: `BrazeClient` wraps REST API (POST/GET); `createBrazeClient()` returns null when env vars missing (graceful degradation)
- `payload-factory.ts`: Builds channel-specific send payloads (push, email, in-app)
- `analytics.ts`: Fetches campaign/send analytics from Braze for reward ingestion
- Config (API key, REST URL, app IDs) stored in `AppSetting` DB table and read via `/api/settings`

## Key Conventions

**Path alias:** `@/` maps to `src/` (configured in `tsconfig.json`).

**shadcn/ui:** Components live in `src/components/ui/`. Use `cn()` from `@/lib/utils` for conditional class merging. Add new shadcn components via `npx shadcn add <component>`.

**Mock vs real data:** The dashboard and most read-heavy pages currently use static mock data from `src/lib/mock/` (agents, personas, metrics). API routes use real Prisma/DB. When wiring up a page to real data, replace mock imports with `fetch('/api/...')` calls or direct Prisma queries in Server Components.

**Server vs client components:** Default to Server Components. Add `"use client"` only for interactivity (state, effects, event handlers). API routes are in `src/app/api/`.

**Database models:** Agent -> Goal[], Message -> MessageVariant[], UserDecision, User, Persona, PersonaArmStats, SchedulingRule, ModelMetric, AppSetting. JSON fields (attributes, featureVector, channelStats, etc.) are stored as serialized strings in SQLite.

## Database Setup

```bash
# First time setup
npx prisma migrate dev --name init

# The DB file is created at ./prisma/dev.db (or path from DATABASE_URL)
# prisma.config.ts reads DATABASE_URL env var for migrations
```

## Environment Variables

```bash
# Required for Braze integration (optional — app runs without them)
BRAZE_API_KEY=...
BRAZE_REST_URL=rest.iad-01.braze.com   # or your cluster's REST endpoint

# Optional — Braze app IDs (stored in AppSetting table via Settings UI)
BRAZE_ANDROID_APP_ID=...
BRAZE_IOS_APP_ID=...
BRAZE_WEB_APP_ID=...
BRAZE_APP_GROUP_ID=...

# Database (defaults to file:./prisma/dev.db if not set)
DATABASE_URL=file:./prisma/dev.db
```

Braze credentials can also be configured through the Settings UI (`/settings`), which persists them to the `AppSetting` table. The `createBrazeClient()` function reads from `process.env` at runtime; the settings UI saves to DB and the `/api/settings` route syncs them.
