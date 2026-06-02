#!/usr/bin/env bun
// Orchestrates the integration + regression suites against the local test DB.
//
// Files run one-process-each AND serially, for two independent reasons:
//
//   1. mock.module() global leak. bun's mock.module() mutates a process-global
//      module registry that is NOT restored between files, so batching multiple
//      files into a single `bun test` invocation corrupts module stubs across
//      them. Each file therefore gets its own process.
//
//   2. Shared DB truncate race. Every DB-touching file shares ONE test database
//      and truncateAll() (tests/helpers/db.ts) does a GLOBAL wipe in beforeEach.
//      Two files running concurrently against the same DB would race — one
//      file's truncateAll() destroys another's rows mid-test. So files run one
//      after another.
//
// Against a local Postgres there is no network latency, so the serial run is
// fast. TEST_FILES=comma,list restricts the run to specific files (debugging).

import { Glob } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

async function collect(pattern: string): Promise<string[]> {
  const out: string[] = [];
  for await (const f of new Glob(pattern).scan(".")) out.push(f);
  return out.sort();
}

// `bun scripts/run-int-reg.ts` loads .env.local (the PRODUCTION DATABASE_URL and
// secrets) into this process's env. Children spawned below inherit it, and bun
// will NOT let a child's .env.test override an already-set inherited var — so the
// production URL would leak in and truncateAll()'s safety guard would (correctly)
// abort. Strip every key that .env.local defines so each child resolves its env
// from .env + .env.test alone, exactly like a bare `bun test`.
function buildChildEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  if (existsSync(".env.local")) {
    for (const key of Object.keys(parse(readFileSync(".env.local")))) {
      delete env[key];
    }
  }
  return env;
}

function runSerial(files: string[]): number {
  console.log(`[run-int-reg] ${files.length} files, one process each`);
  const env = buildChildEnv();
  for (const file of files) {
    const p = Bun.spawnSync(
      ["bun", "test", "--timeout", "30000", "--bail=1", file],
      { stdout: "inherit", stderr: "inherit", env },
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
  process.exit(runSerial(files));
}

await main();
