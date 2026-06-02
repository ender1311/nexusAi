# Test Suite Parallelization — Audit & Plan

> **For agentic workers:** Tier 1 is implemented (see commit on `perf/test-suite-parallel`). Tier 2 is BLOCKED on a `NEON_API_KEY` that only the repo owner can provision (see "Handoff"). Use superpowers:subagent-driven-development to execute Tier 2 once the key exists.

**Goal:** Make `bun run check` faster while preserving comprehensive coverage, using real parallelism.

**Tech Stack:** Bun test runner, Prisma v7 + Neon (serverless Postgres), GitLab CI.

---

## Audit Findings

### Where the time actually goes

`bun run check` = typecheck → lint → test. The test phase splits into:

- **Unit + contract tests:** ~732 tests across ~60 files, **~0.2s total** (no DB). Already parallel (one `bun test` process).
- **Integration + regression tests:** 78 files (10 with no DB, 68 DB-bound), run **serially, one process per file**. This is the entire wall-clock cost — a *single* DB file (`tests/integration/agents.test.ts`, 59 tests) takes **~159s on its own**, because every assertion is a Neon HTTP round-trip against a shared remote DB.

The suite is bottlenecked by DB-bound files' network latency on a shared serial database. The 10 no-DB files run in milliseconds and are noise by comparison.

### Two landmines that block naive parallelization

Both were verified empirically while building Tier 1:

1. **Shared-DB truncate race.** Every DB file shares ONE Neon test DB and calls `truncateAll()` (a global wipe) in `beforeEach`. Two DB files running *concurrently* race — one's truncate destroys the other's rows mid-test. This is the documented source of the repo's recurring FK-violation / orphaned-row failures.

2. **`mock.module()` global leak.** Bun's `mock.module()` mutates a process-global module registry and is **not** restored between files. Batching multiple files into one `bun test` invocation corrupts them: e.g. `hightouch-syncs.test.ts` stubs `@workos-inc/authkit-nextjs`, and that stub leaks into `middleware-public-api-bypass.test.ts`, which needs the real `authkit` export → `SyntaxError: Export named 'authkit' not found`. Confirmed by running the 10 no-DB files batched (fails) vs. one-process-each concurrently (all pass).

**Consequence:** files must run one-process-each (landmine 2), and DB files must not overlap on the shared DB (landmine 1). The only safe way to parallelize DB files is to give each concurrent worker its **own isolated database** — Tier 2.

### Why the text-based "pure vs DB" classifier is a dead end

An early approach scanned each test file's source for DB markers (`prisma.`, `truncateAll`, etc.) to find files safe to parallelize. It misclassifies files that reach the DB **transitively** — e.g. `ingest-events-invalid-timestamp.test.ts` imports `@/app/api/ingest/events/route`, which imports the Prisma client, but the test file's own text has no DB marker. Tightening the marker to also flag any `@/app/api/` import shrank the "pure" set to 10 files — confirming the no-DB set is too small to matter. Abandoned in favor of Tier 2, which makes ALL files parallel-safe via per-worker DB isolation.

---

## Tier 1 — Shipped (this branch)

Safe, no-risk wins that need no infrastructure:

1. **Concurrent typecheck ∥ lint** (`scripts/check.ts`). `tsc --noEmit` and `eslint` are independent and CPU-bound; they now run as concurrent processes with output captured and printed sequentially (typecheck first, then lint) so failures stay readable. Tests run only if both pass. `bun run check` → `bun scripts/check.ts`.

2. **Clean serial test seam** (`scripts/run-int-reg.ts`). Replaces the brittle inline bash loop in `package.json` with a readable, documented orchestrator that runs integration + regression files serially, one process each (preserving current correctness). This is the single integration point Tier 2 plugs into.

3. **Correct exit-code propagation in `test`.** The old script ran unit+contracts with a bare `wait`, which returns 0 even if a backgrounded run failed — so `check` could pass despite failing unit tests. Now uses `wait $pid; rc=$?` per job and gates on both.

Tier 1 does NOT parallelize DB tests (impossible without isolation) — so the big wall-clock win is still ahead, in Tier 2.

---

## Tier 2 — Neon Branch-Per-Worker (the real win)

**Idea:** Neon branches are instant copy-on-write clones of a parent DB (schema + data, no migration step). Create N ephemeral branches from the test DB, shard the 78 files across N workers, each worker pointed at its own branch's connection string, then delete the branches. Per-worker isolation removes the truncate race entirely; process-per-file already handles the mock leak. All files run concurrently.

**Expected speedup:** roughly linear in worker count for the DB-bound majority. With the suite dominated by ~159s-class files, 4–8 workers should cut int+reg wall-clock by 3–5×.

### Handoff (BLOCKER — do this first)

Tier 2 cannot start until a Neon API key exists. The repo has `NEON_PROJECT_ID` but no `NEON_API_KEY`.

- **Owner action:** create a Neon API key (Neon console → Account settings → API keys), then add it as:
  - local: `NEON_API_KEY=...` in `.env.test`
  - CI: a masked GitLab CI/CD variable `NEON_API_KEY`
- The branch-per-worker code must hard-fail (not silently fall back to the shared DB) if `NEON_API_KEY` is missing, to avoid reintroducing the truncate race.

### Implementation tasks (execute once unblocked)

- [ ] **Task 1: Neon branch helper** — `scripts/lib/neon-branch.ts`. Functions: `createBranch(name): Promise<{ branchId, connectionString }>`, `deleteBranch(branchId)`. Use the Neon REST API (`https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches`) with `Authorization: Bearer $NEON_API_KEY`. Request the pooled connection URI for the branch. Unit-test against a mocked fetch.

- [ ] **Task 2: Sharded orchestrator** — extend `scripts/run-int-reg.ts` with a parallel path (gated on `NEON_API_KEY`). Spin up `min(availableParallelism(), N_MAX)` workers; each creates a branch, runs its shard of files with `DATABASE_URL` set to the branch connection string + `TEST_DB=true`, captures output, and tears the branch down in a `finally`. Keep the serial path as the fallback ONLY when explicitly requested (never silent). Register a SIGINT/SIGTERM handler so branches are cleaned up on Ctrl-C (orphaned branches cost money and clutter the project).

- [ ] **Task 3: Shard balancing** — distribute files by known cost, not round-robin. Put the slow heavyweights (`agents.test.ts` and peers) on separate workers. A static cost map (file → approx seconds) is enough; refine later.

- [ ] **Task 4: Output aggregation** — print each file's captured output grouped by worker as it finishes; aggregate pass/fail; exit non-zero if any shard failed. Preserve `--bail` semantics per shard.

- [ ] **Task 5: CI wiring** — in `.gitlab-ci.yml`, give `verify:test:int` the `NEON_API_KEY` variable and switch it to the sharded path. Consider GitLab `parallel:` with `CI_NODE_INDEX`/`CI_NODE_TOTAL` (one branch per CI node) as an alternative to in-process workers; pick whichever the runner sizing favors. Ensure branch cleanup runs even on job failure/cancel.

- [ ] **Task 6: Leak guard** — a periodic check (or end-of-CI step) that lists branches older than ~1h and deletes them, in case a crash skipped teardown.

### Risks / notes

- Neon branch create/delete is fast but not free; cap concurrency and always tear down.
- The `pool_timeout=0` setting in `src/lib/db.ts` fails queries immediately on pool exhaustion. Per-worker branches each get their own pool, so this is fine — but do NOT crank worker count so high that the Neon project's total connection budget is exceeded.
- Branch-per-worker also unlocks removing `truncateAll()`'s global wipe in favor of per-test transactions later (out of scope here).
