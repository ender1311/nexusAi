export type LibrarySortMode = "default" | "name-asc" | "name-desc";

export const LIBRARY_SORT_OPTIONS: { value: LibrarySortMode; label: string }[] = [
  { value: "default",   label: "Default order" },
  { value: "name-asc",  label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
];

/** Sort library template variants by name; "default" preserves the incoming (sortOrder) order. */
export function sortLibraryVariants<T extends { name: string }>(variants: T[], mode: LibrarySortMode): T[] {
  if (mode === "default") return variants;
  const copy = [...variants];
  if (mode === "name-asc") copy.sort((a, b) => a.name.localeCompare(b.name));
  else if (mode === "name-desc") copy.sort((a, b) => b.name.localeCompare(a.name));
  return copy;
}
