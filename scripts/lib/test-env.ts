// Resolve test-only target (Neon project + test DB host) for branch-per-worker.
//
// The orchestrator runs via `bun scripts/...` (NODE_ENV is NOT "test"), so Bun
// has loaded .env/.env.local — whose NEON_PROJECT_ID and DATABASE_URL point at
// PRODUCTION. We must therefore NEVER read those ambient values. Instead:
//
//   - Local: read NEON_PROJECT_ID and DATABASE_URL from the .env.test FILE.
//   - CI: there is no .env.test file; the job sets test-specific vars
//     (NEON_TEST_PROJECT_ID) and DATABASE_URL is already the test DB.
//
// The host derived here is cross-checked against the Neon API
// (resolveParentBranchByHost) before any branch is created, so a misconfigured
// project id can never silently clone production.

import { readFileSync } from "node:fs";

const fileCache: Record<string, Record<string, string>> = {};

function parseEnvFile(path: string): Record<string, string> {
  if (fileCache[path]) return fileCache[path];
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    raw = "";
  }
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  fileCache[path] = out;
  return out;
}

function envTestFile(): Record<string, string> {
  return parseEnvFile(".env.test");
}

/** Test Neon project id: .env.test file, else CI's NEON_TEST_PROJECT_ID. */
export function getTestProjectId(): string {
  const fromFile = envTestFile().NEON_PROJECT_ID?.trim();
  if (fromFile) return fromFile;
  const fromCi = process.env.NEON_TEST_PROJECT_ID?.trim();
  if (fromCi) return fromCi;
  throw new Error(
    "Cannot resolve test Neon project id: set NEON_PROJECT_ID in .env.test " +
      "(local) or NEON_TEST_PROJECT_ID as a CI variable.",
  );
}

/**
 * Host of the test DB endpoint. Local: from .env.test DATABASE_URL. CI: no
 * .env.test, so DATABASE_URL in process.env is already the test DB. We never use
 * process.env.DATABASE_URL when a .env.test file exists (it would be prod).
 */
export function getTestDbHost(): string {
  const fromFile = envTestFile().DATABASE_URL?.trim();
  const url = fromFile || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Cannot resolve test DB host: no DATABASE_URL in .env.test or env.",
    );
  }
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error("Test DATABASE_URL is not a valid URL");
  }
}

/** Required API key, present in env (loaded from .env.local locally, CI var in CI). */
export function getNeonApiKey(): string {
  const k = process.env.NEON_API_KEY?.trim();
  if (!k) {
    throw new Error(
      "NEON_API_KEY missing. Add it to .env.local (local) or as a CI variable. " +
        "Branch-per-worker parallelism cannot run without it.",
    );
  }
  return k;
}

/**
 * Build the env for a worker's `bun test` child so it matches a NORMAL local
 * `bun test` (which loads .env + .env.test but NOT .env.local), plus the
 * per-worker branch override.
 *
 * The orchestrator runs via `bun scripts/...`, which DOES load .env.local —
 * polluting its process.env with PRODUCTION values (prod DATABASE_URL, real
 * BRAZE_API_KEY / BRAZE_REST_ENDPOINT, WORKOS_*, etc.). If those leak into a
 * worker, tests hit real production services (observed: Braze 401s). So we strip
 * every key that .env.local defines from the inherited env; the child `bun test`
 * then repopulates test values from .env/.env.test on its own. System vars
 * (PATH, HOME, …) are untouched since they are not in .env.local.
 */
export function buildWorkerEnv(
  connectionString: string,
): Record<string, string> {
  const prodKeys = Object.keys(parseEnvFile(".env.local"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !prodKeys.includes(k)) env[k] = v;
  }
  // Explicit overrides win over the child's own .env.test loading.
  env.DATABASE_URL = connectionString;
  env.TEST_DB = "true";
  return env;
}
