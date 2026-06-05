export type TaxonomySubcategory = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  deeplinkBehavior: string; // "specific-verse" | "none"
  isActive: boolean;
};

export type TaxonomyCategory = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  subcategories: TaxonomySubcategory[];
};

export type PushTaxonomy = TaxonomyCategory[];

/** Derive a stable slug from a human label. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findCategory(taxonomy: PushTaxonomy, slug: string): TaxonomyCategory | null {
  return taxonomy.find((c) => c.slug === slug) ?? null;
}

export function findSubcategory(taxonomy: PushTaxonomy, slug: string): TaxonomySubcategory | null {
  for (const c of taxonomy) {
    const s = c.subcategories.find((x) => x.slug === slug);
    if (s) return s;
  }
  return null;
}

export type TaxonomyValidation = { ok: true } | { ok: false; error: string };

/**
 * A variant must reference an active category. If it names a subcategory, that
 * subcategory must be active AND belong to the chosen category.
 */
export function validateVariantTaxonomy(
  taxonomy: PushTaxonomy,
  categorySlug: string,
  subcategorySlug: string | null,
): TaxonomyValidation {
  const cat = findCategory(taxonomy, categorySlug);
  if (!cat || !cat.isActive) return { ok: false, error: "Invalid category" };
  if (subcategorySlug == null || subcategorySlug === "") return { ok: true };
  const sub = cat.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub || !sub.isActive) return { ok: false, error: "Invalid subcategory for this category" };
  return { ok: true };
}

/** True when the subcategory's deeplink behavior is the specific-verse picker. */
export function subcategoryHasVerseDeeplink(
  taxonomy: PushTaxonomy,
  subcategorySlug: string | null,
): boolean {
  if (!subcategorySlug) return false;
  return findSubcategory(taxonomy, subcategorySlug)?.deeplinkBehavior === "specific-verse";
}
