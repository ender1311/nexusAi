import { describe, expect, it } from "bun:test";
import { isPublic, isServiceRoute } from "@/lib/auth/route-access";

// Regression: PUBLIC_PREFIXES / SERVICE_PREFIXES were matched with a bare
// `startsWith`, so a no-trailing-slash entry like "/api/decide" also matched
// "/api/decide-preview" — a future sibling route would silently skip WorkOS
// session auth. Matching is now segment-bounded.
describe("route-access segment-bounded prefix matching", () => {
  it("treats the exact machine routes as service routes", () => {
    expect(isServiceRoute("/api/decide")).toBe(true);
    expect(isServiceRoute("/api/revalidate")).toBe(true);
    expect(isServiceRoute("/api/ingest/users")).toBe(true);
    expect(isServiceRoute("/api/cron/select-and-send")).toBe(true);
    expect(isServiceRoute("/api/admin/sync-plan-sets")).toBe(true);
  });

  it("treats sub-paths of a machine route as service routes", () => {
    expect(isServiceRoute("/api/decide/anything")).toBe(true);
    expect(isServiceRoute("/api/revalidate/now")).toBe(true);
  });

  it("does NOT treat a string-prefix sibling as a service route", () => {
    // These must fall through to WorkOS session auth.
    expect(isServiceRoute("/api/decide-preview")).toBe(false);
    expect(isServiceRoute("/api/decideXYZ")).toBe(false);
    expect(isServiceRoute("/api/revalidate-cache/leak")).toBe(false);
    expect(isServiceRoute("/api/adminfoo")).toBe(false);
    expect(isServiceRoute("/api/cron-runs")).toBe(false);
  });

  it("bounds public page prefixes the same way", () => {
    expect(isPublic("/login")).toBe(true);
    expect(isPublic("/login/start")).toBe(true);
    expect(isPublic("/callback")).toBe(true);
    expect(isPublic("/callback/verify")).toBe(true);
    expect(isPublic("/login-admin")).toBe(false);
    expect(isPublic("/callbackXYZ")).toBe(false);
  });
});
