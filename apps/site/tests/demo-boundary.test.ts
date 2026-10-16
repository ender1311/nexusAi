import { describe, expect, it } from "bun:test";
import { applyFieldMapping, DEFAULT_MAPPINGS } from "@content-core/index";
import { computeFeatureVector } from "@engine/feature-vector";
import { DEMO_SOURCES, FEATURE_LABELS, LUMEN_CONTENT, LUMEN_PERSONAS, LUMEN_USER } from "@site/content/demo-lumen";

describe("demo sample data", () => {
  it("imports content-core through the alias", () => {
    expect(typeof applyFieldMapping).toBe("function");
  });
  it("every Contentful sample entry maps cleanly with the default mapping", () => {
    for (const e of LUMEN_CONTENT.contentful) {
      expect("item" in applyFieldMapping(e, DEFAULT_MAPPINGS.contentful, { channel: "push" })).toBe(true);
    }
  });
  it("has 4 personas with 10-dim centroids, 10 feature labels, 5 sources", () => {
    expect(LUMEN_PERSONAS).toHaveLength(4);
    for (const p of LUMEN_PERSONAS) expect(p.centroid).toHaveLength(10);
    expect(FEATURE_LABELS).toHaveLength(10);
    expect(FEATURE_LABELS.join(" ")).not.toMatch(/spirit|giving|bible/i);
    expect(DEMO_SOURCES).toHaveLength(5);
  });
  it("maps all four items of every source with its mapping, and Contentful keeps the es locale and https images", () => {
    const sets: [unknown[], Parameters<typeof applyFieldMapping>[1]][] = [
      [LUMEN_CONTENT.contentful, DEFAULT_MAPPINGS.contentful],
      [LUMEN_CONTENT.sanity, DEFAULT_MAPPINGS.sanity],
      [LUMEN_CONTENT.genericJson.record, LUMEN_CONTENT.genericJson.mapping],
      [LUMEN_CONTENT.brazeCatalog, DEFAULT_MAPPINGS["braze-catalog"]],
    ];
    for (const [records, mapping] of sets) {
      expect(records).toHaveLength(4);
      for (const r of records) expect("item" in applyFieldMapping(r, mapping, { channel: "push" })).toBe(true);
    }
    expect(LUMEN_CONTENT.nexusLibrary).toHaveLength(4);
    const first = applyFieldMapping(LUMEN_CONTENT.contentful[0], DEFAULT_MAPPINGS.contentful, { channel: "push" });
    if (!("item" in first)) throw new Error(first.error);
    expect(first.item.locales?.es?.body).toBeTruthy();
    expect(first.item.imageUrl).toStartWith("https://");
    expect(first.item.tags).toEqual(["breathing"]);
  });
  it("LUMEN_USER yields a meaningful feature vector for the engine", () => {
    const v = computeFeatureVector({ ...LUMEN_USER, asOf: new Date("2026-10-15T12:00:00Z") });
    expect(v).toHaveLength(10);
    expect(v[0]).toBeCloseTo(2 / 12);
    expect(v[1]).toBeCloseTo(1 / 6);
    expect(v[2]).toBe(1);
    expect(v[3]).toBe(0);
    expect(v[4]).toBe(0);
    expect(v[5]).toBeCloseTo(3 / 18);
    expect(v[6]).toBeGreaterThan(0.9);
    expect(v[9]).toBeGreaterThan(0);
  });
});
