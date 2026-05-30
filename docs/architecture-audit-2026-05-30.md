# Nexus Architecture Audit & Refactor Plan — 2026-05-30

> Full read-only audit by 5 parallel reviews (engine, cron/ingest, API layer,
> pages/caching, components/cross-cutting). Goal: simpler, efficient, clean
> separation of concerns, enterprise discipline, kill tech debt, make future
> work easy. This doc is the **plan** — nothing here has been changed yet.
> Severity: HIGH = structural/correctness/risk, MED = real debt, LOW = polish.

---

## Executive summary — the five cross-cutting themes

1. **God-objects with no seams.** The cron route (1711 lines), `decide.ts`
   (`decideForUser`, 236 lines / 7 concerns), `cache.ts` (701 lines / 7 domains),
   `agent-wizard.tsx` (1241) and `agent-sends-table.tsx` (1052) each fuse many
   responsibilities into one untestable unit. Same disease everywhere: no
   extraction seams.
2. **Two copies of the bandit decision path, already drifting.** The cron route
   re-implements `decide.ts` inline AND duplicates its own selection block twice.
   Beta priors, algorithm dispatch, scheduling checks now exist in 3+ places.
3. **No shared scaffolding in the API layer.** No `{data}/{error}` helper, no
   validation layer → ~half of 54 routes drift from the contract, hand-roll
   guards, and risk Prisma-500s on bad input. ~300–400 lines of duplicated
   boilerplate.
4. **Engine purity contract is violated.** 4 `lib/engine/` modules import
   `prisma` and do IO, contradicting the engine's own CLAUDE.md. Pure math and
   DB IO are interleaved, blocking unit tests.
5. **"Mock" is lying.** `lib/mock/personas.ts` and `lib/mock/control-tower.ts`
   feed *real* production surfaces (9 components + the Control Tower page).
   They're real logic/tokens mislabeled as mock — and fabricated predictions
   render as real product output.

The good news: the fixes compound. A shared `select-variant` kills theme #2 and
unblocks cron decomposition (#1); a `respond()`+Zod layer resolves most of #3 as
side effects; the engine purity split (#4) is mechanical.

---

## Sequenced refactor roadmap

Ordered for maximum leverage with controlled blast radius. Each wave is
independently shippable (own branch + MR + green `bun run check`). **Do not
batch into one mega-PR.**

### Wave 0 — Quick wins (low risk, do first, ~half a day)
- [ ] Add missing regression test: column-name test for the new `$queryRaw`
      decision-split in `agents/[id]/page.tsx:64-70` (`scheduledFor`/`agentId`).
      *(Required by CLAUDE.md; we added the query in MR #247 without it.)*
- [ ] Fix `Algorithm` union `types/agent.ts:36`: `"contextual"` → `"linucb"`;
      type the wizard's `form.algorithm` field as `Algorithm` (currently
      `string`, so the bug slips through). **Likely latent bug.**
- [ ] Delete dead code: `updateArm`/`initialStats` (thompson-sampling.ts:90-104,
      epsilon-greedy.ts:40-58), `decayEpsilon` (epsilon-greedy.ts:50), unused
      `LinUCBStats`/`LinUCBArm` interfaces (types.ts:28-40). Confirmed
      production-unused (real path is `arm-stats.ts upsertArmStats`).
- [ ] Delete empty `src/lib/guardrails/` directory.
- [ ] Remove unused deps: `@notionhq/client` (0 refs), `date-fns` (only in
      `next.config.ts optimizePackageImports`, no actual import) + drop it from
      the optimize list.
- [ ] Resolve `force-dynamic` vs `revalidate` contradictions (pick one per page):
      `app/page.tsx:1-2` (revalidate=14400 + force-dynamic),
      `control-tower/page.tsx:1-2` (revalidate=900 + force-dynamic),
      `personas/page.tsx`. `force-dynamic` makes `revalidate` dead config.
- [ ] Re-add `experimental.cpus: 4` to `next.config.ts` (memory: Next 16 OOMs CI
      by spawning workers = CPU count).

### Wave 1 — API scaffolding (high leverage, mechanical, low risk)
- [ ] `src/lib/api/respond.ts`: `ok<T>(data, status?)` → `NextResponse<{data:T}>`
      and `fail(message, status)` → `NextResponse<{error:string}>`. Map
      `P2025`→404, `P2002`→409 centrally.
- [ ] `src/lib/api/schemas/*.ts` (Zod per resource) + `parseBody(req, schema)`
      returning `{data}` or a 400. Start with `agent`, `goal`, `persona`,
      `scheduling`, `settings`.
- [ ] Migrate routes cluster by cluster to `respond()` + `parseBody()`. This one
      move fixes envelope drift, unguarded `req.json()` 500s, pre-DB validation
      gaps, `NextResponse<T>` typing, and the `as`-cast narrowing — all at once.
      ~300–400 lines deleted.
- [ ] Targeted fixes surfaced along the way: wrap `users/[externalId]/route.ts`
      (no try/catch at all) and `decide/route.ts:34` in error handling; stop
      echoing `err.message` in `personas/migrate/route.ts:188-192`; standardize
      on `requireAdmin()` (not inline `getAuth()`+403 in push-library routes).

### Wave 2 — Engine purity + shared strategy (unblocks everything ML)
- [ ] Split the 4 impure engine modules into pure core + IO shell:
      `persona-assignment.ts`, `persona-discovery.ts`, `user-stats.ts`,
      `template-sync.ts`. Pure parts (`clusterUsers`, `mergeChannelStats`, etc.)
      stay in `engine/`; `prisma` IO moves to a new `lib/persona-service.ts` /
      route handlers.
- [ ] Define `interface BanditStrategy<TArm> { select(arms, ctx) }` with a
      factory keyed on `agent.algorithm`; collapse the `isLinUCB` forks in
      `decide.ts` and `arm-stats.ts`.
- [ ] Extract `lib/engine/select-variant.ts` — pure
      `selectVariantForUser(armsByPersona, userArms, linucbArms, user, algorithm,
      recencyPenalties)`. **Both** `decide.ts` and the cron route call it. Kills
      theme #2.
- [ ] Zod-parse JSON DB fields at the read boundary (`quietHours`, `aInv`,
      `channelStats`, `attributes`, `frequencyCapOverride`) — replaces the
      `as unknown as` casts in decide/arm-stats/user-stats/persona-assignment.
- [ ] Dedupe `computeOptimalSendHour` (decide.ts:65) vs `peakActivityHour`
      (scheduling.ts:66).

### Wave 3 — Decompose the cron route (depends on Wave 2)
Target: `route.ts` shrinks from 1711 → ~150-line orchestrator. Extract pure,
unit-testable modules; DB writes stay in the orchestrator:
- [ ] `lib/cron/eligibility.ts` (272–407: segment/funnel/lang/stale filtering)
- [ ] `lib/cron/exploration-window.ts` (435–526: Phase-0 A–E classification, pure
      → `{toCreate, toReset, toClose, inWindowMap}`)
- [ ] `lib/cron/caps.ts` (580–661: audience/daily/unique caps + time-bucket
      Fisher-Yates)
- [ ] `lib/cron/suppression.ts` (805–955: freq/smart/quiet/channel/lang/target →
      suppression breakdown)
- [ ] `lib/cron/send-grouping.ts` (59–206, 1141–1211: `byVariant` + send)
- [ ] Replace the two byte-for-byte selection blocks (1006–1102, 1414–1500) with
      the Wave-2 `select-variant`.
- [ ] Move `blendArm` (route.ts:36-50) into `engine/`.
- [ ] Wire per-variant frequency caps (`frequency-resolver.ts` is currently
      unused by cron — per-variant caps are silently ignored).

### Wave 4 — Ingest batching (correctness + perf)
- [ ] `ingest/users/route.ts attributeEvents` (269–462): replace the per-event
      serial loop (~6 awaited DB calls × up to 1000 events) with the batch
      pattern already used in `ingest/events/route.ts:102-107` — pre-load
      processed IDs + candidate decisions/users, attribute in memory, `createMany`.
- [ ] Same loop's idempotency `create` (users:457) is fire-and-forget after
      `matched++` → failed write = double arm-credit on Hightouch retry. Make it
      part of the batch, not best-effort.
- [ ] Giving-attribution `findFirst` inside the user-sync chunk (754–849):
      pre-load per chunk.
- [ ] Wrap ingest/cron responses in the `{data}` envelope (Wave 1 helper).

### Wave 5 — cache.ts + page streaming
- [ ] Split `cache.ts` (701) by domain: `cache/agents.ts`, `cache/personas.ts`,
      `cache/dashboard.ts`, `cache/performance.ts`, `cache/segments.ts`. Shared
      TTL constants instead of ad-hoc 900/14400/86400.
- [ ] Move `getCachedBrazeStats` (cache.ts:566-616) out of the DB cache module
      into `lib/braze/analytics.ts` (keep the AbortController timeout).
- [ ] Make `agents/[id]/page.tsx` a synchronous shell: the 5-way page-level
      `Promise.all` (56-71) blocks the header/tabs; move the top-bar counts into
      their own Suspense boundary. Gate the admin-only `usedColors` query (60)
      behind `isAdmin` or fold into `getCachedAgent`.
- [ ] Wrap the two uncached full-table GROUP BYs in `agents/page.tsx:85-99` in
      `unstable_cache` (or scope to a recent window) — they scan all
      `UserDecision` rows on every 60s request.
- [ ] Fix the fragile `new Date(liftSince as unknown as string)` double-cast
      (`performance/page.tsx:42-46`).

### Wave 6 — Component decomposition + de-mock
- [ ] `agent-sends-table.tsx` (1052): extract bandit/confidence logic to tested
      lib (`lib/agent-sends/convergence-state.ts`, `confidence-from-scores.ts`,
      `pending-deadline.ts` — consolidate the 12h `LOCAL_TIME_BUFFER_MS` rule with
      `lib/agent-send-delivery-status.ts`); extract `useAgentSends()` hook; move
      formatters to lib; split sub-components into files.
- [ ] `agent-wizard.tsx` (1241): lift `FormData`/constants/presets to
      `lib/agent-wizard/`, split steps into `Step1…Step5` leaf components,
      extract `useAgentDraft()` hook, move payload build to
      `lib/agent-wizard/build-create-payload.ts` **shared with
      `agent-edit-sheet.tsx`** (both currently shape `segmentTargeting` +
      `funnelStage` override independently → drift risk on this very branch).
- [ ] De-mock the real surfaces: move `PERSONA_COLORS`/`PERSONA_ICON_MAP` out of
      `lib/mock/personas.ts` → `lib/persona-display.ts` (9 production consumers);
      rename `lib/mock/control-tower.ts` → `lib/control-tower/projection.ts` or
      gate behind a demo flag. **Product decision needed:** Control Tower renders
      `computePredictions` (fabricated baseline/bestCase + constant
      `impactWeights`) as real analytics — confirm intended.
- [ ] Derive local types (`SendRow`, `AgentSummary`) from canonical
      `Agent`/`MessageVariant` in `src/types/`; convert the 8+ data-shape
      `interface`s to `type` per CLAUDE.md.

---

## `convergence.ts` — confirmed heuristic, ties to the vision doc

`src/lib/convergence.ts` is **not** a posterior computation. It computes
`baseHours = (30 / SENDS_PER_MONTH[stage]) × 24` then linearly scales by
`arms/3`. `SENDS_PER_MONTH` is a hardcoded table keyed only on funnel stage —
**zero input from actual `alpha/beta` or observed rewards.** Output feeds only UI
estimates (`agent-wizard.tsx`, `convergence-section.tsx`). This is exactly the
P(best) upgrade target in `agent-training-convergence-vision.md` Part 2. The
`agent-sends-table.tsx ConvergencePanel` (100-128) separately hand-derives
`exploring/learning/converging/confident` from raw rows — both should be replaced
by the single principled P(best) + state-machine implementation.

---

## What's already GOOD (don't touch / use as the template)

- `db.ts`, `auth.ts`, `api-client.ts`, `stat-visibility.ts`,
  `user-preferences.ts` are clean — single WorkOS access point (no copy-paste
  singleton), defensive JSON parsing, AbortSignal timeouts.
- `BrazeClient.post/get` and the Hightouch client have correct AbortController +
  `finally` cleanup. No Prisma error leakage from the big routes.
- `app/page.tsx` & `performance/page.tsx` are the **reference** synchronous-shell
  + per-section Suspense + `void`-prekick pattern — copy this for agent detail.
- `decide.ts` is testable and is the canonical decision path the cron should
  converge onto (not the other way around).
- `LiveDemoWizard.tsx` is the well-structured component template (step
  sub-components + `useSavedGroups` hook).
- `ingest/events/route.ts` already shows the correct batch-idempotency pattern
  for Wave 4.
- `next.config.ts` CSP + immutable asset caching are solid.

---

## Risk notes

- Waves 2→3 touch the live send path. Each needs the full `bun run check`
  (integration + regression) green, and the cron's existing integration test
  (`cron-send.test.ts`) as the safety net while extracting. Extract behind
  characterization tests — don't refactor blind.
- The Neon HTTP adapter quirks (no relation hydration on `update`+include, no
  multi-level nested include hydration, read-after-write latency) constrain how
  we re-shape queries. `users/[externalId]/route.ts:31,59` has an unverified
  two-hop `message → agent` include — verify before trusting it.
- "Get rid of all tech debt now" is a multi-week program, not one PR. This
  roadmap sequences it so each wave ships safely and the high-risk ML waves come
  after the cheap scaffolding makes them testable.
