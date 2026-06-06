import { describe, it, expect } from "bun:test";
import { YOUVERSION_DEEPLINKS } from "@/lib/constants/youversion";

describe("YOUVERSION_DEEPLINKS web entries", () => {
  const byValue = (v: string) => YOUVERSION_DEEPLINKS.find((d) => d.value === v);

  it("includes the web Find Plans URL", () => {
    expect(byValue("https://www.bible.com/reading-plans")).toBeDefined();
  });
  it("includes the web My Plans URL", () => {
    expect(byValue("https://www.bible.com/my-plans")).toBeDefined();
  });
  it("includes the web Verse of the Day URL", () => {
    expect(byValue("https://www.bible.com/verse-of-the-day")).toBeDefined();
  });
  it("all entries have a label and a category", () => {
    for (const d of YOUVERSION_DEEPLINKS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.category.length).toBeGreaterThan(0);
    }
  });
  it("has no duplicate values", () => {
    const values = YOUVERSION_DEEPLINKS.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
