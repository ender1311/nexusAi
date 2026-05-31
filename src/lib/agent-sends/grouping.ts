import type { Filters, GroupedRows, SendRow, SortDir, SortField } from "./types";
import { formatDateGroup, toDateKey } from "./format";
import { isPendingDelivery } from "./pending-deadline";

export const DEFAULT_FILTERS: Filters = { status: "all", channel: "all", persona: "all" };

export function filtersActive(f: Filters): boolean {
  return f.status !== "all" || f.channel !== "all" || f.persona !== "all";
}

export function buildVariantNameMap(rows: SendRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.variantId && row.variantName) map.set(row.variantId, row.variantName);
  }
  return map;
}

export function applyFilters(rows: SendRow[], filters: Filters, nowMs: number): SendRow[] {
  return rows.filter((r) => {
    if (filters.status === "success" && r.failed) return false;
    if (filters.status === "failed" && !r.failed) return false;
    if (filters.status === "converted" && !r.conversionAt) return false;
    if (filters.status === "pending" && !isPendingDelivery(r, nowMs)) return false;
    if (filters.channel !== "all" && r.channel !== filters.channel) return false;
    if (filters.persona !== "all" && (r.personaName ?? "none") !== filters.persona) return false;
    return true;
  });
}

export function groupByDate(rows: SendRow[]): GroupedRows {
  const map = new Map<string, { label: string; rows: SendRow[] }>();
  for (const row of rows) {
    const key = toDateKey(row.sentAt);
    if (!map.has(key)) map.set(key, { label: formatDateGroup(row.sentAt), rows: [] });
    map.get(key)!.rows.push(row);
  }
  return Array.from(map.entries()).map(([dateKey, { label, rows }]) => ({ dateKey, label, rows }));
}

export function applySortToGroups(groups: GroupedRows, field: SortField, dir: SortDir): GroupedRows {
  if (field === "sentAt") {
    // Groups are already date-grouped; flip group order for asc/desc
    return dir === "asc" ? [...groups].reverse() : groups;
  }
  return groups.map((g) => ({
    ...g,
    rows: [...g.rows].sort((a, b) => {
      let av = "";
      let bv = "";
      if (field === "channel") { av = a.channel; bv = b.channel; }
      if (field === "persona") { av = a.personaName ?? ""; bv = b.personaName ?? ""; }
      if (field === "variant") { av = a.variantName ?? ""; bv = b.variantName ?? ""; }
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }),
  }));
}
