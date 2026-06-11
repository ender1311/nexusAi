// tests/unit/votd-labels.test.ts
import { describe, it, expect } from "bun:test";
import { guidedLabels } from "@/lib/votd/labels";
import { VERSION_MAP } from "@/lib/votd/version-map";

describe("guidedLabels", () => {
  it("returns English labels for en", () => {
    expect(guidedLabels("en")).toEqual({
      guidedScripture: "Today's Guided Scripture",
      guidedPrayer: "Today's Guided Prayer",
    });
  });
  it("returns localized labels for es", () => {
    expect(guidedLabels("es").guidedScripture).toBe("La Escritura guiada de hoy");
    expect(guidedLabels("es").guidedPrayer).toBe("La oración guiada de hoy");
  });
  it("falls back regional → primary subtag (en_GB → en)", () => {
    expect(guidedLabels("en_GB")).toEqual(guidedLabels("en"));
  });
  it("falls back unknown → en", () => {
    expect(guidedLabels("zz")).toEqual(guidedLabels("en"));
  });
  it("covers every VERSION_MAP language with non-empty labels", () => {
    for (const tag of Object.keys(VERSION_MAP)) {
      const l = guidedLabels(tag);
      expect(l.guidedScripture.length).toBeGreaterThan(0);
      expect(l.guidedPrayer.length).toBeGreaterThan(0);
    }
  });
});
