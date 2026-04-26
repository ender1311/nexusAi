# Nexus - CLAUDE.md

## Commands

**After significant code changes, always run:**
```bash
bun run check    # lint + typecheck (run this before considering a task done)
```

```bash
bun run dev        # Start dev server (Next.js on port 3000)
bun run build      # Production build
bun run start      # Start production server
bun run lint       # ESLint only
bun run typecheck  # tsc --noEmit only
bun run check      # lint + typecheck together

# Database
npx prisma migrate dev   # Run migrations (uses prisma.config.ts)
npx prisma generate      # Regenerate Prisma client
npx prisma studio        # Browse DB in browser
```

## Architecture

**Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Prisma v7 + PostgreSQL (Neon), Recharts, shadcn/ui components.

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
      [id]/goals/        # Goal management for an agent
      [id]/messages/     # Message variant management
      [id]/performance/  # Per-agent performance analytics
      [id]/scheduling/   # Scheduling rule UI
      new/               # Agent creation wizard
    control-tower/       # AI optimization command center
    demo/                # Educational demo (feature vector + persona clustering, mock data)
    messages/            # Message & variant pages
    personas/            # Persona pages
    performance/         # Performance analytics page
    settings/            # Settings page (Braze config, persona discovery)
  components/
    agents/              # Agent-specific components
    charts/              # Recharts wrappers (MetricCard, TimeSeriesChart, etc.)
    control-tower/       # Control tower UI components
    goals/               # Goal management components
    layout/              # Header, sidebar, shell
    messages/            # Message & variant form components
    performance/         # Performance chart components
    personas/            # Persona-specific components
    scheduling/          # Scheduling rule UI components
    settings/            # Settings page components
    ui/                  # shadcn/ui primitives (badge, card, dialog, etc.)
  lib/
    braze/               # Braze REST client, payload factory, analytics
    engine/              # Bandit engine: thompson-sampling, epsilon-greedy,
                         # reward-calculator, feature-vector, persona-assignment,
                         # persona-discovery, user-stats, variant-diff,
                         # frequency-resolver, types
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

**Database models:** Agent -> Goal[], Message -> MessageVariant[], UserDecision, User, Persona, AgentPersonaTarget, PersonaArmStats, SchedulingRule, ModelMetric, AppSetting. JSON fields (attributes, featureVector, channelStats, etc.) are stored as serialized JSON strings in PostgreSQL text columns.

## Database Setup

```bash
# First time setup
npx prisma migrate dev --name init

# DATABASE_URL must point to a PostgreSQL instance (Neon in prod/preview)
# prisma.config.ts reads DATABASE_URL env var for migrations
```

## Environment Variables

```bash
# Database — PostgreSQL (Neon in prod/preview; local Postgres for dev)
DATABASE_URL=postgresql://user:password@host/dbname

# Ingest API auth (required for Hightouch → Nexus event/user sync)
HIGHTOUCH_API_KEY=...

# Braze integration (optional — app runs without them)
BRAZE_API_KEY=...
BRAZE_REST_URL=rest.iad-01.braze.com   # or your cluster's REST endpoint

# Braze app IDs (stored in AppSetting table via Settings UI)
BRAZE_ANDROID_APP_ID=...
BRAZE_IOS_APP_ID=...
BRAZE_WEB_APP_ID=...
BRAZE_APP_GROUP_ID=...
```

Braze credentials can also be configured through the Settings UI (`/settings`), which persists them to the `AppSetting` table. The `createBrazeClient()` function reads from `process.env` at runtime; the settings UI saves to DB and the `/api/settings` route syncs them.

## Engineering Standards

### TypeScript discipline
- **No `any`** — use `unknown` and narrow with type guards, or define an explicit union/interface. `as any` is a bug waiting to happen.
- All API route handlers must type their request params and return `NextResponse<T>` with an explicit type argument.
- JSON fields from the DB (`User.attributes`, `Persona.traits`, etc.) must be parsed and validated immediately on read — never spread raw strings into typed objects. Use a helper or Zod schema.
- Prefer `type` over `interface` for pure data shapes; use `interface` only when extension/augmentation is needed.

### API design contracts
- Every route returns `{ data: T }` on success or `{ error: string }` on failure with the correct HTTP status code.
- Validate all input at the route boundary before any DB access — reject bad payloads with 400, not a 500 from a Prisma constraint error.
- Never surface Prisma error messages, stack traces, or internal IDs in HTTP responses. Log server-side, return a generic error string to the client.
- Use explicit HTTP status codes: 200/201 for success, 400 for bad input, 401/403 for auth, 404 for missing resources, 500 for unexpected errors.

### React / Next.js component design
- **No business logic in components** — components orchestrate UI; `lib/` computes. Move calculations, data transforms, and algorithm calls into `lib/`.
- Fetch data in the nearest Server Component and pass it as props. Don't reach for `useEffect` + `useState` for data fetching that could be server-side.
- Use `loading.tsx` / `Suspense` for async segments instead of client-side loading spinners where possible.
- Keep `"use client"` boundaries as leaf nodes. A parent Server Component passing data to a small client child is the correct pattern.

### Correctness over cleverness
- Prefer explicit over terse — a clear 3-line `if/else` beats a clever one-liner that requires a comment to understand.
- Delete dead code rather than commenting it out. Git history is the undo button.
- Name things for what they represent, not how they're implemented (`getEligibleVariants` not `filterLoop`).
- Don't add error handling, fallbacks, or validation for impossible paths. Trust the type system and internal invariants.

### Engine / algorithmic code
- Bandit engine functions (`reward-calculator`, `thompson-sampling`, `epsilon-greedy`, `persona-discovery`) must remain **pure** — no DB calls, no side effects, no global state — so they stay unit-testable in isolation.
- Side effects (DB writes, API calls, logging) belong in API route handlers and service layer functions, never in component render paths or engine logic.
- When touching statistical logic, leave a comment with the formula/reference so reviewers can verify correctness without re-deriving it.

## Testing

- Every new API endpoint → integration test in `tests/integration/`
- Every new engine function → unit test in `tests/unit/`
- Every bug fix → regression test in `tests/regression/` with a comment linking to the bug
- Run `bun run test:quick` during development (unit + contract, no DB)
- Run `bun run check` before opening an MR (typecheck + lint + full test suite)
- CI enforces all checks — MRs with failing pipelines are not merged
- `tests/helpers/builders.ts` contains DB factory functions; use them instead of raw `prisma.create` calls in tests
