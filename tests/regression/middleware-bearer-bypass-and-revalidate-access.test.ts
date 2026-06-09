// Regression for two middleware auth holes found in the 2026-06-09 audit:
//
// 1. Bearer bypass: any request carrying `Authorization: Bearer x` (any value)
//    skipped WorkOS session auth on ALL routes, so unauthenticated callers could
//    read every GET API route (e.g. GET /api/agents dumped full agent config).
//    Machine routes are whitelisted via SERVICE_PREFIXES and carry their own
//    secret auth; nothing else may honor a bare bearer header.
//
// 2. /api/revalidate was in no prefix list, so the nexus-api Hono service's
//    cache-busting webhook (no cookie, no bearer) was 401'd by middleware before
//    the route's own timing-safe REVALIDATE_SECRET check ever ran — cache
//    revalidation after agent create/update silently never fired (lists stayed
//    stale for the full 15-min TTL).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublic, isServiceRoute, SERVICE_PREFIXES, PUBLIC_PREFIXES } from "@/lib/auth/route-access";

describe("route-access policy", () => {
  it("lets the revalidate webhook through to its own secret check", () => {
    expect(isServiceRoute("/api/revalidate")).toBe(true);
    expect(isPublic("/api/revalidate")).toBe(true);
  });

  it("keeps machine endpoints service-routed", () => {
    for (const p of ["/api/ingest/users", "/api/decide", "/api/cron/select-and-send", "/api/admin/x"]) {
      expect(isServiceRoute(p)).toBe(true);
    }
  });

  it("session-protects app API and page routes", () => {
    for (const p of ["/api/agents", "/api/agents/abc", "/api/personas", "/api/segments", "/agents", "/"]) {
      expect(isServiceRoute(p)).toBe(false);
      expect(isPublic(p)).toBe(false);
    }
  });

  it("every service prefix is also public (no login redirect for machines)", () => {
    for (const p of SERVICE_PREFIXES) {
      expect(PUBLIC_PREFIXES).toContain(p);
    }
  });
});

describe("middleware source", () => {
  it("has no bearer-token bypass for non-service routes", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src", "middleware.ts"), "utf8");
    expect(src).not.toMatch(/hasBearerToken|startsWith\(["']Bearer/);
    // Policy must come from the tested pure module, not a private copy.
    expect(src).toContain('from "@/lib/auth/route-access"');
  });
});
