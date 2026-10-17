import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { METRICS_ENDPOINT, SLUG, metricsEndpoint, outboundKind } from "@site/lib/metrics";

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

  it("classifies outbound hosts with a fixed kind", () => {
    expect(outboundKind("calendly.com")).toBe("calendly");
    expect(outboundKind("nexus-ai-demo-dl.vercel.app")).toBe("console");
    expect(outboundKind("github.com")).toBe("external");
  });
});
