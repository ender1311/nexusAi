import { describe, expect, it } from "bun:test";
import {
  slugify,
  findCategory,
  findSubcategory,
  validateVariantTaxonomy,
  subcategoryHasVerseDeeplink,
  type PushTaxonomy,
} from "@/lib/push-taxonomy";

const TAXONOMY: PushTaxonomy = [
  {
    id: "c1", slug: "reader", label: "Reader", sortOrder: 0, isActive: true,
    subcategories: [
      { id: "s1", slug: "open-bible", label: "Open Bible", sortOrder: 0, deeplinkBehavior: "none", isActive: true },
      { id: "s2", slug: "specific-verse", label: "Specific Verse", sortOrder: 1, deeplinkBehavior: "specific-verse", isActive: true },
      { id: "s3", slug: "retired-sub", label: "Retired", sortOrder: 2, deeplinkBehavior: "none", isActive: false },
    ],
  },
  { id: "c2", slug: "giving", label: "Giving", sortOrder: 1, isActive: true, subcategories: [] },
  { id: "c3", slug: "old-cat", label: "Old", sortOrder: 2, isActive: false, subcategories: [] },
];

describe("slugify", () => {
  it("lowercases, trims, and dashes", () => {
    expect(slugify("  Verse Of The Day! ")).toBe("verse-of-the-day");
    expect(slugify("End of Year")).toBe("end-of-year");
  });
});

describe("findCategory / findSubcategory", () => {
  it("finds by slug", () => {
    expect(findCategory(TAXONOMY, "reader")?.id).toBe("c1");
    expect(findSubcategory(TAXONOMY, "specific-verse")?.id).toBe("s2");
    expect(findCategory(TAXONOMY, "nope")).toBeNull();
  });
});

describe("validateVariantTaxonomy", () => {
  it("accepts an active category with a matching active subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "reader", "specific-verse").ok).toBe(true);
  });
  it("accepts an active category with no subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "giving", null).ok).toBe(true);
  });
  it("rejects an unknown category", () => {
    const r = validateVariantTaxonomy(TAXONOMY, "ghost", null);
    expect(r.ok).toBe(false);
  });
  it("rejects an inactive category", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "old-cat", null).ok).toBe(false);
  });
  it("rejects a subcategory that belongs to another category", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "giving", "specific-verse").ok).toBe(false);
  });
  it("rejects an inactive subcategory", () => {
    expect(validateVariantTaxonomy(TAXONOMY, "reader", "retired-sub").ok).toBe(false);
  });
});

describe("subcategoryHasVerseDeeplink", () => {
  it("is true only for specific-verse behavior", () => {
    expect(subcategoryHasVerseDeeplink(TAXONOMY, "specific-verse")).toBe(true);
    expect(subcategoryHasVerseDeeplink(TAXONOMY, "open-bible")).toBe(false);
    expect(subcategoryHasVerseDeeplink(TAXONOMY, null)).toBe(false);
  });
});
