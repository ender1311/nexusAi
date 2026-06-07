import { describe, expect, it } from "bun:test";
import { navTree, flattenItems, activeHref, groupLabelForHref } from "@/components/layout/nav-config";

// Regression: the sidebar IA was restructured from a flat list into a nested,
// collapsible tree. These tests guard against silently dropping a previously
// reachable page and verify the pure active-match helpers behave.

describe("nav-config", () => {
  it("keeps every previously-reachable destination", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    for (const required of [
      "/", "/control-tower", "/agents", "/messages", "/push-library",
      "/personas", "/performance", "/data-ingest", "/about", "/architecture",
      "/demo/deep-dive", "/faq", "/demo", "/settings",
    ]) {
      expect(hrefs).toContain(required);
    }
  });

  it("includes the new placeholder routes", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    for (const href of ["/audience/search", "/audience/segments", "/audience/sizes", "/email-library"]) {
      expect(hrefs).toContain(href);
    }
  });

  it("has unique hrefs", () => {
    const hrefs = flattenItems(navTree).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("matches the most-specific item for a deep route", () => {
    expect(activeHref("/demo/deep-dive/feature-vectors", navTree)).toBe("/demo/deep-dive");
    expect(activeHref("/demo/live", navTree)).toBe("/demo");
    expect(activeHref("/", navTree)).toBe("/");
    expect(activeHref("/agents/abc", navTree)).toBe("/agents");
  });

  it("resolves the parent group label for a child href", () => {
    expect(groupLabelForHref("/control-tower", navTree)).toBe("Dashboard");
    expect(groupLabelForHref("/demo/deep-dive", navTree)).toBe("About");
    expect(groupLabelForHref("/agents", navTree)).toBeUndefined();
  });
});
