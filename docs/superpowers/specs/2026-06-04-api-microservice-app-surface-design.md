# API Microservice — App-Surface Boundary (Design)

> Supersedes the deploy-target and scope assumptions in
> `docs/superpowers/plans/2026-05-15-api-service-foundation.md`. That doc's
> architecture (Bun/Hono service owning Prisma, `apiFetch` client, revalidate
> webhook) still holds; this doc narrows the **scope** and changes the
> **deploy target** based on two decisions made 2026-06-04.

## Goal

The Next.js app stops querying Postgres directly for **user-facing reads and
writes**. It calls the standalone Hono service in `apps/api/` over HTTP. Only
`nexus-api` holds `DATABASE_URL`, giving a real network + credential boundary
that is easy to audit: the app *literally cannot* reach the database for the
surfaces behind the boundary.

## Two decisions (2026-06-04)

1. **Scope = app surface only.** Server Components and user-facing CRUD route
   handlers go through `apiFetch`. **Cron and ingest keep direct Prisma access**
   — they are high-volume / tight-timeout jobs that gain nothing from an HTTP
   hop and would only add failure modes.
2. **Deploy = second Vercel project (`nexus-api`), not Fly.io.** No separate
   vendor or bill; billed under the existing Vercel account. Cold starts are
   handled by Fluid Compute (instance reuse) plus a generous `apiFetch` timeout
   and route `maxDuration`. The Fly deploy path is removed to eliminate the
   dual-target conflict.

## Current state of the scaffold

Already built and partially wired:

- `apps/api/` — Bun/Hono service. `src/app.ts` mounts `logger`, a public
  `/health`, `serviceAuth` (bearer `INTERNAL_API_SECRET`) on `*`, and
  `/agents`. `src/index.ts` is the **local-dev** Bun entry (`Bun.serve`).
  `apps/api/api/index.ts` is the **Vercel** entry
  (`getRequestListener(app.fetch)` from `@hono/node-server`).
- `apps/api/vercel.json` (framework null, rewrites `/(.*)` → `/api/index`),
  `apps/api/.vercel/project.json` (linked to real Vercel project `nexus-api`),
  `apps/api/public/.gitkeep`.
- `apps/api/src/routes/agents.ts` — `GET /agents` + `POST /agents`.
- `src/lib/api-client.ts` — `apiFetch<T>` with `ApiError`, `timeout` (5 s
  default), `tags`/`revalidate`, `isAdmin` → `X-User-Role: admin`.
- `src/app/api/revalidate/route.ts` — Next.js webhook for `revalidateTag`.
- `src/app/api/agents/route.ts` — **GET already proxies** via `apiFetch`;
  **POST still uses direct Prisma**.

Conflicting / stale pieces to fix:

- `apps/api/fly.toml` + `apps/api/Dockerfile` — Fly path, to be **removed**.
- `apps/api/src/routes/agents.ts` `POST` is **stale**: it predates the recent
  `segmentTargeting` / `targetSegmentName` / multi-segment work and the
  `uniqueUsersCap` (default 1000) / `dailySendCap` (default 500) defaults that
  now live in `src/app/api/agents/route.ts`. The Next.js route is the source of
  truth and must be ported verbatim, including the 409 segment-uniqueness
  conflict checks and the `agentPersonaTarget.createMany` follow-up.

## Architecture (unchanged)

```
Browser ──> Next.js (Vercel: nexus-ai-yv)         apiFetch (HTTP + Bearer)
              │  Server Components + /api/* routes  ───────────────┐
              │  WorkOS auth, no DATABASE_URL                      ▼
              │                                        nexus-api (Vercel project)
              │  /api/revalidate  <── revalidate webhook ── Hono + Prisma + Neon
              ▼                                               (sole DATABASE_URL holder)
        revalidateTag(tag)
```

- Auth: Next.js verifies the WorkOS session, then calls `apiFetch` with the
  shared `INTERNAL_API_SECRET` bearer token; admin mutations add
  `X-User-Role: admin`, which the Hono `isNotAdmin` guard enforces.
- Cache coherence: API mutations call the Next.js `/api/revalidate` webhook
  (`REVALIDATE_SECRET`) → `revalidateTag`, so tagged Server Component reads
  refresh after writes.

## Out of scope (keep direct Prisma)

- `src/app/api/cron/*` (select-and-send, discover-personas,
  sync-template-variants, ingest-braze-analytics)
- `src/app/api/ingest/*` (events, users — the multi-million-row syncs),
  `/api/decide`, `/api/stats` if write-heavy
- The bandit engine (`src/lib/engine/*`) — pure, no DB/IO, untouched
- Removing Prisma from Next.js entirely (cron/ingest still need it)

## Migration steps (each = branch + MR + merge, with tests)

1. **Deploy-target cleanup + finish agents POC.** Delete `apps/api/fly.toml`
   and `apps/api/Dockerfile`. Port the full current `POST /agents` logic from
   `src/app/api/agents/route.ts` into `apps/api/src/routes/agents.ts`
   (segmentTargeting, targetSegmentName, caps defaults, 409 conflict checks,
   persona-target createMany, revalidate). Replace the Next.js `POST` body with
   an `apiFetch("/agents", { method: "POST", isAdmin: true, body })` proxy and
   drop the `prisma` import from that route. Keep WorkOS `requireAdmin()` in
   Next.js.
2. **Messages + variants** route handlers + their Server Components → `apiFetch`.
3. **Personas + goals + scheduling + settings** route handlers + Server
   Components → `apiFetch`.
4. **Sweep + guard.** Confirm no app-surface (non-cron, non-ingest) module
   imports `@/lib/db` / `prisma`. Add a lint or test guard that fails if an
   app-surface file imports Prisma directly.

## Testing

- API side: in-process Hono tests via `app.request()` against the local test DB
  (`tests/integration/api-service/*`), using `tests/helpers/builders.ts`.
- Next side: integration tests with `apiFetch` mocked, asserting `{data}` /
  `{error}` shape and status passthrough (`ApiError.status`).
- Regression tests where a Server Component depends on specific fields returned
  by the API (pin the field names).

## Deploy (Vercel `nexus-api`)

- Project already exists (`.vercel/project.json`). Deploy from `apps/api/`
  (`vercel --prod`) or wire the dir to the project's git integration.
- Env vars: `nexus-api` gets `DATABASE_URL`, `INTERNAL_API_SECRET`,
  `REVALIDATE_SECRET`, `NEXT_APP_URL`. The Next.js project (`nexus-ai-yv`) gets
  `API_SERVICE_URL` (= the nexus-api deployment URL), `INTERNAL_API_SECRET`,
  `REVALIDATE_SECRET` — and, for the migrated surfaces, **no longer needs**
  `DATABASE_URL` once cron/ingest are the only Prisma consumers left (they
  still need it, so it stays for now).
- `maxDuration` already 15 on the agents route; keep generous on proxy routes.
```
