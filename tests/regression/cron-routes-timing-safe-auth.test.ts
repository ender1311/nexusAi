// tests/regression/cron-routes-timing-safe-auth.test.ts
//
// REGRESSION (audit fix #11): ingest-braze-analytics, discover-personas, and
// sync-template-variants verified the cron bearer token with a plain `===`
// compare, inconsistent with the timing-safe routes hardened in MR !340 (a `===`
// string compare can leak the secret's prefix length through timing). They now use
// constantTimeEqual. This pins the auth gate: missing/wrong tokens are rejected 401
// before any work, and the swap didn't break rejection.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NextRequest } from "next/server";
import { POST as ingestBrazeAnalytics } from "@/app/api/cron/ingest-braze-analytics/route";
import { POST as discoverPersonas } from "@/app/api/cron/discover-personas/route";
import { GET as syncTemplateVariants } from "@/app/api/cron/sync-template-variants/route";

function cronRequest(path: string, method: "GET" | "POST", token: string | null): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost${path}`, { method, headers });
}

beforeAll(() => { process.env.CRON_SECRET = "test_cron_secret"; });
afterAll(() => { delete process.env.CRON_SECRET; });

describe("regression: hardened cron routes reject bad tokens (timing-safe compare)", () => {
  it("ingest-braze-analytics rejects missing and wrong tokens with 401", async () => {
    expect((await ingestBrazeAnalytics(cronRequest("/api/cron/ingest-braze-analytics", "POST", null))).status).toBe(401);
    expect((await ingestBrazeAnalytics(cronRequest("/api/cron/ingest-braze-analytics", "POST", "wrong-secret"))).status).toBe(401);
  });

  it("discover-personas rejects missing and wrong tokens with 401", async () => {
    expect((await discoverPersonas(cronRequest("/api/cron/discover-personas", "POST", null))).status).toBe(401);
    expect((await discoverPersonas(cronRequest("/api/cron/discover-personas", "POST", "wrong-secret"))).status).toBe(401);
  });

  it("sync-template-variants rejects missing and wrong tokens with 401", async () => {
    expect((await syncTemplateVariants(cronRequest("/api/cron/sync-template-variants", "GET", null))).status).toBe(401);
    expect((await syncTemplateVariants(cronRequest("/api/cron/sync-template-variants", "GET", "wrong-secret"))).status).toBe(401);
  });
});
