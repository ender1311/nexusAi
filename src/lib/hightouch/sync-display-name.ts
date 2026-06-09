import type { HightouchSync } from "@/lib/hightouch/types";

const ABBREVS = new Set(["wau", "mau", "dau", "ba", "en", "us", "uk", "id", "yv"]);

export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (ABBREVS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** DB override (by sync id) → trimmed sync.name → humanized slug. Display-only. */
export function syncDisplayName(sync: HightouchSync, overrides: Record<string, string>): string {
  const override = overrides[String(sync.id)];
  if (override) return override;
  return sync.name?.trim() || humanizeSlug(sync.slug);
}
