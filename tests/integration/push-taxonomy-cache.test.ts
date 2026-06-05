import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { getPushTaxonomyUncached } from "@/lib/cache/push-taxonomy";

beforeEach(async () => {
  await truncateAll();
});
afterEach(async () => {
  await prisma.pushSubcategory.deleteMany();
  await prisma.pushCategory.deleteMany();
});

describe("getPushTaxonomyUncached", () => {
  it("returns categories ordered by sortOrder with nested subcategories", async () => {
    const giving = await prisma.pushCategory.create({
      data: { slug: "giving", label: "Giving", sortOrder: 1 },
    });
    const reader = await prisma.pushCategory.create({
      data: { slug: "reader", label: "Reader", sortOrder: 0 },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: reader.id, slug: "specific-verse", label: "Specific Verse", sortOrder: 1, deeplinkBehavior: "specific-verse" },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: reader.id, slug: "open-bible", label: "Open Bible", sortOrder: 0 },
    });
    await prisma.pushSubcategory.create({
      data: { categoryId: giving.id, slug: "eoy", label: "End of Year", sortOrder: 0 },
    });

    const tax = await getPushTaxonomyUncached();

    expect(tax.map((c) => c.slug)).toEqual(["reader", "giving"]);
    expect(tax[0].subcategories.map((s) => s.slug)).toEqual(["open-bible", "specific-verse"]);
    expect(tax[0].subcategories[1].deeplinkBehavior).toBe("specific-verse");
  });
});
