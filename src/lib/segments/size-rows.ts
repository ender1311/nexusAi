export type RuleSegInput = {
  id: string;
  name: string;
  description: string | null;
  estimate: number | null;
  sizeExact: number | null;
  sizeComputedAt: Date | null;
  updatedAt: Date;
};

export type HtSegInput = { name: string; userCount: number; assignedTo: string | null };

export type SizeRow =
  | {
      kind: "rule";
      id: string;
      name: string;
      description: string | null;
      estimate: number | null;
      sizeExact: number | null;
      sizeComputedAt: string | null;
      updatedAt: string;
    }
  | { kind: "hightouch"; name: string; userCount: number; assignedTo: string | null };

/** Best-available size used as the sort key. Invalid rule rows (no size) sort last. */
export function bestSize(row: SizeRow): number {
  if (row.kind === "hightouch") return row.userCount;
  return row.sizeExact ?? row.estimate ?? -1;
}

/** Merge rule-segments + Hightouch segments into one row model sorted by size, desc. Pure. */
export function mergeSegmentSizeRows(ruleSegs: RuleSegInput[], htSegs: HtSegInput[]): SizeRow[] {
  const rows: SizeRow[] = [
    ...ruleSegs.map(
      (r): SizeRow => ({
        kind: "rule",
        id: r.id,
        name: r.name,
        description: r.description,
        estimate: r.estimate,
        sizeExact: r.sizeExact,
        sizeComputedAt: r.sizeComputedAt ? r.sizeComputedAt.toISOString() : null,
        updatedAt: r.updatedAt.toISOString(),
      }),
    ),
    ...htSegs.map(
      (h): SizeRow => ({ kind: "hightouch", name: h.name, userCount: h.userCount, assignedTo: h.assignedTo }),
    ),
  ];
  return rows.sort((a, b) => bestSize(b) - bestSize(a));
}
