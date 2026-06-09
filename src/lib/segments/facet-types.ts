export type FacetKind = "values" | "range";

export type ValueCount = { value: string; count: number };

export type ValuesFacetPayload = {
  top: ValueCount[];
  distinctApprox: number;
  total: number;
};

// numbers stored as number; dates stored as ISO strings (compute serializes per field type)
export type RangeFacetPayload = {
  min: number | string;
  max: number | string;
  p50: number | string;
  p90: number | string;
};

export type FieldFacet =
  | { kind: "values"; payload: ValuesFacetPayload }
  | { kind: "range"; payload: RangeFacetPayload };

export type FacetMap = Record<string, FieldFacet>;

export type FacetRow = { fieldId: string; kind: string; payload: unknown };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseValues(payload: unknown): ValuesFacetPayload | null {
  if (!isRecord(payload) || !Array.isArray(payload.top)) return null;
  const top: ValueCount[] = [];
  for (const entry of payload.top) {
    if (isRecord(entry) && typeof entry.value === "string" && typeof entry.count === "number") {
      top.push({ value: entry.value, count: entry.count });
    }
  }
  const distinctApprox = typeof payload.distinctApprox === "number" ? payload.distinctApprox : top.length;
  const total = typeof payload.total === "number" ? payload.total : 0;
  return { top, distinctApprox, total };
}

function isScalar(v: unknown): v is number | string {
  return typeof v === "number" || typeof v === "string";
}

function parseRange(payload: unknown): RangeFacetPayload | null {
  if (!isRecord(payload)) return null;
  const { min, max, p50, p90 } = payload;
  if (!isScalar(min) || !isScalar(max) || !isScalar(p50) || !isScalar(p90)) return null;
  return { min, max, p50, p90 };
}

/** Tolerant: never throws; a corrupt single row degrades to null rather than crashing all readers. */
export function parseFacetPayload(kind: string, payload: unknown): FieldFacet | null {
  if (kind === "values") {
    const p = parseValues(payload);
    return p ? { kind: "values", payload: p } : null;
  }
  if (kind === "range") {
    const p = parseRange(payload);
    return p ? { kind: "range", payload: p } : null;
  }
  return null;
}

export function buildFacetMap(rows: FacetRow[]): FacetMap {
  const map: FacetMap = {};
  for (const row of rows) {
    const facet = parseFacetPayload(row.kind, row.payload);
    if (facet) map[row.fieldId] = facet;
  }
  return map;
}
