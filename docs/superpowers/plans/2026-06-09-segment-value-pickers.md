# Segment Builder Value Pickers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users build correct segments without knowing the data by surfacing the real stored values (with counts) as a searchable picker, plus min/max/median range hints for numeric/date fields.

**Architecture:** A cron job precomputes per-field facets (top values + counts, or numeric ranges) into a small `SegmentFieldFacet` cache table, reusing the rule compiler's catalog-derived SQL expression. The audience page server component bulk-loads the cache and passes it as a prop; the rule editor renders a searchable combobox (categorical) or a range hint (numeric/date), falling back to the existing free-text input when no facet exists. The picker is pure input-assistance — the chosen value flows through the unchanged `parse-rule` → `compile-sql` path.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon), bun:test, happy-dom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-09-segment-value-pickers-design.md`

---

## Standing constraints (read before starting)

- **Migrations:** NEVER run `prisma migrate dev` / `db push` — `prisma.config.ts` loads `.env.local` (PRODUCTION). Apply DDL idempotently to test DB and prod separately, then `prisma migrate resolve --applied`. After `prisma generate`, revert any `apps/api/src/generated/prisma/` churn with `git checkout -- apps/api/src/generated/prisma/`.
- **Local test DB env prefix** (prepend to every integration/regression run that touches the DB):
  ```
  env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test"
  ```
  Add `CRON_SECRET="test_cron_secret"` when running the cron route test.
- **Never run tests in the background.** Use `bun run check:quick` while iterating; `bun run check` before the MR.
- **Git:** direct-to-main is blocked. Ship via: commit → branch → push → `glab mr create` → poll `detailed_merge_status=mergeable` → `glab mr merge`. Use `glab`, NOT `gh`.
- **TypeScript:** no `any`; routes return `{data:T}`/`{error}` with correct status; parse/validate JSON DB fields on read.

---

## File Structure

**New files:**
- `src/lib/segments/facet-types.ts` — `FacetKind`, `ValuesFacetPayload`, `RangeFacetPayload`, `FieldFacet`, `FacetMap`; `parseFacetPayload()` (tolerant) + `buildFacetMap()`.
- `src/lib/segments/facet-labels.ts` — `countryName`/`languageName` maps; `formatFacetValueLabel()`; `formatRangeHint()`.
- `src/lib/segments/facet-filter.ts` — `filterFacetValues()` pure typeahead filter.
- `src/lib/segments/facet-compute.ts` — pure SQL builders (`valuesFacetSql`, `valuesStatsSql`, `rangeFacetSql`) + async `computeFieldFacet()`.
- `src/app/api/cron/refresh-segment-facets/route.ts` — `CRON_SECRET`-gated POST that upserts the cache.
- `src/components/segments/value-combobox.tsx` — searchable combobox with free-text fallback.
- Tests: `tests/unit/segment-facet-classification.test.ts`, `segment-facet-parse.test.ts`, `segment-facet-labels.test.ts`, `segment-facet-filter.test.ts`, `segment-facet-compute-sql.test.ts`, `value-editor.test.tsx`; `tests/integration/refresh-segment-facets.test.ts`; `tests/regression/segment-picker-compiles-identically.test.ts`.

**Modified files:**
- `prisma/schema.prisma` — add `SegmentFieldFacet` model.
- `prisma/migrations/<ts>_add_segment_field_facet/migration.sql` — DDL.
- `tests/helpers/db.ts` — add `segmentFieldFacet` to `truncateAll()`.
- `src/lib/segments/field-catalog.ts` — add `facet?` to `FieldDef` + classify fields.
- `src/lib/segments/compile-sql.ts` — extract `fieldSqlExpr(fieldId)` so facet-compute reuses it.
- `src/app/audience/segments/page.tsx` — load facet map.
- `src/components/segments/segment-builder.tsx` — thread `facetMap` prop → `EditorContext`.
- `src/components/segments/rule-node-editor.tsx` — dispatch on `field.facet`.

---

## Task 1: `SegmentFieldFacet` cache table + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model after the `Segment` model)
- Create: `prisma/migrations/<timestamp>_add_segment_field_facet/migration.sql`
- Modify: `tests/helpers/db.ts` (add cleanup in `truncateAll()`)

- [ ] **Step 1: Add the Prisma model**

In `prisma/schema.prisma`, add (place it adjacent to the other small lookup models like `SyncNameOverride`):

```prisma
model SegmentFieldFacet {
  fieldId    String   @id
  kind       String
  payload    Json
  computedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Create the idempotent migration SQL**

Create the folder with a fresh timestamp (use `date +%Y%m%d%H%M%S`), e.g. `prisma/migrations/20260609NNNNNN_add_segment_field_facet/migration.sql`:

```sql
CREATE TABLE IF NOT EXISTS "SegmentFieldFacet" (
  "fieldId"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "payload"    JSONB NOT NULL,
  "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SegmentFieldFacet_pkey" PRIMARY KEY ("fieldId")
);
```

- [ ] **Step 3: Apply to the local test DB**

Run:
```
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 \
  psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -f prisma/migrations/20260609NNNNNN_add_segment_field_facet/migration.sql
```
Expected: `CREATE TABLE` (or no error on re-run).

- [ ] **Step 4: Apply to production + reconcile migration history**

Run (uses the prod unpooled URL from `.env.local`):
```bash
set -a; source .env.local; set +a
psql -v ON_ERROR_STOP=1 "$DATABASE_URL_UNPOOLED" -f prisma/migrations/20260609NNNNNN_add_segment_field_facet/migration.sql
npx prisma migrate resolve --applied "20260609NNNNNN_add_segment_field_facet"
```
Expected: `CREATE TABLE`, then "Migration ... marked as applied".

- [ ] **Step 5: Regenerate the Prisma client and revert apps/api churn**

Run:
```bash
npx prisma generate
git checkout -- apps/api/src/generated/prisma/ 2>/dev/null || true
```
Expected: client regenerated; `prisma.segmentFieldFacet` now exists.

- [ ] **Step 6: Add the table to `truncateAll()`**

In `tests/helpers/db.ts`, add this line near the other optional lookup tables (e.g. right after the `syncNameOverride.deleteMany()` line):

```ts
  await prisma.segmentFieldFacet.deleteMany().catch(() => {});
```

- [ ] **Step 7: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0 (the new `prisma.segmentFieldFacet` model resolves).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.ts
git commit -m "feat(segments): add SegmentFieldFacet cache table"
```

---

## Task 2: Facet types + tolerant parser

**Files:**
- Create: `src/lib/segments/facet-types.ts`
- Test: `tests/unit/segment-facet-parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-facet-parse.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { parseFacetPayload, buildFacetMap } from "@/lib/segments/facet-types";

describe("parseFacetPayload", () => {
  it("parses a values payload", () => {
    const f = parseFacetPayload("values", { top: [{ value: "US", count: 10 }], distinctApprox: 3, total: 12 });
    expect(f).toEqual({ kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 3, total: 12 } });
  });

  it("parses a range payload", () => {
    const f = parseFacetPayload("range", { min: 0, max: 365, p50: 12, p90: 200 });
    expect(f).toEqual({ kind: "range", payload: { min: 0, max: 365, p50: 12, p90: 200 } });
  });

  it("returns null for an unknown kind", () => {
    expect(parseFacetPayload("bogus", {})).toBeNull();
  });

  it("returns null for a corrupt values payload (top not an array)", () => {
    expect(parseFacetPayload("values", { top: "nope", distinctApprox: 1, total: 1 })).toBeNull();
  });

  it("drops corrupt entries inside top but keeps valid ones", () => {
    const f = parseFacetPayload("values", { top: [{ value: "US", count: 10 }, { value: 5, count: "x" }], distinctApprox: 1, total: 11 });
    expect(f).toEqual({ kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 1, total: 11 } });
  });

  it("buildFacetMap skips rows that fail to parse", () => {
    const map = buildFacetMap([
      { fieldId: "country_latest", kind: "values", payload: { top: [{ value: "US", count: 9 }], distinctApprox: 1, total: 9 } },
      { fieldId: "broken", kind: "values", payload: { top: 42 } },
    ]);
    expect(Object.keys(map)).toEqual(["country_latest"]);
    expect(map.country_latest!.kind).toBe("values");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-facet-parse.test.ts`
Expected: FAIL — `Cannot find module '@/lib/segments/facet-types'`.

- [ ] **Step 3: Implement `facet-types.ts`**

Create `src/lib/segments/facet-types.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-facet-parse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/facet-types.ts tests/unit/segment-facet-parse.test.ts
git commit -m "feat(segments): facet payload types + tolerant parser"
```

---

## Task 3: Friendly labels + range hint formatting

**Files:**
- Create: `src/lib/segments/facet-labels.ts`
- Test: `tests/unit/segment-facet-labels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-facet-labels.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { formatFacetValueLabel, formatRangeHint } from "@/lib/segments/facet-labels";

describe("formatFacetValueLabel", () => {
  it("annotates a mapped country code with its name + count", () => {
    expect(formatFacetValueLabel("country_latest", "US", 174018)).toBe("US · United States — 174,018");
  });

  it("annotates a mapped language tag", () => {
    expect(formatFacetValueLabel("language_tag", "en", 5000)).toBe("en · English — 5,000");
  });

  it("falls back to raw value + count for an unmapped country code", () => {
    expect(formatFacetValueLabel("country_latest", "ZZ", 3)).toBe("ZZ — 3");
  });

  it("shows just value + count for a non-country/language field", () => {
    expect(formatFacetValueLabel("preferred_channel_overall_30_days", "push_notification", 42)).toBe("push_notification — 42");
  });
});

describe("formatRangeHint", () => {
  it("formats a numeric range with median", () => {
    expect(formatRangeHint("number", { min: 0, max: 365, p50: 12, p90: 200 })).toBe("In data: 0–365 · median 12");
  });

  it("formats a date range using calendar dates", () => {
    const hint = formatRangeHint("date", { min: "2024-01-01T00:00:00.000Z", max: "2026-06-01T00:00:00.000Z", p50: "2025-03-15T00:00:00.000Z", p90: "2026-01-01T00:00:00.000Z" });
    expect(hint).toBe("In data: 2024-01-01–2026-06-01 · median 2025-03-15");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-facet-labels.test.ts`
Expected: FAIL — `Cannot find module '@/lib/segments/facet-labels'`.

- [ ] **Step 3: Implement `facet-labels.ts`**

Create `src/lib/segments/facet-labels.ts`. Include a reasonably complete ISO-3166 alpha-2 map and a common BCP-47/ISO-639 map (the excerpt below is illustrative — populate the full ~200 country codes and the common language tags; unmapped codes simply fall back to the raw value):

```ts
import type { FieldType } from "@/types/segment";
import type { RangeFacetPayload } from "./facet-types";

// ISO-3166 alpha-2 → English name. Populate the full set (~200). Unmapped codes
// degrade gracefully to the raw value, so partial coverage is safe.
export const countryName: Record<string, string> = {
  US: "United States", GB: "United Kingdom", CA: "Canada", AU: "Australia",
  DE: "Germany", FR: "France", ES: "Spain", BR: "Brazil", MX: "Mexico",
  IN: "India", PH: "Philippines", NG: "Nigeria", ZA: "South Africa",
  KE: "Kenya", ID: "Indonesia", JP: "Japan", KR: "South Korea", IT: "Italy",
  NL: "Netherlands", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland",
  // … complete the remaining ISO-3166 alpha-2 codes …
};

// Common BCP-47 / ISO-639 tags → English name. Bare language and region variants.
export const languageName: Record<string, string> = {
  en: "English", "en-US": "English (US)", "en-GB": "English (UK)",
  es: "Spanish", "es-MX": "Spanish (Mexico)", "es-ES": "Spanish (Spain)",
  pt: "Portuguese", "pt-BR": "Portuguese (Brazil)", fr: "French",
  de: "German", it: "Italian", nl: "Dutch", id: "Indonesian", tl: "Tagalog",
  ko: "Korean", ja: "Japanese", zh: "Chinese", ru: "Russian", ar: "Arabic",
  // … extend as needed …
};

function nameFor(fieldId: string, value: string): string | undefined {
  if (fieldId === "country_latest") return countryName[value];
  if (fieldId === "language_tag") return languageName[value];
  return undefined;
}

export function formatFacetValueLabel(fieldId: string, value: string, count: number): string {
  const friendly = nameFor(fieldId, value);
  const countStr = count.toLocaleString("en-US");
  return friendly ? `${value} · ${friendly} — ${countStr}` : `${value} — ${countStr}`;
}

function fmt(type: FieldType, v: number | string): string {
  if (type === "date") return String(v).slice(0, 10); // ISO → YYYY-MM-DD
  return String(v);
}

export function formatRangeHint(type: FieldType, payload: RangeFacetPayload): string {
  return `In data: ${fmt(type, payload.min)}–${fmt(type, payload.max)} · median ${fmt(type, payload.p50)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-facet-labels.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/facet-labels.ts tests/unit/segment-facet-labels.test.ts
git commit -m "feat(segments): friendly value labels + range hint formatting"
```

---

## Task 4: Typeahead filter helper

**Files:**
- Create: `src/lib/segments/facet-filter.ts`
- Test: `tests/unit/segment-facet-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-facet-filter.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { filterFacetValues } from "@/lib/segments/facet-filter";

const values = [
  { value: "US", count: 174018 },
  { value: "GB", count: 50000 },
  { value: "DE", count: 9000 },
];

describe("filterFacetValues", () => {
  it("returns the full list (count-desc) for an empty query", () => {
    expect(filterFacetValues(values, "", "country_latest")).toEqual(values);
  });

  it("matches on the raw value, case-insensitively", () => {
    expect(filterFacetValues(values, "gb", "country_latest").map((v) => v.value)).toEqual(["GB"]);
  });

  it("matches on the friendly name", () => {
    expect(filterFacetValues(values, "united", "country_latest").map((v) => v.value)).toEqual(["US", "GB"]);
  });

  it("preserves count-desc order in matches", () => {
    expect(filterFacetValues(values, "united", "country_latest").map((v) => v.count)).toEqual([174018, 50000]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterFacetValues(values, "zzz", "country_latest")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-facet-filter.test.ts`
Expected: FAIL — `Cannot find module '@/lib/segments/facet-filter'`.

- [ ] **Step 3: Implement `facet-filter.ts`**

Create `src/lib/segments/facet-filter.ts`:

```ts
import type { ValueCount } from "./facet-types";
import { countryName, languageName } from "./facet-labels";

function friendlyName(fieldId: string, value: string): string {
  if (fieldId === "country_latest") return countryName[value] ?? "";
  if (fieldId === "language_tag") return languageName[value] ?? "";
  return "";
}

/**
 * Case-insensitive substring match on BOTH the raw value and its friendly name,
 * so a user typing "united" finds "US". Input is already count-desc; we filter
 * in place, preserving that order.
 */
export function filterFacetValues(values: ValueCount[], query: string, fieldId: string): ValueCount[] {
  const q = query.trim().toLowerCase();
  if (q === "") return values;
  return values.filter(({ value }) => {
    const name = friendlyName(fieldId, value).toLowerCase();
    return value.toLowerCase().includes(q) || name.includes(q);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-facet-filter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/facet-filter.ts tests/unit/segment-facet-filter.test.ts
git commit -m "feat(segments): typeahead filter over facet values"
```

---

## Task 5: Catalog `facet` metadata + exhaustive classification test

**Files:**
- Modify: `src/lib/segments/field-catalog.ts:12-20` (FieldDef) and `:30-53` (catalog entries)
- Test: `tests/unit/segment-facet-classification.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-facet-classification.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";

const VALUES_FIELDS = new Set(["country_latest", "language_tag", "timezone", "preferred_channel_overall_30_days"]);
const RANGE_FIELDS = new Set(["createdAt", "totalDecisions", "totalConversions", "days_since_last_open", "gift_count_lifetime", "push_sent", "push_converted"]);
const EXCLUDED_FIELDS = new Set(["funnelStage", "persona", "segment_membership", "email", "has_recurring_gift", "newsletter_push_enabled", "newsletter_email_enabled"]);

describe("facet classification", () => {
  it("classifies every catalog field exactly once (values | range | excluded)", () => {
    for (const f of FIELD_CATALOG) {
      const inValues = VALUES_FIELDS.has(f.id);
      const inRange = RANGE_FIELDS.has(f.id);
      const inExcluded = EXCLUDED_FIELDS.has(f.id);
      expect([inValues, inRange, inExcluded].filter(Boolean).length, `field ${f.id} must be classified once`).toBe(1);
    }
  });

  it("tags values fields with facet.kind = values", () => {
    for (const f of FIELD_CATALOG.filter((x) => VALUES_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toEqual({ kind: "values" });
    }
  });

  it("tags range fields with facet.kind = range", () => {
    for (const f of FIELD_CATALOG.filter((x) => RANGE_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toEqual({ kind: "range" });
    }
  });

  it("leaves excluded fields without a facet", () => {
    for (const f of FIELD_CATALOG.filter((x) => EXCLUDED_FIELDS.has(x.id))) {
      expect(f.facet, f.id).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-facet-classification.test.ts`
Expected: FAIL — `facet` is not a property on the catalog entries (the values/range assertions fail).

- [ ] **Step 3: Add `facet` to `FieldDef` and the catalog entries**

In `src/lib/segments/field-catalog.ts`, add the type import and field. First add near the top type definitions:

```ts
export type FieldFacet = { kind: "values" | "range" };
```

Then extend `FieldDef` (after the `enumValues?` line):

```ts
  enumValues?: { value: string; label: string }[];
  facet?: FieldFacet;
  compile: FieldCompile;
```

Then add `facet` to the relevant catalog entries (append the property on each line):

- `timezone` → add `facet: { kind: "values" },`
- `createdAt` → add `facet: { kind: "range" },`
- `totalDecisions` → add `facet: { kind: "range" },`
- `totalConversions` → add `facet: { kind: "range" },`
- `country_latest` → add `facet: { kind: "values" },`
- `language_tag` → add `facet: { kind: "values" },`
- `days_since_last_open` → add `facet: { kind: "range" },`
- `gift_count_lifetime` → add `facet: { kind: "range" },`
- `preferred_channel_overall_30_days` → add `facet: { kind: "values" },`
- `push_sent` → add `facet: { kind: "range" },`
- `push_converted` → add `facet: { kind: "range" },`

Do NOT add `facet` to `funnelStage`, `persona`, `email`, `has_recurring_gift`, `newsletter_push_enabled`, `newsletter_email_enabled`, or `segment_membership`.

Example (the `country_latest` line becomes):

```ts
  { id: "country_latest", label: "Country", category: "attribute", type: "string", operators: STR_OPS, facet: { kind: "values" }, compile: { strategy: "attr", key: "country_latest", cast: "text" } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-facet-classification.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/field-catalog.ts tests/unit/segment-facet-classification.test.ts
git commit -m "feat(segments): classify catalog fields with facet metadata"
```

---

## Task 6: Facet compute SQL builders + reuse `fieldSqlExpr`

**Files:**
- Modify: `src/lib/segments/compile-sql.ts:18-40` (extract `fieldSqlExpr`)
- Create: `src/lib/segments/facet-compute.ts` (pure builders only in this task)
- Test: `tests/unit/segment-facet-compute-sql.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/segment-facet-compute-sql.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { valuesFacetSql, valuesStatsSql, rangeFacetSql } from "@/lib/segments/facet-compute";

describe("facet compute SQL builders", () => {
  it("values SQL for an attribute field uses the JSON expression and orders by count desc", () => {
    const sql = valuesFacetSql("country_latest");
    expect(sql).toContain(`u."attributes"->>'country_latest'`);
    expect(sql).toContain(`FROM "User" u`);
    expect(sql).toContain("GROUP BY 1");
    expect(sql).toContain("ORDER BY c DESC");
    expect(sql).toContain("LIMIT 50");
  });

  it("values stats SQL counts distinct + non-null total", () => {
    const sql = valuesStatsSql("country_latest");
    expect(sql).toContain(`COUNT(DISTINCT u."attributes"->>'country_latest')`);
    expect(sql).toContain(`FILTER (WHERE u."attributes"->>'country_latest' IS NOT NULL)`);
  });

  it("range SQL for a scalar numeric column uses min/max/percentile_disc", () => {
    const sql = rangeFacetSql("totalDecisions");
    expect(sql).toContain(`MIN(u."totalDecisions")`);
    expect(sql).toContain(`MAX(u."totalDecisions")`);
    expect(sql).toContain(`PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY u."totalDecisions")`);
    expect(sql).toContain(`PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY u."totalDecisions")`);
  });

  it("range SQL for a channelStat field casts to numeric", () => {
    const sql = rangeFacetSql("push_sent");
    expect(sql).toContain(`(u."channelStats"->'push'->>'sent')::numeric`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-facet-compute-sql.test.ts`
Expected: FAIL — `Cannot find module '@/lib/segments/facet-compute'`.

- [ ] **Step 3: Extract `fieldSqlExpr` in `compile-sql.ts`**

In `src/lib/segments/compile-sql.ts`, replace the `leftExpr` function (lines 18-40) with an exported `fieldSqlExpr(fieldId)` that `leftExpr` delegates to:

```ts
export function fieldSqlExpr(fieldId: string): { expr: string; isAttr: boolean; attrKey?: string } {
  // The only place catalog identifiers enter the SQL string; guard against forged
  // rules that skipped the parser.
  const field = getField(fieldId);
  if (!field) throw new Error(`Unknown segment field: ${fieldId}`);
  const compile = field.compile;
  switch (compile.strategy) {
    case "scalar":
      return { expr: `u."${compile.column}"`, isAttr: false };
    case "attr": {
      const base = `u."attributes"->>'${compile.key}'`;
      const expr = compile.cast === "numeric" ? `(${base})::numeric`
        : compile.cast === "boolean" ? `(${base})::boolean`
        : base;
      return { expr, isAttr: true, attrKey: compile.key };
    }
    case "channelStat":
      return { expr: `(u."channelStats"->'${compile.channel}'->>'${compile.metric}')::numeric`, isAttr: false };
    case "segment":
      return { expr: "", isAttr: false };
  }
}

function leftExpr(c: Condition): { expr: string; isAttr: boolean; attrKey?: string } {
  return fieldSqlExpr(c.fieldId);
}
```

- [ ] **Step 4: Verify existing compile tests still pass**

Run: `bun test tests/unit/segment-compile-sql.test.ts`
Expected: PASS (no behavior change — pure refactor).

- [ ] **Step 5: Implement the pure builders in `facet-compute.ts`**

Create `src/lib/segments/facet-compute.ts`:

```ts
import { fieldSqlExpr } from "./compile-sql";

const TOP_LIMIT = 50;

export function valuesFacetSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT ${expr} AS v, COUNT(*)::bigint AS c FROM "User" u WHERE ${expr} IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT ${TOP_LIMIT}`;
}

export function valuesStatsSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  return `SELECT COUNT(DISTINCT ${expr})::bigint AS distinct_approx, COUNT(*) FILTER (WHERE ${expr} IS NOT NULL)::bigint AS total FROM "User" u`;
}

export function rangeFacetSql(fieldId: string): string {
  const { expr } = fieldSqlExpr(fieldId);
  // PERCENTILE_DISC works for both numeric and timestamp columns (returns an actual
  // data point), so one builder covers numeric and date range fields.
  return `SELECT MIN(${expr}) AS min, MAX(${expr}) AS max, ` +
    `PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY ${expr}) AS p50, ` +
    `PERCENTILE_DISC(0.9) WITHIN GROUP (ORDER BY ${expr}) AS p90 ` +
    `FROM "User" u WHERE ${expr} IS NOT NULL`;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/segment-facet-compute-sql.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/segments/compile-sql.ts src/lib/segments/facet-compute.ts tests/unit/segment-facet-compute-sql.test.ts
git commit -m "feat(segments): facet compute SQL builders reusing catalog expr"
```

---

## Task 7: Facet compute runner + cron route

**Files:**
- Modify: `src/lib/segments/facet-compute.ts` (add async `computeFieldFacet`)
- Create: `src/app/api/cron/refresh-segment-facets/route.ts`
- Modify: `vercel.json` (register the cron)
- Test: `tests/integration/refresh-segment-facets.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/refresh-segment-facets.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "bun:test";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/refresh-segment-facets/route";
import { truncateAll, prisma } from "@/tests/helpers/db";
import { createUser } from "@/tests/helpers/builders";

function authedReq(): NextRequest {
  return new NextRequest("http://localhost/api/cron/refresh-segment-facets", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

describe("POST /api/cron/refresh-segment-facets", () => {
  beforeEach(async () => { await truncateAll(); });

  it("rejects an unauthenticated request with 401", async () => {
    const req = new NextRequest("http://localhost/api/cron/refresh-segment-facets", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("computes a values facet for country with counts desc", async () => {
    await createUser("u1", { attributes: { country_latest: "US" } });
    await createUser("u2", { attributes: { country_latest: "US" } });
    await createUser("u3", { attributes: { country_latest: "GB" } });

    const res = await POST(authedReq());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { refreshed: string[]; failed: string[] } };
    expect(body.data.refreshed).toContain("country_latest");

    const row = await prisma.segmentFieldFacet.findUnique({ where: { fieldId: "country_latest" } });
    expect(row?.kind).toBe("values");
    const payload = row!.payload as { top: { value: string; count: number }[]; total: number };
    expect(payload.top[0]).toEqual({ value: "US", count: 2 });
    expect(payload.top.find((t) => t.value === "GB")?.count).toBe(1);
    expect(payload.total).toBe(3);
  });

  it("computes a range facet for a numeric field", async () => {
    await createUser("u1", { totalDecisions: 0 });
    await createUser("u2", { totalDecisions: 10 });
    await createUser("u3", { totalDecisions: 100 });

    await POST(authedReq());

    const row = await prisma.segmentFieldFacet.findUnique({ where: { fieldId: "totalDecisions" } });
    expect(row?.kind).toBe("range");
    const payload = row!.payload as { min: number; max: number };
    expect(Number(payload.min)).toBe(0);
    expect(Number(payload.max)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" CRON_SECRET="test_cron_secret" \
  bun test tests/integration/refresh-segment-facets.test.ts
```
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Add `computeFieldFacet` to `facet-compute.ts`**

Append to `src/lib/segments/facet-compute.ts`:

```ts
import { prisma } from "@/lib/db";
import type { FieldDef } from "./field-catalog";
import type { FieldFacet, ValueCount } from "./facet-types";

const COMPUTE_TIMEOUT_MS = 60_000;

/** Runs the right aggregation for a field's facet kind and assembles the payload. */
export async function computeFieldFacet(field: FieldDef): Promise<FieldFacet> {
  if (!field.facet) throw new Error(`Field ${field.id} has no facet`);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${COMPUTE_TIMEOUT_MS}`);

    if (field.facet!.kind === "values") {
      const topRows = await tx.$queryRawUnsafe<Array<{ v: string | null; c: bigint }>>(valuesFacetSql(field.id));
      const statRows = await tx.$queryRawUnsafe<Array<{ distinct_approx: bigint; total: bigint }>>(valuesStatsSql(field.id));
      const top: ValueCount[] = topRows
        .filter((r): r is { v: string; c: bigint } => r.v !== null)
        .map((r) => ({ value: r.v, count: Number(r.c) }));
      return {
        kind: "values",
        payload: {
          top,
          distinctApprox: Number(statRows[0]?.distinct_approx ?? 0n),
          total: Number(statRows[0]?.total ?? 0n),
        },
      };
    }

    // range
    const rows = await tx.$queryRawUnsafe<Array<{ min: unknown; max: unknown; p50: unknown; p90: unknown }>>(rangeFacetSql(field.id));
    const r = rows[0] ?? { min: 0, max: 0, p50: 0, p90: 0 };
    const ser = (v: unknown): number | string =>
      v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : String(v ?? "");
    return { kind: "range", payload: { min: ser(r.min), max: ser(r.max), p50: ser(r.p50), p90: ser(r.p90) } };
  }, { timeout: COMPUTE_TIMEOUT_MS + 1_000 });
}
```

- [ ] **Step 4: Implement the cron route**

Create `src/app/api/cron/refresh-segment-facets/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";
import { computeFieldFacet } from "@/lib/segments/facet-compute";
import type { Prisma } from "@/generated/prisma/client";

// Allow up to 300s execution time on Vercel.
export const maxDuration = 300;

type RefreshSummary = { refreshed: string[]; failed: string[] };

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(req: NextRequest): Promise<NextResponse<{ data: RefreshSummary } | { error: string }>> {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refreshed: string[] = [];
  const failed: string[] = [];

  for (const field of FIELD_CATALOG) {
    if (!field.facet) continue;
    try {
      const facet = await computeFieldFacet(field);
      await prisma.segmentFieldFacet.upsert({
        where: { fieldId: field.id },
        create: { fieldId: field.id, kind: facet.kind, payload: facet.payload as Prisma.InputJsonValue },
        update: { kind: facet.kind, payload: facet.payload as Prisma.InputJsonValue },
      });
      refreshed.push(field.id);
    } catch (err) {
      // One slow/failing field must not abort the whole refresh.
      console.error(`refresh-segment-facets ${field.id}:`, err);
      failed.push(field.id);
    }
  }

  return NextResponse.json({ data: { refreshed, failed } }, { status: 200 });
}
```

- [ ] **Step 5: Register the cron in `vercel.json`**

In `vercel.json`, add to the `crons` array (daily — categorical data drifts slowly):

```json
    {
      "path": "/api/cron/refresh-segment-facets",
      "schedule": "30 4 * * *"
    }
```

- [ ] **Step 6: Run the integration test to verify it passes**

Run:
```
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" CRON_SECRET="test_cron_secret" \
  bun test tests/integration/refresh-segment-facets.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/segments/facet-compute.ts src/app/api/cron/refresh-segment-facets/route.ts vercel.json tests/integration/refresh-segment-facets.test.ts
git commit -m "feat(segments): refresh-segment-facets cron + compute runner"
```

---

## Task 8: Server-load the facet map into the builder

**Files:**
- Modify: `src/app/audience/segments/page.tsx:8-22`
- Modify: `src/components/segments/segment-builder.tsx:12-20,106-114`
- Modify: `src/components/segments/rule-node-editor.tsx:7-15` (extend `EditorContext`)

This task wires data through; it's exercised by the component test in Task 9 and a full build. No new standalone test here, but it MUST typecheck.

- [ ] **Step 1: Load facets in the page**

In `src/app/audience/segments/page.tsx`, add the import and the query, and pass the prop:

```ts
import { buildFacetMap } from "@/lib/segments/facet-types";
```

Change the `Promise.all` to also fetch facet rows:

```ts
  const [rows, personas, segmentNames, facetRows] = await Promise.all([
    prisma.segment.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true, description: true, updatedAt: true } }),
    prisma.persona.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.userSegment.findMany({ distinct: ["segmentName"], select: { segmentName: true }, orderBy: { segmentName: "asc" } }),
    prisma.segmentFieldFacet.findMany({ select: { fieldId: true, kind: true, payload: true } }),
  ]);

  const facetMap = buildFacetMap(facetRows);
```

And pass it to the builder:

```tsx
        <SegmentBuilder segments={segments} personaOptions={personaOptions} segmentNameOptions={segmentNameOptions} facetMap={facetMap} />
```

- [ ] **Step 2: Thread the prop through `SegmentBuilder`**

In `src/components/segments/segment-builder.tsx`:

Add the import:
```ts
import type { FacetMap } from "@/lib/segments/facet-types";
```

Extend `Props`:
```ts
type Props = {
  segments: SegmentSummary[];
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
  facetMap: FacetMap;
};
```

Update the signature:
```ts
export function SegmentBuilder({ segments, personaOptions, segmentNameOptions, facetMap }: Props) {
```

Add `facetMap` to the `ctx` object (alongside `personaOptions`):
```ts
  const ctx: EditorContext = {
    personaOptions,
    segmentNameOptions,
    facetMap,
    onAddCondition: useCallback((path) => setRule((r) => addChild(r, path, firstCondition())), []),
    // … rest unchanged …
  };
```

- [ ] **Step 3: Extend `EditorContext`**

In `src/components/segments/rule-node-editor.tsx`, add the import and field:

```ts
import type { FacetMap } from "@/lib/segments/facet-types";
```

```ts
export type EditorContext = {
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
  facetMap: FacetMap;
  onAddCondition: (path: number[]) => void;
  onAddGroup: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onChangeCondition: (path: number[], next: Condition) => void;
  onToggleJoin: (path: number[], join: "AND" | "OR") => void;
};
```

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/audience/segments/page.tsx src/components/segments/segment-builder.tsx src/components/segments/rule-node-editor.tsx
git commit -m "feat(segments): load facet map into the rule editor context"
```

---

## Task 9: ValueCombobox + ValueEditor dispatch

**Files:**
- Create: `src/components/segments/value-combobox.tsx`
- Modify: `src/components/segments/rule-node-editor.tsx:38-105` (`ValueEditor`)
- Test: `tests/unit/value-editor.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/value-editor.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RuleNodeEditor, type EditorContext } from "@/components/segments/rule-node-editor";
import type { Condition } from "@/types/segment";
import type { FacetMap } from "@/lib/segments/facet-types";

afterEach(() => cleanup());

function makeCtx(facetMap: FacetMap, onChange: (path: number[], next: Condition) => void): EditorContext {
  return {
    personaOptions: [],
    segmentNameOptions: [],
    facetMap,
    onAddCondition: () => {},
    onAddGroup: () => {},
    onRemove: () => {},
    onChangeCondition: onChange,
    onToggleJoin: () => {},
  };
}

const countryFacet: FacetMap = {
  country_latest: { kind: "values", payload: { top: [{ value: "US", count: 174018 }, { value: "GB", count: 50000 }], distinctApprox: 2, total: 224018 } },
};

describe("ValueEditor facet dispatch", () => {
  it("renders a searchable combobox for a values-facet field and commits a picked value", () => {
    let captured: Condition | null = null;
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(countryFacet, (_p, n) => { captured = n; })} />);

    const input = screen.getByRole("combobox", { name: /value/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "united" } });
    // "US · United States — 174,018" matches "united" via the friendly name
    fireEvent.click(screen.getByText(/United States/));
    expect(captured).toEqual({ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" });
  });

  it("commits a free-text value not present in the suggestions", () => {
    let captured: Condition | null = null;
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(countryFacet, (_p, n) => { captured = n; })} />);

    const input = screen.getByRole("combobox", { name: /value/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "XK" } });
    fireEvent.click(screen.getByText(/Use "XK"/));
    expect(captured).toEqual({ kind: "condition", fieldId: "country_latest", operator: "eq", value: "XK" });
  });

  it("renders a range hint for a numeric facet field", () => {
    const facetMap: FacetMap = { totalDecisions: { kind: "range", payload: { min: 0, max: 365, p50: 12, p90: 200 } } };
    const node: Condition = { kind: "condition", fieldId: "totalDecisions", operator: "gt", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(facetMap, () => {})} />);
    expect(screen.getByText("In data: 0–365 · median 12")).toBeInTheDocument();
  });

  it("renders a plain text input for email (no facet)", () => {
    const node: Condition = { kind: "condition", fieldId: "email", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx({}, () => {})} />);
    expect(screen.queryByRole("combobox", { name: /value/i })).toBeNull();
    expect(screen.queryByText(/In data:/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/value-editor.test.tsx`
Expected: FAIL — combobox role not found (current free-text input renders for country).

- [ ] **Step 3: Implement `ValueCombobox`**

Create `src/components/segments/value-combobox.tsx`:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ValueCount } from "@/lib/segments/facet-types";
import { filterFacetValues } from "@/lib/segments/facet-filter";
import { formatFacetValueLabel } from "@/lib/segments/facet-labels";

type Props = {
  fieldId: string;
  values: ValueCount[];
  multi: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
};

export function ValueCombobox({ fieldId, values, multi, selected, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = filterFacetValues(values, query, fieldId);
  const exact = query.trim() !== "" && values.some((v) => v.value === query.trim());

  function commit(value: string) {
    if (multi) {
      if (!selected.includes(value)) onChange([...selected, value]);
    } else {
      onChange([value]);
    }
    setQuery("");
    setOpen(false);
  }

  function removeChip(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  const inputClass = "rounded border bg-background px-2 py-1 text-sm";

  return (
    <div className="relative inline-flex flex-col gap-1">
      {multi && selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              {v}
              <button onClick={() => removeChip(v)} aria-label={`Remove ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        role="combobox"
        aria-expanded={open}
        aria-label="Value"
        className={inputClass}
        value={multi ? query : (query !== "" ? query : selected[0] ?? "")}
        placeholder={multi ? "search values…" : "select or type…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="absolute top-full z-10 mt-1 max-h-56 w-64 overflow-auto rounded border bg-background shadow">
          {matches.map((m) => (
            <li key={m.value}>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => commit(m.value)}
              >
                {formatFacetValueLabel(fieldId, m.value, m.count)}
              </button>
            </li>
          ))}
          {query.trim() !== "" && !exact && (
            <li>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left text-sm italic text-muted-foreground hover:bg-muted"
                onClick={() => commit(query.trim())}
              >
                Use "{query.trim()}"
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the dispatch in `ValueEditor`**

In `src/components/segments/rule-node-editor.tsx`, add imports at the top:

```ts
import { ValueCombobox } from "./value-combobox";
import { formatRangeHint } from "@/lib/segments/facet-labels";
```

Then, inside `ValueEditor`, AFTER the enum block (after the `if (enumOptions !== undefined) { … }` block, around line 81) and BEFORE the free-text return, insert the facet branches:

```ts
  // Data-driven value picker for categorical facet fields.
  const facet = ctx.facetMap[field.id];
  if (facet?.kind === "values") {
    const isMultiOp = MULTI_OPS.includes(node.operator);
    const selected = isMultiOp
      ? (Array.isArray(node.value) ? node.value.map(String) : [])
      : (typeof node.value === "string" && node.value !== "" ? [node.value] : []);
    return (
      <ValueCombobox
        fieldId={field.id}
        values={facet.payload.top}
        multi={isMultiOp}
        selected={selected}
        onChange={(next) => {
          const value = isMultiOp ? next : (next[0] ?? null);
          ctx.onChangeCondition(path, { ...node, value });
        }}
      />
    );
  }

  // Range hint for numeric/date facet fields: keep the existing input, add a hint line.
  if (facet?.kind === "range") {
    return (
      <span className="inline-flex flex-col gap-0.5">
        {renderFreeText()}
        <span className="text-[10px] text-muted-foreground">{formatRangeHint(field.type, facet.payload)}</span>
      </span>
    );
  }

  return renderFreeText();
```

To avoid duplicating the free-text input, refactor the existing free-text `return (<input … />)` (lines 85-103) into a local `renderFreeText()` function declared just above these branches:

```ts
  const isMulti = MULTI_OPS.includes(node.operator);
  function renderFreeText() {
    return (
      <input
        className={selectClass}
        value={node.value === null ? "" : Array.isArray(node.value) ? node.value.join(",") : String(node.value)}
        placeholder={isMulti ? "comma,separated" : "value"}
        onChange={(e) => {
          const raw = e.target.value;
          let value: Condition["value"];
          if (isMulti) {
            value = raw.split(",").map((s) => s.trim()).filter(Boolean);
          } else if (field!.type === "number") {
            const n = Number(raw);
            value = raw.trim() === "" || Number.isNaN(n) ? null : n;
          } else {
            value = raw;
          }
          ctx.onChangeCondition(path, { ...node, value });
        }}
      />
    );
  }
```

(Place `renderFreeText` and the `facet` branches after the enum block; `field` is non-undefined here because the function returns early at the top when `field === undefined`.)

- [ ] **Step 5: Run the component test to verify it passes**

Run: `bun test tests/unit/value-editor.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/segments/value-combobox.tsx src/components/segments/rule-node-editor.tsx tests/unit/value-editor.test.tsx
git commit -m "feat(segments): value combobox + range hint in the rule editor"
```

---

## Task 10: Regression — picker value compiles identically to hand-typed

**Files:**
- Test: `tests/regression/segment-picker-compiles-identically.test.ts`

- [ ] **Step 1: Write the regression test**

Create `tests/regression/segment-picker-compiles-identically.test.ts`:

```ts
// Regression: the value picker is pure input-assistance. A value chosen via the
// combobox must flow through the unchanged parse-rule → compile-sql path and
// produce byte-identical SQL + params as the same value typed by hand.
// Spec: docs/superpowers/specs/2026-06-09-segment-value-pickers-design.md
import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RuleNodeEditor, type EditorContext } from "@/components/segments/rule-node-editor";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { Condition, SegmentRule } from "@/types/segment";
import type { FacetMap } from "@/lib/segments/facet-types";

afterEach(() => cleanup());

const facetMap: FacetMap = {
  country_latest: { kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 1, total: 10 } },
};

function ctxCapturing(onChange: (next: Condition) => void): EditorContext {
  return {
    personaOptions: [], segmentNameOptions: [], facetMap,
    onAddCondition: () => {}, onAddGroup: () => {}, onRemove: () => {},
    onChangeCondition: (_p, n) => onChange(n), onToggleJoin: () => {},
  };
}

describe("picker value ≡ hand-typed value after compile", () => {
  it("produces identical SQL + params for country = US", () => {
    let picked: Condition | null = null;
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={ctxCapturing((n) => { picked = n; })} />);
    fireEvent.focus(screen.getByRole("combobox", { name: /value/i }));
    fireEvent.click(screen.getByText(/United States/));

    expect(picked).not.toBeNull();
    const pickedRule: SegmentRule = { kind: "group", join: "AND", children: [picked!] };
    const handRule: SegmentRule = {
      kind: "group", join: "AND",
      children: [{ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" }],
    };
    expect(compileSegmentRule(pickedRule)).toEqual(compileSegmentRule(handRule));
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test tests/regression/segment-picker-compiles-identically.test.ts`
Expected: PASS (1 test) — the picker emits `value: "US"`, identical to the hand-built condition.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/segment-picker-compiles-identically.test.ts
git commit -m "test(segments): regression — picker value compiles identically"
```

---

## Task 11: Full verification + populate prod cache + ship

**Files:** none (verification + deploy)

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: exit 0 (typecheck + lint + full unit/integration/regression suite green).

- [ ] **Step 2: Manually verify the UI in the browser**

Run: `bun run dev`, open the Segments page, add a `Country` condition. Confirm:
- the value field is a searchable combobox showing `US · United States — N` rows (after the cache is populated — see Step 4; before that it falls back to free-text, which is also acceptable),
- typing `united` filters to US/GB,
- typing an unlisted code shows `Use "…"` and commits it,
- a numeric field (e.g. Total decisions) shows the `In data: …` hint,
- Email is still a plain text box,
- the estimated size still updates.

If the cache is empty locally, you can populate the test DB first:
```
env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT PGUSER="$(whoami)" PGPASSWORD="" PGHOST=localhost PGDATABASE=nexus_test PGPORT=5432 DATABASE_URL="postgresql://localhost:5432/nexus_test" CRON_SECRET="test_cron_secret" bun run -e 'fetch…'  # or run the integration test which seeds + computes
```

- [ ] **Step 3: Ship via the MR flow**

```bash
git push -u origin <feature-branch>
glab mr create --title "feat(segments): data-driven value pickers" --description "$(cat <<'EOF'
## Summary
- Cron-refreshed SegmentFieldFacet cache of top values + counts (and numeric ranges)
- Searchable value combobox with friendly labels (US · United States — N) + free-text fallback
- Range hints for numeric/date fields
- Pure input-assistance: picker value compiles identically to hand-typed (regression guarded)

Spec: docs/superpowers/specs/2026-06-09-segment-value-pickers-design.md
EOF
)" --yes
```
Then poll until mergeable and merge:
```bash
until [ "$(glab mr view <N> --output json | jq -r '.detailed_merge_status')" = "mergeable" ]; do sleep 3; done
glab mr merge <N> --yes
```

- [ ] **Step 4: Populate the production facet cache after deploy**

Once merged + deployed, trigger the cron once so the picker has data on the live site (the table is empty until the first run; the daily cron will keep it fresh thereafter):
```bash
set -a; source .env.local; set +a
curl -fsS -X POST "https://<prod-host>/api/cron/refresh-segment-facets" -H "authorization: Bearer $CRON_SECRET"
```
Expected: `{"data":{"refreshed":[...],"failed":[]}}`.

- [ ] **Step 5: Sync main + clean up**

```bash
git checkout main && git pull --ff-only && git branch -d <feature-branch>
```

---

## Self-Review notes

- **Spec coverage:** value source (live, Tasks 6–7), facet cache table (Task 1), cron refresh (Task 7), server-load-as-props (Task 8), searchable combobox + free-text fallback (Task 9), range hints (Task 9), friendly labels (Task 3), classification metadata (Task 5), tolerant parsing (Task 2), compile-invariant regression (Task 10), cold-cache graceful fallback (Task 9 dispatch returns free-text when no facet). All covered.
- **Type consistency:** `FieldFacet`/`ValueCount`/`ValuesFacetPayload`/`RangeFacetPayload`/`FacetMap` defined in Task 2 and used unchanged in Tasks 3, 4, 6, 7, 8, 9, 10. `facet?: FieldFacet` added to `FieldDef` (Task 5) — note `field-catalog.ts` defines its own `FieldFacet = { kind: "values" | "range" }` (UI/metadata shape, no payload) while `facet-types.ts` `FieldFacet` is the payload-carrying union; these are intentionally distinct (catalog declares *which* facet, cache carries the *data*). `fieldSqlExpr` (Task 6) reused in Task 7. `formatRangeHint(type, payload)` / `formatFacetValueLabel(fieldId, value, count)` signatures consistent across Tasks 3 and 9.
- **No placeholders:** the only "fill in" is the country/language label maps in Task 3, which are illustrative-but-functional (partial coverage degrades gracefully); every other step has complete code.
