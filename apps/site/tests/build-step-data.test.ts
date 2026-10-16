import { describe, expect, it } from "bun:test";
import { contentItemSchema } from "@content-core/index";
import { DEMO_SOURCES } from "@site/content/demo-lumen";
import { stepActivate, stepContent, stepDecide, stepFeatures, stepIngest, stepLearn } from "@site/lib/demo/build-step-data";

describe("demo step data", () => {
  it("step 1 builds the ingest request from the warehouse row", () => {
    const s = stepIngest();
    expect(s.ingestRequest.path).toBe("/api/ingest/users");
    expect(JSON.stringify(s.ingestRequest.body)).toContain("lumen-user-1832");
  });

  it("step 2 is deterministic, 10-dim, values in [0,1], nearest persona", () => {
    const a = stepFeatures(), b = stepFeatures();
    expect(a).toEqual(b);
    expect(a.vector).toHaveLength(10);
    for (const v of a.vector) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    expect(a.labelled[8]!.label).toContain("Vertical signal B");
    expect(typeof a.persona.label).toBe("string");
  });

  it("step 3 yields a valid ContentItem for every source", () => {
    for (const s of DEMO_SOURCES) {
      const r = stepContent(s);
      expect(contentItemSchema.safeParse(r.item).success).toBe(true);
      expect(r.items).toHaveLength(4);
    }
  });

  it("step 4 is deterministic per seed and reports estimates for every arm", () => {
    const a = stepDecide("contentful", 7), b = stepDecide("contentful", 7);
    expect(a.chosen.externalRef).toBe(b.chosen.externalRef);
    expect(a.arms).toHaveLength(4);
    for (const arm of a.arms) expect(arm.uncertainty).toBeGreaterThan(0);
  });

  it("step 4 restores Math.random", () => {
    const orig = Math.random;
    stepDecide("sanity", 1);
    expect(Math.random).toBe(orig);
  });

  it("step 5 uses reference mode only for braze-catalog on triggered channels", () => {
    const ref = stepActivate("braze-catalog", "content_card");
    expect(ref.mode).toBe("reference");
    expect((ref.body.trigger_properties as Record<string, string>).catalog_item_id).toBeDefined();
    expect(ref.liquid).toContain("catalog_items");
    for (const s of ["contentful", "sanity", "generic-json", "nexus-library"] as const) {
      const r = stepActivate(s, "content_card");
      expect(r.mode).toBe("inline");
      expect(JSON.stringify(r.body)).not.toContain("catalog_item_id");
    }
    const push = stepActivate("braze-catalog", "push");
    expect(push.endpoint).toBe("/messages/send");
    expect(JSON.stringify(push.body)).not.toContain("catalog_item_id");
  });

  it("step 6 updates Beta stats", () => {
    expect(stepLearn({ alpha: 3, beta: 10 }, true)).toEqual({ alpha: 4, beta: 10 });
    expect(stepLearn({ alpha: 3, beta: 10 }, false)).toEqual({ alpha: 3, beta: 11 });
  });
});
