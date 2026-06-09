// Regression: every POST to nexus-api hung until the Vercel 504 timeout, so agent
// creation from the wizard always failed (GETs were fine). The entrypoint exported a
// default Node-style (req, res) listener (getRequestListener); Vercel's Node runtime
// invokes a default export with the request body pre-consumed by its helpers, so the
// route's c.req.json() waited forever on a stream that never delivers. Web-standard
// handling — an intact Request with a readable body — is only triggered by named
// HTTP-method exports (GET/POST/...), wired via handle() from hono/vercel.
// Fixed in ad126f4 (2026-06-09).
import { describe, expect, it, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apiRoot = join(import.meta.dir, "..", "..", "apps", "api");
const entrypointPath = join(apiRoot, "api", "index.ts");

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type WebHandler = (req: Request) => Response | Promise<Response>;
type EntrypointModule = Partial<Record<(typeof METHODS)[number], WebHandler>> & {
  default?: unknown;
};

const TEST_SECRET = "entrypoint-regression-test-secret";
let mod: EntrypointModule;

beforeAll(async () => {
  // The auth middleware reads INTERNAL_API_SECRET per request, so overriding here
  // wins even if .env.local already populated it. DATABASE_URL only needs to exist
  // for db.ts's import-time guard — no query runs in these tests.
  process.env.INTERNAL_API_SECRET = TEST_SECRET;
  process.env.DATABASE_URL ??= "postgresql://localhost:5432/nexus_test";
  // Non-literal specifier keeps apps/api out of the root tsc program.
  mod = (await import(`${entrypointPath}`)) as EntrypointModule;
});

describe("apps/api Vercel entrypoint shape", () => {
  it("exports a web handler for every HTTP method and no default export", () => {
    for (const method of METHODS) {
      expect(typeof mod[method]).toBe("function");
    }
    // A default export would make Vercel fall back to Node-style invocation with a
    // pre-consumed body — the exact bug this file guards against.
    expect(mod.default).toBeUndefined();
  });

  it("source uses hono/vercel handle, not a Node (req, res) listener", () => {
    const src = readFileSync(entrypointPath, "utf8");
    expect(src).toContain('from "hono/vercel"');
    expect(src).not.toContain("getRequestListener");
    expect(src).not.toMatch(/export\s+default/);
  });
});

describe("apps/api Vercel entrypoint behavior (web Request in, Response out)", () => {
  it("GET handler serves /health as a web Response", async () => {
    const res = await mod.GET!(new Request("http://nexus-api.test/health"));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST body bytes reach the route (the original bug hung here forever)", async () => {
    // {"name":""} fails validation before any DB access, so a 400 with the route's
    // own error message proves the body was fully read and parsed by c.req.json().
    const res = await mod.POST!(
      new Request("http://nexus-api.test/agents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_SECRET}`,
          "X-User-Role": "admin",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "name is required" });
  });

  it("request headers reach the auth middleware (401 without bearer token)", async () => {
    const res = await mod.POST!(
      new Request("http://nexus-api.test/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});
