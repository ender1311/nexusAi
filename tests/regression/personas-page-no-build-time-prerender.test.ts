// Regression: production deploys failed 2026-06-11 because `next build`
// statically prerendered /personas, running the per-persona TrackedUser
// counts (~34M rows) against the production DB at build time. On a cold
// 2-CU Neon compute the query exceeded the 60s static-generation limit,
// failing every deploy ("Failed to build /personas/page ... after 3
// attempts"). The page must stay force-dynamic; runtime caching belongs to
// unstable_cache, not page-level ISR.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(
  join(import.meta.dir, "../../src/app/personas/page.tsx"),
  "utf8",
);

describe("/personas build-time prerender guard", () => {
  it("is force-dynamic so the build never queries the DB", () => {
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });

  it("has no page-level revalidate (which would re-enable static prerender)", () => {
    expect(src).not.toMatch(/export const revalidate/);
  });

  it("keeps runtime caching via unstable_cache", () => {
    expect(src).toContain("unstable_cache");
  });
});
