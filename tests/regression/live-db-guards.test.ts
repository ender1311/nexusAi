// Regression: tests, scripts and the Prisma CLI must never be able to wipe or
// alter a live database.
//
// Incident class: a live Neon URL leaks into a test or tool process (an exported
// DATABASE_URL in the shell, `bun run` loading .env.local, prisma.config.ts
// loading .env.local) and destructive code — truncateAll(), a bare
// `deleteMany()` in a beforeEach, `prisma migrate reset` / `db push` — runs
// against it. The old guard was a blocklist holding one stale endpoint
// (ep-old-surf-a4p5os6s) and missed the live demo DB entirely. The guards are
// now localhost allowlists (src/lib/db-safety.ts) at every layer; these tests
// prove each layer trips BEFORE any query is sent.

import { afterEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";

const NEON_URL = "postgresql://u:p@ep-x.us-east-1.aws.neon.tech/db";
const REPO_ROOT = new URL("../..", import.meta.url).pathname;

const savedUrl = process.env.DATABASE_URL;
const savedTestDb = process.env.TEST_DB;

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restoreEnv("DATABASE_URL", savedUrl);
  restoreEnv("TEST_DB", savedTestDb);
});

function childEnv(overrides: Record<string, string>): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.DATABASE_URL;
  delete env.NODE_ENV;
  return { ...env, ...overrides };
}

describe("live database guards", () => {
  it("truncateAll() refuses a Neon URL even with TEST_DB=true", async () => {
    process.env.DATABASE_URL = NEON_URL;
    process.env.TEST_DB = "true";
    await expect(truncateAll()).rejects.toThrow("SAFETY ABORT (truncateAll())");
  });

  it("the Prisma client refuses a non-local URL under NODE_ENV=test", () => {
    const script =
      `process.env.NODE_ENV='test'; process.env.DATABASE_URL='${NEON_URL}'; ` +
      `await import('./src/lib/db')`;
    const p = Bun.spawnSync(["bun", "-e", script], {
      cwd: REPO_ROOT,
      env: childEnv({}),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = p.stderr.toString();
    expect(p.exitCode).not.toBe(0);
    expect(stderr).toContain("SAFETY ABORT (prisma client under test)");
    expect(stderr).not.toContain("u:p@");
  });

  it("the test preload aborts the whole run before any test executes", () => {
    const p = Bun.spawnSync(["bun", "test", "tests/unit/db-safety.test.ts"], {
      cwd: REPO_ROOT,
      env: childEnv({ DATABASE_URL: NEON_URL }),
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = p.stdout.toString() + p.stderr.toString();
    expect(p.exitCode).not.toBe(0);
    expect(output).toContain("SAFETY ABORT (test preload)");
    expect(output).not.toMatch(/\b[1-9]\d* pass\b/);
  });
});
