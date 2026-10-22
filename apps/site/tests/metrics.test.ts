import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  METRICS_ENDPOINT,
  NEXUS_EVENTS,
  PROPOSED_EVENTS,
  SLUG,
  demoStepEvent,
  isAllowed,
  leadErrorReason,
  linkEventFor,
  metricsEndpoint,
  simulatorRunEvent,
} from "@site/lib/metrics";
import { PRESETS } from "@site/lib/simulator/presets";

const root = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("Beacon Frontier metrics", () => {
  it("reports only from beaconfrontier.com, to the domain-root collector", () => {
    expect(metricsEndpoint("beaconfrontier.com", "")).toBe("/api/m");
    expect(METRICS_ENDPOINT).toBe("/api/m");
    for (const host of ["localhost", "127.0.0.1", "nexus-ai-site.vercel.app", "www.beaconfrontier.com"]) {
      expect(metricsEndpoint(host, "")).toBeNull();
    }
  });

  it("a debug endpoint overrides the host check (local tests only)", () => {
    expect(metricsEndpoint("localhost", "http://127.0.0.1:8787/m")).toBe("http://127.0.0.1:8787/m");
  });

  it("every data-cta is a fixed, unique, valid slug", () => {
    const ctas = [...sources(join(root, "components")), ...sources(join(root, "app"))].flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/data-cta="([^"]*)"/g)].map((m) => m[1]),
    );
    expect(ctas.length).toBeGreaterThanOrEqual(8);
    for (const cta of ctas) expect(cta).toMatch(SLUG);
    expect(new Set(ctas).size).toBe(ctas.length);
  });

  it("the event list is site 'nexus' in beacon-frontier src/metrics/sites.ts, plus the common events", () => {
    // Copied from sites.ts (feat/analytics-all-sites, 709b996). If this fails, the collector's list changed:
    // update both together.
    expect(Object.keys(NEXUS_EVENTS).sort()).toEqual([
      "_leave", "_vitals", "contact_click", "cta_click", "demo_open", "js_error", "lead_error", "lead_start",
      "lead_submit", "outbound", "pageview", "simulator_run",
    ]);
    expect(NEXUS_EVENTS.simulator_run).toEqual({ scenario: "slug" });
    expect(NEXUS_EVENTS.demo_open).toEqual({ from: "slug" });
    expect(NEXUS_EVENTS.contact_click).toEqual({ via: ["email", "linkedin", "calendar", "other"] });
    for (const name of Object.keys(PROPOSED_EVENTS)) expect(NEXUS_EVENTS[name]).toBeUndefined();
  });

  it("every simulator preset id is a valid scenario", () => {
    for (const p of PRESETS) expect(isAllowed(simulatorRunEvent(p.id))).toBe(true);
    expect(simulatorRunEvent("Win back lapsed users!").props).toEqual({ scenario: "other" });
  });

  it("demo steps are 1 to 6, nothing else", () => {
    for (let n = 1; n <= 6; n++) expect(isAllowed(demoStepEvent(n)!, PROPOSED_EVENTS)).toBe(true);
    expect(demoStepEvent(0)).toBeNull();
    expect(demoStepEvent(7)).toBeNull();
    expect(demoStepEvent(2.5)).toBeNull();
  });

  it("form errors are a fixed reason from the status alone", () => {
    expect(leadErrorReason(400)).toBe("invalid");
    expect(leadErrorReason(422)).toBe("invalid");
    expect(leadErrorReason(429)).toBe("rate_limited");
    expect(leadErrorReason(500)).toBe("server");
    expect(leadErrorReason(null)).toBe("network");
  });

  it("links: the live demo and contact links, never their path", () => {
    expect(linkEventFor({ href: "https://nexus-ai-demo-dl.vercel.app/", kind: "console", cta: "console" })).toEqual({ name: "demo_open", props: { from: "console" } });
    expect(linkEventFor({ href: "https://nexus-ai-demo-dl.vercel.app/", kind: "console", cta: "Open the console" })).toEqual({ name: "demo_open", props: { from: "link" } });
    expect(linkEventFor({ href: "https://calendly.com/danluk1311/30min?email=ana%40acme.io", kind: "calendly" })).toEqual({ name: "contact_click", props: { via: "calendar" } });
    expect(linkEventFor({ href: "mailto:hello@example.com" })).toEqual({ name: "contact_click", props: { via: "email" } });
    expect(linkEventFor({ href: "https://www.linkedin.com/in/someone" })).toEqual({ name: "contact_click", props: { via: "linkedin" } });
    expect(linkEventFor({ href: "https://github.com/x" })).toBeNull();
    expect(linkEventFor({ href: "/nexus/demo" })).toBeNull();
    for (const e of [
      linkEventFor({ href: "https://x", kind: "console", cta: "console" }),
      linkEventFor({ href: "mailto:a@b.co" }),
      linkEventFor({ href: "https://calendly.com/x" }),
    ]) expect(isAllowed(e!)).toBe(true);
  });
});
