#!/usr/bin/env bun
// Orchestrates the integration + regression suites.
//
// These files CANNOT be parallelized naively, for two independent reasons:
//
//   1. Shared DB truncate race. Every DB-touching file shares ONE Neon test DB,
//      and truncateAll() (tests/helpers/db.ts) does a GLOBAL wipe in beforeEach.
//      Two such files running CONCURRENTLY race — one file's truncateAll()
//      destroys another's rows mid-test (the FK-violation / orphaned-row failures
//      this repo has hit repeatedly).
//
//   2. mock.module() global leak. bun's mock.module() mutates a process-global
//      module registry and is NOT restored between files. Two files that mock the
//      same module differently (e.g. one stubs @workos-inc/authkit-nextjs, another
//      needs its real `authkit` export) corrupt each other when they share a
//      process. So files must run one-per-process, never batched into a single
//      `bun test` invocation.
//
// Net effect: each file runs in its own process (hazard 2), serially (hazard 1).
// This is a clean, readable replacement for the previous inline bash loop, and —
// importantly — the single integration point for Tier 2 parallelism below.
//
// Why not parallelize the few "pure" (no-DB) files? They're a tiny minority and
// run in milliseconds each; the suite's wall-clock is dominated by the DB-bound
// files' Neon HTTP round-trips (a single integration file can take 2-3 minutes).
// Overlapping the cheap files buys nothing measurable and adds flake surface.
//
// Tier 2 (the real win, gated on NEON_API_KEY): give each worker its own isolated
// Neon branch (instant copy-on-write of the parent test DB's schema + data), then
// shard ALL files across workers running concurrently. Per-worker isolation
// removes hazard 1 entirely; process-per-file already handles hazard 2. This is
// where branch-per-worker sharding plugs in — replace the serial loop in main()
// with a sharded dispatch. See docs/superpowers/plans for the implementation plan.

import { Glob } from "bun";

async function collect(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const f of new Glob(pattern).scan(".")) out.push(f);
  return out.sort();
}

function run(file: string): number {
  const p = Bun.spawnSync(
    ["bun", "test", "--timeout", "30000", "--bail=1", file],
    { stdout: "inherit", stderr: "inherit" },
  );
  return p.exitCode ?? 1;
}

async function main() {
  const files = [
    ...(await collect("tests/integration/*.test.ts")),
    ...(await collect("tests/regression/*.test.ts")),
  ];

  console.log(`[run-int-reg] ${files.length} files — serial, one process each`);

  for (const f of files) {
    const code = run(f);
    if (code !== 0) process.exit(code);
  }
}

await main();
