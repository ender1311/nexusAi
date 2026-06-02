#!/usr/bin/env bun
// Runs the pre-MR gate: typecheck and lint concurrently (independent, CPU-bound),
// then the full test suite only if both passed.
//
// typecheck (tsc) and lint (eslint) don't depend on each other, so we run them in
// parallel to cut wall-clock time. Their output is captured and printed
// sequentially (typecheck first, then lint) so a failure stays readable instead of
// interleaving two tools' diagnostics.

import type { Subprocess } from "bun";

function spawn(cmd: string[]) {
  return Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
}

async function drain(p: Subprocess): Promise<{ code: number; out: string }> {
  const [out, err, code] = await Promise.all([
    new Response(p.stdout as ReadableStream).text(),
    new Response(p.stderr as ReadableStream).text(),
    p.exited,
  ]);
  return { code, out: out + err };
}

async function main() {
  const tc = spawn(["bun", "run", "typecheck"]);
  const lint = spawn(["bun", "run", "lint"]);

  const [tcRes, lintRes] = await Promise.all([drain(tc), drain(lint)]);

  process.stdout.write("=== typecheck ===\n" + tcRes.out);
  process.stdout.write("=== lint ===\n" + lintRes.out);

  if (tcRes.code !== 0 || lintRes.code !== 0) {
    process.exit(tcRes.code || lintRes.code);
  }

  // Tests share one Neon DB and can't safely interleave with each other, so the
  // test runner handles its own pure/db split (see scripts/run-int-reg.ts).
  const test = Bun.spawnSync(["bun", "run", "test"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(test.exitCode ?? 1);
}

await main();
