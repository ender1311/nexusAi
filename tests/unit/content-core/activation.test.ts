import { describe, expect, it } from "bun:test";
import { brazeCatalogLiquid, buildActivationProperties, catalogItemIdFor, referenceProperties } from "@/lib/content-core";

const v = { contentSource: "braze-catalog", externalRef: "tip_7", title: "Breathe", body: "Two minutes.", cta: "Start", link: "lumen://breathe" };

describe("activation", () => {
  it("inline mode carries the copy only", () => {
    expect(buildActivationProperties(v, "inline")).toEqual({ title: "Breathe", message: "Two minutes.", cta: "Start", link: "lumen://breathe" });
  });
  it("reference mode adds catalog_item_id next to the copy", () => {
    expect(buildActivationProperties(v, "reference")).toEqual({ title: "Breathe", message: "Two minutes.", cta: "Start", link: "lumen://breathe", catalog_item_id: "tip_7" });
  });
  it("referenceProperties is empty without an id", () => {
    expect(referenceProperties(null)).toEqual({});
    expect(referenceProperties("tip_7")).toEqual({ catalog_item_id: "tip_7" });
  });
  it("renders the Liquid snippet for a catalog", () => {
    expect(brazeCatalogLiquid("lumen_tips")).toBe("{% catalog_items lumen_tips {{api_trigger_properties.${catalog_item_id}}} %}");
    expect(brazeCatalogLiquid("lumen_tips", "canvas_entry_properties")).toBe("{% catalog_items lumen_tips {{canvas_entry_properties.${catalog_item_id}}} %}");
  });
  it("catalogItemIdFor uses the variant's own ref, else its braze-catalog template's ref", () => {
    const catalog = { contentSource: "braze-catalog", externalRef: "tip_7" };
    const native = { contentSource: "nexus-library", externalRef: null };
    expect(catalogItemIdFor(catalog, null)).toBe("tip_7");
    expect(catalogItemIdFor(native, catalog)).toBe("tip_7");
    expect(catalogItemIdFor(native, { contentSource: "contentful", externalRef: "e1" })).toBeNull();
    expect(catalogItemIdFor(native, null)).toBeNull();
    expect(catalogItemIdFor({ contentSource: "contentful", externalRef: "e1" }, undefined)).toBeNull();
  });
});
