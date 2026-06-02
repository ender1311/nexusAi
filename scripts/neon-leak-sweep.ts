#!/usr/bin/env bun
// Safety net for branch-per-worker test isolation: delete stray ephemeral
// branches (name prefix "ci-") older than a threshold, in case a crash or a
// hard kill skipped the orchestrator's teardown. Orphaned branches cost money
// and clutter the project. Safe to run on a schedule or as a CI cleanup step.
//
// Usage: NEON_API_KEY=... bun scripts/neon-leak-sweep.ts [--max-age-min=60] [--dry-run]

import { listBranchesByPrefix, deleteBranch } from "./lib/neon-branch";
import { getNeonApiKey, getTestProjectId } from "./lib/test-env";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

async function main() {
  const apiKey = getNeonApiKey();
  const projectId = getTestProjectId();
  const maxAgeMin = Number(arg("max-age-min") ?? 60);
  const dryRun = process.argv.includes("--dry-run");
  const cutoff = Date.now() - maxAgeMin * 60_000;

  const branches = await listBranchesByPrefix(apiKey, projectId, "ci-");
  const stale = branches.filter((b) => b.createdAt && b.createdAt < cutoff);

  if (stale.length === 0) {
    console.log(
      `[leak-sweep] no ci- branches older than ${maxAgeMin}m (${branches.length} ci- total)`,
    );
    return;
  }

  for (const b of stale) {
    const ageMin = Math.round((Date.now() - b.createdAt) / 60_000);
    if (dryRun) {
      console.log(`[leak-sweep] would delete ${b.id} (${b.name}, ${ageMin}m old)`);
      continue;
    }
    await deleteBranch(apiKey, projectId, b.id).catch((e) =>
      console.error(`[leak-sweep] failed to delete ${b.id}: ${e}`),
    );
    console.log(`[leak-sweep] deleted ${b.id} (${b.name}, ${ageMin}m old)`);
  }
}

await main();
