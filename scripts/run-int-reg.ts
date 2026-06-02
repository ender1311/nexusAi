#!/usr/bin/env bun
// Orchestrates the integration + regression suites.
//
// Two independent hazards constrain how these files can run:
//
//   1. Shared DB truncate race. Every DB-touching file shares ONE Neon test DB,
//      and truncateAll() (tests/helpers/db.ts) does a GLOBAL wipe in beforeEach.
//      Two such files running CONCURRENTLY against the SAME DB race — one file's
//      truncateAll() destroys another's rows mid-test.
//
//   2. mock.module() global leak. bun's mock.module() mutates a process-global
//      module registry and is NOT restored between files. So files must run
//      one-per-process, never batched into a single `bun test` invocation.
//
// SERIAL path (no NEON_API_KEY): each file runs in its own process (hazard 2),
// serially against the one shared DB (hazard 1). Always correct, ~19 min.
//
// PARALLEL path (NEON_API_KEY present): give each worker its OWN ephemeral Neon
// branch — an instant copy-on-write clone of the test DB — so concurrent workers
// never share a database (hazard 1 gone). Within a worker, files still run
// one-process-each (hazard 2). Files are sharded across workers by cost (LPT).
// This is the real wall-clock win.
//
// Mode selection:
//   - TEST_SERIAL=1            → force serial even if a key is present.
//   - NEON_API_KEY present     → parallel (default when available).
//   - NEON_API_KEY absent      → serial, with a one-line note.
// If you explicitly opt into parallel (TEST_PARALLEL=1) without a key, we
// hard-fail rather than silently fall back — to avoid masking a misconfig.

import { Glob } from "bun";
import {
  createBranch,
  deleteBranch,
  resolveParentBranchByHost,
} from "./lib/neon-branch";
import {
  getNeonApiKey,
  getTestProjectId,
  getTestDbHost,
  buildWorkerEnv,
} from "./lib/test-env";

const WORKER_CAP = Number(process.env.TEST_WORKERS ?? 8);

async function collect(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const f of new Glob(pattern).scan(".")) out.push(f);
  return out.sort();
}

// Cost proxy: number of test cases in a file. More tests ≈ more Neon
// round-trips ≈ more wall-clock. Self-maintaining (no stale static map).
async function fileCost(file: string): Promise<number> {
  const text = await Bun.file(file).text();
  const m = text.match(/\b(it|test)\s*(\.\w+)?\s*\(/g);
  return m ? m.length : 1;
}

// Longest-processing-time-first greedy: sort files by cost desc, assign each to
// the currently least-loaded worker. Keeps the heavy files (agents.test.ts) on
// separate workers and balances total load well.
function balance(
  files: Array<{ file: string; cost: number }>,
  workers: number,
): string[][] {
  const shards: Array<{ files: string[]; load: number }> = Array.from(
    { length: workers },
    () => ({ files: [], load: 0 }),
  );
  for (const { file, cost } of [...files].sort((a, b) => b.cost - a.cost)) {
    const target = shards.reduce((min, s) => (s.load < min.load ? s : min));
    target.files.push(file);
    target.load += cost;
  }
  return shards.map((s) => s.files).filter((f) => f.length > 0);
}

type FileResult = { file: string; code: number; output: string };

async function runFileOnBranch(
  file: string,
  connectionString: string,
): Promise<FileResult> {
  const p = Bun.spawn(["bun", "test", "--timeout", "30000", "--bail=1", file], {
    stdout: "pipe",
    stderr: "pipe",
    env: buildWorkerEnv(connectionString),
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { file, code: code ?? 1, output: out + err };
}

async function runParallel(allFiles: string[]): Promise<number> {
  const apiKey = getNeonApiKey();
  const projectId = getTestProjectId();
  const host = getTestDbHost();
  const parent = await resolveParentBranchByHost(apiKey, projectId, host);

  const costed = await Promise.all(
    allFiles.map(async (file) => ({ file, cost: await fileCost(file) })),
  );
  // Workers are network-bound (each test blocks on Neon HTTP round-trips), not
  // CPU-bound, so we intentionally do NOT clamp to availableParallelism() — that
  // would throttle a small CI runner to ~1 worker. Cap by TEST_WORKERS + files.
  const workerCount = Math.max(1, Math.min(WORKER_CAP, allFiles.length));
  const shards = balance(costed, workerCount);

  console.log(
    `[run-int-reg] PARALLEL — ${allFiles.length} files across ${shards.length} ` +
      `workers (branch-per-worker on test project ${projectId.slice(0, 8)}…)`,
  );

  // Track live branches so a Ctrl-C tears them all down (orphans cost money).
  const liveBranches = new Set<string>();
  let cleaning = false;
  const cleanupAll = async () => {
    if (cleaning) return;
    cleaning = true;
    await Promise.allSettled(
      [...liveBranches].map((id) => deleteBranch(apiKey, projectId, id)),
    );
  };
  const onSignal = (sig: string) => {
    console.error(`\n[run-int-reg] ${sig} — tearing down ${liveBranches.size} branch(es)…`);
    cleanupAll().finally(() => process.exit(130));
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  const results: FileResult[] = [];
  const runShard = async (shard: string[], idx: number) => {
    const name = `ci-w${idx}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const branch = await createBranch(apiKey, projectId, parent, name);
    liveBranches.add(branch.branchId);
    try {
      for (const file of shard) {
        const r = await runFileOnBranch(file, branch.connectionString);
        results.push(r);
        const tag = r.code === 0 ? "PASS" : "FAIL";
        console.log(`[w${idx}] ${tag} ${file}`);
      }
    } finally {
      await deleteBranch(apiKey, projectId, branch.branchId).catch(() => {});
      liveBranches.delete(branch.branchId);
    }
  };

  await Promise.all(shards.map((shard, idx) => runShard(shard, idx)));

  // Print failing files' captured output last, so failures are easy to find.
  const failures = results.filter((r) => r.code !== 0);
  for (const f of failures) {
    console.log(`\n===== FAIL: ${f.file} =====\n${f.output}`);
  }
  console.log(
    `\n[run-int-reg] ${results.length - failures.length}/${results.length} files passed`,
  );
  return failures.length === 0 ? 0 : 1;
}

function runSerial(files: string[]): number {
  console.log(`[run-int-reg] SERIAL — ${files.length} files, one process each`);
  for (const file of files) {
    const p = Bun.spawnSync(
      ["bun", "test", "--timeout", "30000", "--bail=1", file],
      { stdout: "inherit", stderr: "inherit" },
    );
    if ((p.exitCode ?? 1) !== 0) return p.exitCode ?? 1;
  }
  return 0;
}

async function main() {
  // TEST_FILES=comma,list restricts the run to specific files (debugging / smoke).
  const override = process.env.TEST_FILES?.trim();
  const files = override
    ? override.split(",").map((f) => f.trim()).filter(Boolean)
    : [
        ...(await collect("tests/integration/*.test.ts")),
        ...(await collect("tests/regression/*.test.ts")),
      ];

  const forceSerial = process.env.TEST_SERIAL === "1";
  const wantParallel = process.env.TEST_PARALLEL === "1";
  const hasKey = !!process.env.NEON_API_KEY?.trim();

  if (wantParallel && !hasKey) {
    console.error(
      "[run-int-reg] TEST_PARALLEL=1 but NEON_API_KEY is missing. Refusing to " +
        "silently fall back to the shared serial DB. Set NEON_API_KEY or unset " +
        "TEST_PARALLEL.",
    );
    process.exit(1);
  }

  if (!forceSerial && hasKey) {
    process.exit(await runParallel(files));
  }

  if (!hasKey) {
    console.log(
      "[run-int-reg] (NEON_API_KEY not set — running serial. Set it to enable " +
        "branch-per-worker parallelism.)",
    );
  }
  process.exit(runSerial(files));
}

await main();
