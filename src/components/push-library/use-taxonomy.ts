"use client";

import { useCallback, useEffect, useState } from "react";

export type UISubcategory = { id: string; slug: string; label: string; sortOrder: number; deeplinkBehavior: string; isActive: boolean };
export type UICategory = { id: string; slug: string; label: string; sortOrder: number; isActive: boolean; subcategories: UISubcategory[] };

export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<UICategory[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/push-library/categories");
      const json = await res.json();
      setTaxonomy(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { taxonomy, loading, refresh };
}

/** Active categories only, with active subcategories — for pickers. */
export function activeTaxonomy(taxonomy: UICategory[]): UICategory[] {
  return taxonomy
    .filter((c) => c.isActive)
    .map((c) => ({ ...c, subcategories: c.subcategories.filter((s) => s.isActive) }));
}
