import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: the product was renamed "Sower" → "Nexus". Guard the exact
// product-name copy strings so they don't silently regress. The parable
// metaphor (and the two approved parable spots "Sower Agent" / "Sower
// vocabulary") is intentionally preserved, so we assert specific product-name
// strings rather than the global absence of "Sower".

const root = join(import.meta.dir, "..", "..");
const about = readFileSync(join(root, "src/app/about/page.tsx"), "utf8");
const faq = readFileSync(join(root, "src/app/faq/page.tsx"), "utf8");

describe("product-name Nexus copy guard", () => {
  it("About page header, footer, and demo URLs say Nexus, not Sower", () => {
    expect(about).toContain('title="About Nexus"');
    expect(about).not.toContain('title="About Sower"');
    expect(about).toContain("NEXUS · YOUVERSION · INTERNAL");
    expect(about).not.toContain("SOWER · YOUVERSION");
    expect(about).toContain("nexus.youversion.com");
    expect(about).not.toContain("sower.youversion.com");
    expect(about).toContain("nexus.api/decide");
    expect(about).not.toContain("sower.api/decide");
  });

  it("About page body/headings refer to the product as Nexus", () => {
    expect(about).toContain("Nexus replaces broadcast sends");
    expect(about).toContain("Nexus vs. how we do it now.");
    expect(about).toContain("the day Nexus goes live.");
    expect(about).toContain("Nexus never stops learning.");
    expect(about).toContain("point Nexus at a campaign");
    expect(about).not.toContain("Sower replaces broadcast sends");
    expect(about).not.toContain("Sower vs. how we do it now.");
  });

  it("preserves the approved parable spots", () => {
    expect(about).toContain('"Sower Agent"');
    expect(about).toContain("Sower vocabulary");
    expect(about).toContain("Stop sowing blind.");
  });

  it("FAQ first question reads 'What is Nexus?'", () => {
    expect(faq).toContain('q: "What is Nexus?"');
    expect(faq).not.toContain('q: "What is Nexus (Sower)?"');
  });
});
