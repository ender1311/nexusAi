# Segments Builder (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated admin build a nested AND/OR segment over a curated field catalog, see its estimated size live and exact size on demand, and save it as a named reusable segment — over the ~10M-row `"User"` table without SQL-injection risk.

**Architecture:** Pure lib units (`src/lib/segments/`) define the rule-tree types, a curated field catalog, a tolerant parser, a recursive parameterized SQL `WHERE` compiler, and a sizing service (planner `EXPLAIN` estimate + on-demand `COUNT` with `statement_timeout`). A new `Segment` Prisma model persists the rule tree. Thin App-Router routes (`src/app/api/segments/`) provide CRUD + stateless sizing, using the existing `ok`/`fail`/`handleRouteError` envelope and `requireAdmin()` for mutations. A `"use client"` builder UI on `/audience/segments` orchestrates a recursive node editor; all tree-mutation logic lives in a pure `rule-tree-ops` module.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon), Bun test runner, happy-dom, Tailwind v4, lucide-react.

> **⚠️ NAMESPACE CORRECTION (post-implementation).** This plan was written assuming the new routes would live under `src/app/api/segments/*`. During Task 8 that path was found to be **already taken** by a load-bearing endpoint (`GET /api/segments` serves Hightouch `UserSegment` names to the agent wizard + edit sheet and has its own test). To avoid clobbering it, all C1 rule-segment routes were implemented under a **separate namespace, `/api/segment-definitions/*`** (`route.ts`, `[id]/route.ts`, `size/route.ts`), and every client `fetch` in the builder targets `/api/segment-definitions`. **The existing `/api/segments` endpoint was left untouched.** When building C2/C3, reference `/api/segment-definitions/*` for rule-segment CRUD + sizing, NOT the `/api/segments/*` paths shown in the task bodies below.

---

## Constraints (read before starting)

- **Branch:** all work on `feat/audience-segments-c1` (already checked out; the C1 spec is committed there).
- **Tests:** never run in background. Use `bun run check:quick` while iterating. Before the MR, run the full suite against the local test DB:
  `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun run check`
- **Migrations:** NEVER run `prisma migrate dev` / `db push` (prisma.config.ts loads `.env.local` = PROD). Use idempotent DDL + a manual migration folder + direct `_prisma_migrations` inserts (Task 6).
- **No `any`.** Routes return `{ data: T }` / `{ error }` with correct status. Lib functions are pure (except `sizing.ts`, which queries the DB). JSON DB fields parsed/validated on read.
- **TDD:** write the failing test first, see it fail, implement minimally, see it pass, commit.
- Auth is globally stubbed as an admin in `tests/setup/bun.ts`, so `requireAdmin()` passes in tests by default.
- Route-handler tests call the exported handler directly with a `buildRequest(...)` from `tests/helpers/request.ts` and (for `[id]`) `{ params: Promise.resolve({ id }) }`. DB tests use `truncateAll()` + builders from `tests/helpers/builders.ts`.

## File structure

- Create `src/types/segment.ts` — rule-tree types (`Operator`, `FieldType`, `Condition`, `Group`, `RuleNode`, `SegmentRule`).
- Create `src/lib/segments/field-catalog.ts` — `FieldDef`, `FieldCompile`, `FIELD_CATALOG`, `getField`, `isOperatorLegal`.
- Create `src/lib/segments/parse-rule.ts` — `parseSegmentRule` (tolerant, depth-guarded).
- Create `src/lib/segments/compile-sql.ts` — `compileSegmentRule` → `{ sql, params }`.
- Create `src/lib/segments/rule-tree-ops.ts` — pure add/remove/update-at-path helpers.
- Create `src/lib/segments/sizing.ts` — `estimateSegmentSize`, `exactSegmentSize`.
- Modify `prisma/schema.prisma` — add `Segment` model.
- Create `prisma/migrations/20260607130000_add_segment_model/migration.sql`.
- Create `src/app/api/segments/route.ts` — `GET` list, `POST` create.
- Create `src/app/api/segments/[id]/route.ts` — `GET`, `PUT`, `DELETE`.
- Create `src/app/api/segments/size/route.ts` — `POST` size (estimate|exact).
- Modify `src/app/audience/segments/page.tsx` — replace `ComingSoon`.
- Create `src/components/segments/segment-builder.tsx` — client builder.
- Create `src/components/segments/rule-node-editor.tsx` — recursive editor.
- Tests under `tests/unit/`, `tests/integration/`, `tests/regression/`.

---

## Task 1: Rule-tree types + field catalog

**Files:**
- Create: `src/types/segment.ts`
- Create: `src/lib/segments/field-catalog.ts`
- Test: `tests/unit/segment-field-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/segment-field-catalog.test.ts
import { describe, expect, it } from "bun:test";
import { FIELD_CATALOG, getField, isOperatorLegal } from "@/lib/segments/field-catalog";

describe("field catalog", () => {
  it("every entry has a non-empty operators list", () => {
    for (const f of FIELD_CATALOG) expect(f.operators.length).toBeGreaterThan(0);
  });

  it("compile strategy is consistent with field type/category", () => {
    for (const f of FIELD_CATALOG) {
      if (f.compile.strategy === "segment") expect(f.type).toBe("segment");
      if (f.compile.strategy === "channelStat") expect(f.category).toBe("engagement");
      if (f.type === "segment") expect(f.compile.strategy).toBe("segment");
    }
  });

  it("ids are unique", () => {
    const ids = FIELD_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getField returns a def or undefined", () => {
    expect(getField("funnelStage")?.id).toBe("funnelStage");
    expect(getField("nope")).toBeUndefined();
  });

  it("isOperatorLegal reflects the entry's operators", () => {
    const f = getField("funnelStage")!;
    expect(isOperatorLegal(f, "in")).toBe(true);
    expect(isOperatorLegal(f, "contains")).toBe(false);
  });

  it("funnelStage enum values come from the funnel-stage metadata", () => {
    const f = getField("funnelStage")!;
    expect(f.enumValues?.map((e) => e.value)).toContain("wau");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-field-catalog.test.ts`
Expected: FAIL — cannot find module `@/lib/segments/field-catalog`.

- [ ] **Step 3: Write the types**

```ts
// src/types/segment.ts
export type Operator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "nin"
  | "contains"
  | "exists" | "nexists"
  | "is_true" | "is_false"
  | "in_segment" | "not_in_segment";

export type FieldType = "string" | "number" | "boolean" | "date" | "enum" | "segment";

export type ConditionValue = string | number | boolean | string[] | null;

export type Condition = {
  kind: "condition";
  fieldId: string;
  operator: Operator;
  value: ConditionValue;
};

export type Group = {
  kind: "group";
  join: "AND" | "OR";
  children: RuleNode[];
};

export type RuleNode = Condition | Group;
export type SegmentRule = Group;
```

- [ ] **Step 4: Write the catalog**

```ts
// src/lib/segments/field-catalog.ts
import type { Operator, FieldType } from "@/types/segment";
import { FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";

export type FieldCompile =
  | { strategy: "scalar"; column: string }
  | { strategy: "attr"; key: string; cast: "text" | "numeric" | "boolean" }
  | { strategy: "channelStat"; channel: string; metric: string }
  | { strategy: "segment" };

export type FieldCategory = "scalar" | "attribute" | "segment" | "engagement";

export type FieldDef = {
  id: string;
  label: string;
  category: FieldCategory;
  type: FieldType;
  operators: Operator[];
  enumValues?: { value: string; label: string }[];
  compile: FieldCompile;
};

const NUM_OPS: Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "exists", "nexists"];
const STR_OPS: Operator[] = ["eq", "neq", "in", "nin", "contains", "exists", "nexists"];
const BOOL_OPS: Operator[] = ["is_true", "is_false", "exists", "nexists"];
const ENUM_OPS: Operator[] = ["in", "nin", "exists", "nexists"];
const SEG_OPS: Operator[] = ["in_segment", "not_in_segment"];

const FUNNEL_ENUM = FUNNEL_STAGES.map((s) => ({ value: s, label: FUNNEL_STAGE_META[s].label }));

export const FIELD_CATALOG: FieldDef[] = [
  // scalar
  { id: "funnelStage", label: "Funnel stage", category: "scalar", type: "enum", operators: ENUM_OPS, enumValues: FUNNEL_ENUM, compile: { strategy: "scalar", column: "funnelStage" } },
  { id: "persona", label: "Persona", category: "scalar", type: "enum", operators: ENUM_OPS, compile: { strategy: "scalar", column: "personaId" } },
  { id: "timezone", label: "Timezone", category: "scalar", type: "string", operators: STR_OPS, compile: { strategy: "scalar", column: "timezone" } },
  { id: "createdAt", label: "Created at", category: "scalar", type: "date", operators: NUM_OPS, compile: { strategy: "scalar", column: "createdAt" } },
  { id: "totalDecisions", label: "Total decisions", category: "scalar", type: "number", operators: NUM_OPS, compile: { strategy: "scalar", column: "totalDecisions" } },
  { id: "totalConversions", label: "Total conversions", category: "scalar", type: "number", operators: NUM_OPS, compile: { strategy: "scalar", column: "totalConversions" } },
  // attribute
  { id: "email", label: "Email", category: "attribute", type: "string", operators: STR_OPS, compile: { strategy: "attr", key: "email", cast: "text" } },
  { id: "country_latest", label: "Country", category: "attribute", type: "string", operators: STR_OPS, compile: { strategy: "attr", key: "country_latest", cast: "text" } },
  { id: "language_tag", label: "Language", category: "attribute", type: "string", operators: STR_OPS, compile: { strategy: "attr", key: "language_tag", cast: "text" } },
  { id: "days_since_last_open", label: "Days since last open", category: "attribute", type: "number", operators: NUM_OPS, compile: { strategy: "attr", key: "days_since_last_open", cast: "numeric" } },
  { id: "has_recurring_gift", label: "Has recurring gift", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "has_recurring_gift", cast: "boolean" } },
  { id: "gift_count_lifetime", label: "Lifetime gift count", category: "attribute", type: "number", operators: NUM_OPS, compile: { strategy: "attr", key: "gift_count_lifetime", cast: "numeric" } },
  { id: "newsletter_push_enabled", label: "Push opt-in", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "newsletter_push_enabled", cast: "boolean" } },
  { id: "newsletter_email_enabled", label: "Email opt-in", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "newsletter_email_enabled", cast: "boolean" } },
  { id: "preferred_channel_overall_30_days", label: "Preferred channel (30d)", category: "attribute", type: "string", operators: STR_OPS, compile: { strategy: "attr", key: "preferred_channel_overall_30_days", cast: "text" } },
  // engagement
  { id: "push_sent", label: "Push sent (count)", category: "engagement", type: "number", operators: NUM_OPS, compile: { strategy: "channelStat", channel: "push", metric: "sent" } },
  { id: "push_converted", label: "Push converted (count)", category: "engagement", type: "number", operators: NUM_OPS, compile: { strategy: "channelStat", channel: "push", metric: "converted" } },
  // segment
  { id: "segment_membership", label: "Segment membership", category: "segment", type: "segment", operators: SEG_OPS, compile: { strategy: "segment" } },
];

const BY_ID = new Map(FIELD_CATALOG.map((f) => [f.id, f]));

export function getField(id: string): FieldDef | undefined {
  return BY_ID.get(id);
}

export function isOperatorLegal(field: FieldDef, op: Operator): boolean {
  return field.operators.includes(op);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/segment-field-catalog.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/segment.ts src/lib/segments/field-catalog.ts tests/unit/segment-field-catalog.test.ts
git commit -m "feat(segments): rule-tree types + curated field catalog"
```

---

## Task 2: Tolerant rule parser

**Files:**
- Create: `src/lib/segments/parse-rule.ts`
- Test: `tests/unit/segment-parse-rule.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/segment-parse-rule.test.ts
import { describe, expect, it } from "bun:test";
import { parseSegmentRule, MAX_RULE_DEPTH } from "@/lib/segments/parse-rule";

const cond = (fieldId: string, operator: string, value: unknown) => ({ kind: "condition", fieldId, operator, value });
const group = (join: string, children: unknown[]) => ({ kind: "group", join, children });

describe("parseSegmentRule", () => {
  it("accepts a valid nested tree", () => {
    const tree = group("AND", [cond("funnelStage", "in", ["wau"]), group("OR", [cond("totalDecisions", "gte", 5)])]);
    const parsed = parseSegmentRule(tree);
    expect(parsed?.kind).toBe("group");
    expect(parsed?.children.length).toBe(2);
  });

  it("accepts an empty root group (matches all)", () => {
    expect(parseSegmentRule(group("AND", []))?.children.length).toBe(0);
  });

  it("rejects an unknown field → null", () => {
    expect(parseSegmentRule(group("AND", [cond("nope", "eq", 1)]))).toBeNull();
  });

  it("rejects an operator illegal for the field → null", () => {
    expect(parseSegmentRule(group("AND", [cond("funnelStage", "contains", "x")]))).toBeNull();
  });

  it("rejects a non-group root → null", () => {
    expect(parseSegmentRule(cond("funnelStage", "in", ["wau"]))).toBeNull();
  });

  it("rejects a bad join → null", () => {
    expect(parseSegmentRule(group("XOR", []))).toBeNull();
  });

  it("rejects malformed input → null", () => {
    expect(parseSegmentRule(null)).toBeNull();
    expect(parseSegmentRule("nope")).toBeNull();
    expect(parseSegmentRule({ kind: "group", join: "AND" })).toBeNull(); // no children array
  });

  it("rejects trees deeper than MAX_RULE_DEPTH → null", () => {
    let node: unknown = cond("totalDecisions", "gte", 1);
    for (let i = 0; i <= MAX_RULE_DEPTH + 1; i++) node = group("AND", [node]);
    expect(parseSegmentRule(node)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-parse-rule.test.ts`
Expected: FAIL — cannot find module `@/lib/segments/parse-rule`.

- [ ] **Step 3: Write the parser**

```ts
// src/lib/segments/parse-rule.ts
import type { RuleNode, SegmentRule, Operator, ConditionValue } from "@/types/segment";
import { getField, isOperatorLegal } from "./field-catalog";

export const MAX_RULE_DEPTH = 10;

function parseNode(value: unknown, depth: number): RuleNode | null {
  if (depth > MAX_RULE_DEPTH) return null;
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;

  if (v.kind === "group") {
    if (v.join !== "AND" && v.join !== "OR") return null;
    if (!Array.isArray(v.children)) return null;
    const children: RuleNode[] = [];
    for (const child of v.children) {
      const parsed = parseNode(child, depth + 1);
      if (parsed === null) return null;
      children.push(parsed);
    }
    return { kind: "group", join: v.join, children };
  }

  if (v.kind === "condition") {
    if (typeof v.fieldId !== "string") return null;
    const field = getField(v.fieldId);
    if (!field) return null;
    if (typeof v.operator !== "string" || !isOperatorLegal(field, v.operator as Operator)) return null;
    return {
      kind: "condition",
      fieldId: v.fieldId,
      operator: v.operator as Operator,
      value: (v.value ?? null) as ConditionValue,
    };
  }

  return null;
}

export function parseSegmentRule(value: unknown): SegmentRule | null {
  const node = parseNode(value, 0);
  if (node === null || node.kind !== "group") return null;
  return node;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-parse-rule.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/parse-rule.ts tests/unit/segment-parse-rule.test.ts
git commit -m "feat(segments): tolerant depth-guarded rule parser"
```

---

## Task 3: Recursive SQL WHERE compiler

**Files:**
- Create: `src/lib/segments/compile-sql.ts`
- Test: `tests/unit/segment-compile-sql.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/segment-compile-sql.test.ts
import { describe, expect, it } from "bun:test";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { SegmentRule } from "@/types/segment";

const g = (join: "AND" | "OR", children: unknown[]): SegmentRule => ({ kind: "group", join, children } as SegmentRule);
const c = (fieldId: string, operator: string, value: unknown) => ({ kind: "condition", fieldId, operator, value });

describe("compileSegmentRule", () => {
  it("empty root → TRUE, no params", () => {
    expect(compileSegmentRule(g("AND", []))).toEqual({ sql: "TRUE", params: [] });
  });

  it("scalar comparison uses a bound param", () => {
    const r = compileSegmentRule(g("AND", [c("totalDecisions", "gte", 5)]));
    expect(r.sql).toBe(`(u."totalDecisions" >= $1)`);
    expect(r.params).toEqual([5]);
  });

  it("attr numeric cast", () => {
    const r = compileSegmentRule(g("AND", [c("days_since_last_open", "lt", 7)]));
    expect(r.sql).toBe(`((u."attributes"->>'days_since_last_open')::numeric < $1)`);
    expect(r.params).toEqual([7]);
  });

  it("attr boolean is_true uses no value param", () => {
    const r = compileSegmentRule(g("AND", [c("has_recurring_gift", "is_true", null)]));
    expect(r.sql).toBe(`((u."attributes"->>'has_recurring_gift')::boolean = true)`);
    expect(r.params).toEqual([]);
  });

  it("attr exists uses the ? operator", () => {
    const r = compileSegmentRule(g("AND", [c("email", "exists", null)]));
    expect(r.sql).toBe(`(u."attributes" ? 'email')`);
    expect(r.params).toEqual([]);
  });

  it("in expands to = ANY with a single array param", () => {
    const r = compileSegmentRule(g("AND", [c("funnelStage", "in", ["wau", "mau"])]));
    expect(r.sql).toBe(`(u."funnelStage" = ANY($1))`);
    expect(r.params).toEqual([["wau", "mau"]]);
  });

  it("contains wraps the value in wildcards (value, not SQL)", () => {
    const r = compileSegmentRule(g("AND", [c("email", "contains", "gmail")]));
    expect(r.sql).toBe(`(u."attributes"->>'email' ILIKE $1)`);
    expect(r.params).toEqual(["%gmail%"]);
  });

  it("channelStat numeric path", () => {
    const r = compileSegmentRule(g("AND", [c("push_sent", "gt", 0)]));
    expect(r.sql).toBe(`((u."channelStats"->'push'->>'sent')::numeric > $1)`);
    expect(r.params).toEqual([0]);
  });

  it("segment membership compiles to EXISTS", () => {
    const r = compileSegmentRule(g("AND", [c("segment_membership", "in_segment", "all-givers")]));
    expect(r.sql).toBe(`(EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = $1))`);
    expect(r.params).toEqual(["all-givers"]);
  });

  it("not_in_segment compiles to NOT EXISTS", () => {
    const r = compileSegmentRule(g("AND", [c("segment_membership", "not_in_segment", "all-givers")]));
    expect(r.sql).toContain("NOT EXISTS");
  });

  it("nested groups parenthesize and number params left-to-right", () => {
    const r = compileSegmentRule(g("AND", [c("funnelStage", "in", ["wau"]), g("OR", [c("totalDecisions", "gte", 5), c("totalConversions", "gte", 1)])]));
    expect(r.sql).toBe(`(u."funnelStage" = ANY($1) AND (u."totalDecisions" >= $2 OR u."totalConversions" >= $3))`);
    expect(r.params).toEqual([["wau"], 5, 1]);
  });

  it("empty nested group is dropped from its parent", () => {
    const r = compileSegmentRule(g("AND", [c("totalDecisions", "gte", 5), g("OR", [])]));
    expect(r.sql).toBe(`(u."totalDecisions" >= $1)`);
    expect(r.params).toEqual([5]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-compile-sql.test.ts`
Expected: FAIL — cannot find module `@/lib/segments/compile-sql`.

- [ ] **Step 3: Write the compiler**

```ts
// src/lib/segments/compile-sql.ts
import type { SegmentRule, RuleNode, Condition } from "@/types/segment";
import { getField } from "./field-catalog";

export type CompiledWhere = { sql: string; params: unknown[] };

const SCALAR_OPS: Record<string, string> = {
  eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=",
};

class ParamBag {
  params: unknown[] = [];
  add(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function leftExpr(c: Condition): { expr: string; isAttr: boolean; attrKey?: string } {
  const field = getField(c.fieldId)!; // parser guarantees the field exists
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

function compileCondition(c: Condition, bag: ParamBag): string {
  const { expr, isAttr, attrKey } = leftExpr(c);
  switch (c.operator) {
    case "eq": case "neq": case "gt": case "gte": case "lt": case "lte":
      return `${expr} ${SCALAR_OPS[c.operator]} ${bag.add(c.value)}`;
    case "in":
      return `${expr} = ANY(${bag.add(c.value)})`;
    case "nin":
      return `${expr} <> ALL(${bag.add(c.value)})`;
    case "contains":
      return `${expr} ILIKE ${bag.add(`%${String(c.value)}%`)}`;
    case "exists":
      return isAttr ? `u."attributes" ? '${attrKey}'` : `${expr} IS NOT NULL`;
    case "nexists":
      return isAttr ? `NOT (u."attributes" ? '${attrKey}')` : `${expr} IS NULL`;
    case "is_true":
      return `${expr} = true`;
    case "is_false":
      return `${expr} = false`;
    case "in_segment":
      return `EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = ${bag.add(c.value)})`;
    case "not_in_segment":
      return `NOT EXISTS (SELECT 1 FROM "UserSegment" us WHERE us."externalId" = u."externalId" AND us."segmentName" = ${bag.add(c.value)})`;
  }
}

function compileNode(node: RuleNode, bag: ParamBag): string {
  if (node.kind === "condition") return compileCondition(node, bag);
  const parts = node.children.map((child) => compileNode(child, bag)).filter((s) => s !== "");
  if (parts.length === 0) return "";
  return `(${parts.join(` ${node.join} `)})`;
}

export function compileSegmentRule(rule: SegmentRule): CompiledWhere {
  const bag = new ParamBag();
  const sql = compileNode(rule, bag);
  return { sql: sql === "" ? "TRUE" : sql, params: bag.params };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-compile-sql.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/compile-sql.ts tests/unit/segment-compile-sql.test.ts
git commit -m "feat(segments): recursive parameterized SQL WHERE compiler"
```

---

## Task 4: Pure rule-tree mutation helpers

**Files:**
- Create: `src/lib/segments/rule-tree-ops.ts`
- Test: `tests/unit/segment-rule-tree-ops.test.ts`

Path = an array of child indices from the root, e.g. `[1, 0]` = "the first child of the root's second child."

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/segment-rule-tree-ops.test.ts
import { describe, expect, it } from "bun:test";
import { addChild, removeAt, updateConditionAt, setJoinAt, emptyRule } from "@/lib/segments/rule-tree-ops";
import type { SegmentRule, Condition } from "@/types/segment";

const cond = (fieldId: string): Condition => ({ kind: "condition", fieldId, operator: "exists", value: null });

describe("rule-tree-ops (pure)", () => {
  it("emptyRule is an empty AND group", () => {
    expect(emptyRule()).toEqual({ kind: "group", join: "AND", children: [] });
  });

  it("addChild appends to the root and does not mutate the input", () => {
    const root = emptyRule();
    const next = addChild(root, [], cond("email"));
    expect(next.children.length).toBe(1);
    expect(root.children.length).toBe(0); // immutability
  });

  it("addChild appends to a nested group by path", () => {
    let root: SegmentRule = addChild(emptyRule(), [], { kind: "group", join: "OR", children: [] });
    root = addChild(root, [0], cond("email"));
    const nested = root.children[0];
    expect(nested.kind).toBe("group");
    if (nested.kind === "group") expect(nested.children.length).toBe(1);
  });

  it("removeAt removes a child by path", () => {
    let root = addChild(emptyRule(), [], cond("email"));
    root = addChild(root, [], cond("timezone"));
    const next = removeAt(root, [0]);
    expect(next.children.length).toBe(1);
    expect((next.children[0] as Condition).fieldId).toBe("timezone");
  });

  it("updateConditionAt replaces a condition by path", () => {
    const root = addChild(emptyRule(), [], cond("email"));
    const next = updateConditionAt(root, [0], { kind: "condition", fieldId: "timezone", operator: "eq", value: "UTC" });
    expect((next.children[0] as Condition).fieldId).toBe("timezone");
  });

  it("setJoinAt flips a group's join", () => {
    const next = setJoinAt(emptyRule(), [], "OR");
    expect(next.join).toBe("OR");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/segment-rule-tree-ops.test.ts`
Expected: FAIL — cannot find module `@/lib/segments/rule-tree-ops`.

- [ ] **Step 3: Write the helpers**

```ts
// src/lib/segments/rule-tree-ops.ts
import type { SegmentRule, RuleNode, Group, Condition } from "@/types/segment";

export function emptyRule(): SegmentRule {
  return { kind: "group", join: "AND", children: [] };
}

// Returns a deep-ish clone with the group at `path` transformed by `fn`.
function mapGroupAt(root: SegmentRule, path: number[], fn: (g: Group) => Group): SegmentRule {
  function recurse(node: RuleNode, depth: number): RuleNode {
    if (depth === path.length) {
      if (node.kind !== "group") return node;
      return fn(node);
    }
    if (node.kind !== "group") return node;
    const idx = path[depth];
    const children = node.children.map((child, i) => (i === idx ? recurse(child, depth + 1) : child));
    return { ...node, children };
  }
  return recurse(root, 0) as SegmentRule;
}

export function addChild(root: SegmentRule, path: number[], child: RuleNode): SegmentRule {
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, child] }));
}

export function removeAt(root: SegmentRule, path: number[]): SegmentRule {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parentPath, (g) => ({ ...g, children: g.children.filter((_, i) => i !== idx) }));
}

export function updateConditionAt(root: SegmentRule, path: number[], next: Condition): SegmentRule {
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parentPath, (g) => ({
    ...g,
    children: g.children.map((child, i) => (i === idx ? next : child)),
  }));
}

export function setJoinAt(root: SegmentRule, path: number[], join: "AND" | "OR"): SegmentRule {
  return mapGroupAt(root, path, (g) => ({ ...g, join }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/segment-rule-tree-ops.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/rule-tree-ops.ts tests/unit/segment-rule-tree-ops.test.ts
git commit -m "feat(segments): pure rule-tree mutation helpers"
```

---

## Task 5: Sizing service (estimate + exact)

**Files:**
- Create: `src/lib/segments/sizing.ts`
- Test: `tests/integration/segment-sizing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/segment-sizing.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/builders";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { estimateSegmentSize, exactSegmentSize } from "@/lib/segments/sizing";
import type { SegmentRule } from "@/types/segment";

const rule = (children: unknown[]): SegmentRule => ({ kind: "group", join: "AND", children } as SegmentRule);

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("segment sizing", () => {
  it("exact COUNT matches the number of users that satisfy the rule", async () => {
    await createUser("u1", { funnelStage: "wau", totalDecisions: 10 });
    await createUser("u2", { funnelStage: "wau", totalDecisions: 1 });
    await createUser("u3", { funnelStage: "mau", totalDecisions: 10 });
    const where = compileSegmentRule(rule([
      { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] },
      { kind: "condition", fieldId: "totalDecisions", operator: "gte", value: 5 },
    ]));
    const res = await exactSegmentSize(where);
    expect(res.timedOut).toBe(false);
    expect(res.count).toBe(1); // only u1
  });

  it("empty rule (TRUE) counts everyone", async () => {
    await createUser("u1");
    await createUser("u2");
    const res = await exactSegmentSize(compileSegmentRule(rule([])));
    expect(res.count).toBe(2);
  });

  it("estimate returns a non-negative integer", async () => {
    await createUser("u1", { funnelStage: "wau" });
    const where = compileSegmentRule(rule([{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }]));
    const est = await estimateSegmentSize(where);
    expect(Number.isInteger(est)).toBe(true);
    expect(est).toBeGreaterThanOrEqual(0);
  });

  it("attr-based exact count works", async () => {
    await createUser("u1", { attributes: { country_latest: "US" } });
    await createUser("u2", { attributes: { country_latest: "GB" } });
    const where = compileSegmentRule(rule([{ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" }]));
    const res = await exactSegmentSize(where);
    expect(res.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segment-sizing.test.ts`
Expected: FAIL — cannot find module `@/lib/segments/sizing`.

- [ ] **Step 3: Write the sizing service**

```ts
// src/lib/segments/sizing.ts
import { prisma } from "@/lib/db";
import type { CompiledWhere } from "./compile-sql";

const EXACT_TIMEOUT_MS = 15_000;

export type ExactResult = { count: number; timedOut: false } | { count: null; timedOut: true };

/** Fast, approximate: the Postgres planner's row estimate (no rows scanned). */
export async function estimateSegmentSize(where: CompiledWhere): Promise<number> {
  const sql = `EXPLAIN (FORMAT JSON) SELECT 1 FROM "User" u WHERE ${where.sql}`;
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql, ...where.params);
  // Postgres returns one row, column "QUERY PLAN" = [ { Plan: { "Plan Rows": N, ... } } ]
  const plan = rows[0]?.["QUERY PLAN"] as Array<{ Plan?: { "Plan Rows"?: number } }> | undefined;
  const estimate = plan?.[0]?.Plan?.["Plan Rows"];
  return typeof estimate === "number" ? Math.round(estimate) : 0;
}

/** Slow, exact: real COUNT(*) wrapped in a per-statement timeout. */
export async function exactSegmentSize(where: CompiledWhere): Promise<ExactResult> {
  const sql = `SELECT COUNT(*)::bigint AS n FROM "User" u WHERE ${where.sql}`;
  try {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${EXACT_TIMEOUT_MS}`);
      return tx.$queryRawUnsafe<Array<{ n: bigint }>>(sql, ...where.params);
    });
    return { count: Number(rows[0]?.n ?? 0n), timedOut: false };
  } catch (err) {
    // Postgres raises a statement-timeout error (SQLSTATE 57014); treat as a soft timeout.
    if (err instanceof Error && /statement timeout|57014|canceling statement/i.test(err.message)) {
      return { count: null, timedOut: true };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segment-sizing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/segments/sizing.ts tests/integration/segment-sizing.test.ts
git commit -m "feat(segments): planner-estimate + on-demand exact sizing service"
```

---

## Task 6: Segment Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260607130000_add_segment_model/migration.sql`

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`:

```prisma
model Segment {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  rule        Json
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?

  @@map("Segment")
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client". (`generate` is safe — it does not touch any database.)

- [ ] **Step 3: Write the migration SQL (history of record + idempotent)**

```sql
-- prisma/migrations/20260607130000_add_segment_model/migration.sql
-- New table for saved, rule-based audience segments. Idempotent so it can be
-- applied by hand to both prod and the local test DB (we never run
-- `prisma migrate dev` — prisma.config.ts loads .env.local = PROD).
CREATE TABLE IF NOT EXISTS "Segment" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "rule"        JSONB NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "createdBy"   TEXT,
  CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Segment_name_key" ON "Segment"("name");
```

- [ ] **Step 4: Apply idempotent DDL to the local test DB**

Run:
```bash
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" \
  -f prisma/migrations/20260607130000_add_segment_model/migration.sql
```
Expected: `CREATE TABLE` / `CREATE INDEX` (or no error if already present).

- [ ] **Step 5: Apply to PROD and record migration history**

> Apply the same idempotent DDL to prod (the `DATABASE_URL` in `.env.local`), then mark the migration applied so Prisma's history matches. Confirm with the user before touching prod if unsure.

```bash
# Apply DDL to prod:
psql -v ON_ERROR_STOP=1 "$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" \
  -f prisma/migrations/20260607130000_add_segment_model/migration.sql
# Record in prod migration history (prisma migrate resolve loads .env.local = PROD):
npx prisma migrate resolve --applied 20260607130000_add_segment_model
```

Then insert the same row into the **test DB** history so `prisma migrate status` is clean there too:
```bash
CHK=$(sha256sum prisma/migrations/20260607130000_add_segment_model/migration.sql | cut -d' ' -f1)
psql "postgresql://localhost:5432/nexus_test" -c \
"INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
 VALUES (gen_random_uuid()::text, '$CHK', now(), '20260607130000_add_segment_model', now(), 1)
 ON CONFLICT DO NOTHING;"
```

- [ ] **Step 6: Verify the client + table**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun run -e "import {prisma} from './src/lib/db'; console.log(await prisma.segment.count());"`
Expected: prints `0` (table exists, empty).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260607130000_add_segment_model/migration.sql
git commit -m "feat(db): Segment model for saved rule-based segments"
```

---

## Task 7: Stateless sizing route (`POST /api/segments/size`)

**Files:**
- Create: `src/app/api/segments/size/route.ts`
- Test: `tests/integration/segments-size-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/segments-size-route.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUser } from "../helpers/builders";
import { POST } from "@/app/api/segments/size/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /api/segments/size", () => {
  it("returns an exact count for a valid rule", async () => {
    await createUser("u1", { funnelStage: "wau" });
    await createUser("u2", { funnelStage: "mau" });
    const body = { mode: "exact", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] } };
    const res = await POST(buildRequest("POST", body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.count).toBe(1);
    expect(json.data.mode).toBe("exact");
  });

  it("returns an estimate for mode=estimate", async () => {
    await createUser("u1");
    const body = { mode: "estimate", rule: { kind: "group", join: "AND", children: [] } };
    const res = await POST(buildRequest("POST", body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(typeof json.data.count).toBe("number");
  });

  it("400 on an invalid rule (unknown field)", async () => {
    const body = { mode: "exact", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] } };
    const res = await POST(buildRequest("POST", body));
    expect(res.status).toBe(400);
  });

  it("400 on a bad mode", async () => {
    const body = { mode: "weird", rule: { kind: "group", join: "AND", children: [] } };
    const res = await POST(buildRequest("POST", body));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segments-size-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/segments/size/route`.

- [ ] **Step 3: Write the route**

```ts
// src/app/api/segments/size/route.ts
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { estimateSegmentSize, exactSegmentSize } from "@/lib/segments/sizing";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode?: unknown; rule?: unknown };
    if (body.mode !== "estimate" && body.mode !== "exact") {
      return fail("mode must be 'estimate' or 'exact'", 400);
    }
    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const where = compileSegmentRule(rule);
    if (body.mode === "estimate") {
      const count = await estimateSegmentSize(where);
      return ok({ count, mode: "estimate" as const });
    }
    const result = await exactSegmentSize(where);
    return ok({ count: result.count, mode: "exact" as const, timedOut: result.timedOut });
  } catch (err) {
    return handleRouteError("POST /api/segments/size", err);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segments-size-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/segments/size/route.ts tests/integration/segments-size-route.test.ts
git commit -m "feat(api/segments): stateless estimate/exact sizing route"
```

---

## Task 8: Segment CRUD routes

**Files:**
- Create: `src/app/api/segments/route.ts` (GET list, POST create)
- Create: `src/app/api/segments/[id]/route.ts` (GET, PUT, DELETE)
- Test: `tests/integration/segments-crud.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/integration/segments-crud.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUserSegment } from "../helpers/builders";
import { GET as listSegments, POST as createSegment } from "@/app/api/segments/route";
import { GET as getSegment, PUT as putSegment, DELETE as deleteSegment } from "@/app/api/segments/[id]/route";

const validRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("Segment CRUD", () => {
  it("POST creates a segment and GET list returns it", async () => {
    const res = await createSegment(buildRequest("POST", { name: "WAU power users", description: "d", rule: validRule }));
    const created = await res.json();
    expect(res.status).toBe(201);
    expect(created.data.name).toBe("WAU power users");

    const listRes = await listSegments();
    const list = await listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe("WAU power users");
  });

  it("POST 400 on invalid rule", async () => {
    const res = await createSegment(buildRequest("POST", { name: "Bad", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] } }));
    expect(res.status).toBe(400);
  });

  it("POST 400 on empty name", async () => {
    const res = await createSegment(buildRequest("POST", { name: "  ", rule: validRule }));
    expect(res.status).toBe(400);
  });

  it("POST 409 on duplicate Segment name", async () => {
    await createSegment(buildRequest("POST", { name: "Dup", rule: validRule }));
    const res = await createSegment(buildRequest("POST", { name: "Dup", rule: validRule }));
    expect(res.status).toBe(409);
  });

  it("POST 409 when name collides with an existing UserSegment name", async () => {
    await createUserSegment("u1", "all-givers");
    const res = await createSegment(buildRequest("POST", { name: "all-givers", rule: validRule }));
    expect(res.status).toBe(409);
  });

  it("GET [id] returns the parsed rule; 404 when missing", async () => {
    const seg = await prisma.segment.create({ data: { name: "X", rule: validRule } });
    const okRes = await getSegment(buildRequest("GET"), { params: Promise.resolve({ id: seg.id }) });
    const okBody = await okRes.json();
    expect(okRes.status).toBe(200);
    expect(okBody.data.rule.children).toHaveLength(1);

    const missRes = await getSegment(buildRequest("GET"), { params: Promise.resolve({ id: "nope" }) });
    expect(missRes.status).toBe(404);
  });

  it("PUT updates name + rule", async () => {
    const seg = await prisma.segment.create({ data: { name: "Old", rule: validRule } });
    const res = await putSegment(buildRequest("PUT", { name: "New", rule: validRule }), { params: Promise.resolve({ id: seg.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe("New");
  });

  it("DELETE removes the segment; 404 when missing", async () => {
    const seg = await prisma.segment.create({ data: { name: "Doomed", rule: validRule } });
    const okRes = await deleteSegment(buildRequest("DELETE"), { params: Promise.resolve({ id: seg.id }) });
    expect(okRes.status).toBe(200);
    expect(await prisma.segment.count()).toBe(0);

    const missRes = await deleteSegment(buildRequest("DELETE"), { params: Promise.resolve({ id: "nope" }) });
    expect(missRes.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segments-crud.test.ts`
Expected: FAIL — cannot find module `@/app/api/segments/route`.

- [ ] **Step 3: Write the list/create route**

```ts
// src/app/api/segments/route.ts
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin, getAuth } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import type { Prisma } from "@/generated/prisma/client";

export async function GET() {
  try {
    const segments = await prisma.segment.findMany({
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, description: true, updatedAt: true },
    });
    return ok(segments);
  } catch (err) {
    return handleRouteError("GET /api/segments", err);
  }
}

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = (await req.json()) as { name?: unknown; description?: unknown; rule?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("Name is required", 400);

    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    // Keep the rule-segment namespace coherent with imported Hightouch segment names.
    const clash = await prisma.userSegment.findFirst({ where: { segmentName: name }, select: { id: true } });
    if (clash) return fail("A segment with this name already exists", 409);

    const { user } = await getAuth();
    const created = await prisma.segment.create({
      data: {
        name,
        description: typeof body.description === "string" ? body.description : null,
        rule: rule as unknown as Prisma.InputJsonValue,
        createdBy: user?.email ?? null,
      },
    });
    return ok(created, 201);
  } catch (err) {
    return handleRouteError("POST /api/segments", err);
  }
}
```

- [ ] **Step 4: Write the [id] route**

```ts
// src/app/api/segments/[id]/route.ts
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { requireAdmin } from "@/lib/auth";
import { parseSegmentRule } from "@/lib/segments/parse-rule";
import type { Prisma } from "@/generated/prisma/client";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const seg = await prisma.segment.findUnique({ where: { id } });
    if (!seg) return fail("Segment not found", 404);
    // Degrade a corrupt stored rule to an empty group rather than throwing.
    const rule = parseSegmentRule(seg.rule) ?? { kind: "group", join: "AND", children: [] };
    return ok({ ...seg, rule });
  } catch (err) {
    return handleRouteError("GET /api/segments/[id]", err);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    const body = (await req.json()) as { name?: unknown; description?: unknown; rule?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail("Name is required", 400);

    const rule = parseSegmentRule(body.rule);
    if (rule === null) return fail("Invalid segment rule", 400);

    const clash = await prisma.userSegment.findFirst({ where: { segmentName: name }, select: { id: true } });
    if (clash) return fail("A segment with this name already exists", 409);

    const updated = await prisma.segment.update({
      where: { id },
      data: {
        name,
        description: typeof body.description === "string" ? body.description : null,
        rule: rule as unknown as Prisma.InputJsonValue,
      },
    });
    return ok(updated);
  } catch (err) {
    return handleRouteError("PUT /api/segments/[id]", err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const { id } = await params;
  try {
    await prisma.segment.delete({ where: { id } });
    return ok({ ok: true });
  } catch (err) {
    return handleRouteError("DELETE /api/segments/[id]", err);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun test tests/integration/segments-crud.test.ts`
Expected: PASS (8 tests). Note: `PUT` duplicate-name check uses `userSegment`; updating a `Segment` to its own existing name is not exercised here and is acceptable for C1 (the unique constraint on `Segment.name` + `handleRouteError` P2002→409 covers Segment-vs-Segment collisions).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/segments/route.ts src/app/api/segments/[id]/route.ts tests/integration/segments-crud.test.ts
git commit -m "feat(api/segments): CRUD routes with name-collision + rule validation"
```

---

## Task 9: SQL-injection boundary regression test

**Files:**
- Test: `tests/regression/segment-sql-injection-boundary.test.ts`

This guards the core safety property: **user values never appear in the SQL string; they are always bound params.**

- [ ] **Step 1: Write the test**

```ts
// tests/regression/segment-sql-injection-boundary.test.ts
// Regression: segment values must be bound parameters, never inlined into SQL.
// Bug guard — a compiler change that interpolates user values would be a SQLi hole
// on the 10M-row "User" table. See docs/superpowers/specs/2026-06-07-segments-sizes-c1-design.md §4.
import { describe, expect, it } from "bun:test";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { SegmentRule } from "@/types/segment";

const rule = (children: unknown[]): SegmentRule => ({ kind: "group", join: "AND", children } as SegmentRule);

describe("segment SQL injection boundary", () => {
  it("a malicious value lands in params, never in the SQL string", () => {
    const evil = "x'; DROP TABLE \"User\"; --";
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "email", operator: "eq", value: evil },
    ]));
    expect(sql).not.toContain(evil);
    expect(sql).toContain("$1");
    expect(params).toEqual([evil]);
  });

  it("contains wraps the value (with wildcards) into params, not SQL", () => {
    const evil = "%' OR '1'='1";
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "email", operator: "contains", value: evil },
    ]));
    expect(sql).not.toContain(evil);
    expect(params).toEqual([`%${evil}%`]);
  });

  it("segment name value is a bound param", () => {
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "segment_membership", operator: "in_segment", value: "evil'; --" },
    ]));
    expect(sql).not.toContain("evil'; --");
    expect(params).toEqual(["evil'; --"]);
  });

  it("every placeholder index has a matching param", () => {
    const { sql, params } = compileSegmentRule(rule([
      { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] },
      { kind: "condition", fieldId: "totalDecisions", operator: "gte", value: 3 },
    ]));
    const placeholders = (sql.match(/\$\d+/g) ?? []).length;
    expect(placeholders).toBe(params.length);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test tests/regression/segment-sql-injection-boundary.test.ts`
Expected: PASS (4 tests). (Compiler from Task 3 already satisfies this — the test locks the behavior in.)

- [ ] **Step 3: Commit**

```bash
git add tests/regression/segment-sql-injection-boundary.test.ts
git commit -m "test(segments): regression guard for SQL-injection boundary"
```

---

## Task 10: Builder UI + page

**Files:**
- Create: `src/components/segments/rule-node-editor.tsx`
- Create: `src/components/segments/segment-builder.tsx`
- Modify: `src/app/audience/segments/page.tsx`
- Test: `tests/regression/segments-page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/regression/segments-page.test.tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentBuilder } from "@/components/segments/segment-builder";

describe("Audience › Segments builder", () => {
  it("renders the builder shell, not the Coming soon placeholder", () => {
    const html = renderToStaticMarkup(
      <SegmentBuilder segments={[]} personaOptions={[]} segmentNameOptions={[]} />
    );
    expect(html).toContain("New segment");
    expect(html).not.toContain("Coming soon");
  });

  it("renders existing saved segments in the list", () => {
    const html = renderToStaticMarkup(
      <SegmentBuilder
        segments={[{ id: "s1", name: "WAU power users", description: null, updatedAt: new Date().toISOString() }]}
        personaOptions={[]}
        segmentNameOptions={[]}
      />
    );
    expect(html).toContain("WAU power users");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/regression/segments-page.test.tsx`
Expected: FAIL — cannot find module `@/components/segments/segment-builder`.

- [ ] **Step 3: Write the recursive node editor**

```tsx
// src/components/segments/rule-node-editor.tsx
"use client";

import { Trash2, Plus } from "lucide-react";
import type { RuleNode, Condition, Operator } from "@/types/segment";
import { FIELD_CATALOG, getField } from "@/lib/segments/field-catalog";

export type EditorContext = {
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
  onAddCondition: (path: number[]) => void;
  onAddGroup: (path: number[]) => void;
  onRemove: (path: number[]) => void;
  onChangeCondition: (path: number[], next: Condition) => void;
  onToggleJoin: (path: number[], join: "AND" | "OR") => void;
};

function OPERATOR_LABEL(op: Operator): string {
  const map: Record<Operator, string> = {
    eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤",
    in: "is any of", nin: "is none of", contains: "contains",
    exists: "exists", nexists: "is missing", is_true: "is true", is_false: "is false",
    in_segment: "is in segment", not_in_segment: "is not in segment",
  };
  return map[op];
}

function ConditionRow({ node, path, ctx }: { node: Condition; path: number[]; ctx: EditorContext }) {
  const field = getField(node.fieldId);
  const valuelessOps: Operator[] = ["exists", "nexists", "is_true", "is_false"];
  const needsValue = !valuelessOps.includes(node.operator);

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.fieldId}
        onChange={(e) => {
          const f = getField(e.target.value)!;
          ctx.onChangeCondition(path, { kind: "condition", fieldId: f.id, operator: f.operators[0], value: null });
        }}
      >
        {FIELD_CATALOG.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>

      <select
        className="rounded border bg-background px-2 py-1 text-sm"
        value={node.operator}
        onChange={(e) => ctx.onChangeCondition(path, { ...node, operator: e.target.value as Operator })}
      >
        {(field?.operators ?? []).map((op) => (
          <option key={op} value={op}>{OPERATOR_LABEL(op)}</option>
        ))}
      </select>

      {needsValue && (
        <input
          className="rounded border bg-background px-2 py-1 text-sm"
          value={node.value === null ? "" : Array.isArray(node.value) ? node.value.join(",") : String(node.value)}
          placeholder={node.operator === "in" || node.operator === "nin" ? "comma,separated" : "value"}
          onChange={(e) => {
            const raw = e.target.value;
            const value = node.operator === "in" || node.operator === "nin"
              ? raw.split(",").map((s) => s.trim()).filter(Boolean)
              : field?.type === "number" ? Number(raw)
              : raw;
            ctx.onChangeCondition(path, { ...node, value });
          }}
        />
      )}

      <button onClick={() => ctx.onRemove(path)} className="text-muted-foreground hover:text-destructive" aria-label="Remove condition">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function RuleNodeEditor({ node, path, ctx }: { node: RuleNode; path: number[]; ctx: EditorContext }) {
  if (node.kind === "condition") return <ConditionRow node={node} path={path} ctx={ctx} />;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded border overflow-hidden text-xs">
          {(["AND", "OR"] as const).map((j) => (
            <button
              key={j}
              onClick={() => ctx.onToggleJoin(path, j)}
              className={`px-2 py-0.5 ${node.join === j ? "bg-primary text-primary-foreground" : "bg-background"}`}
            >
              {j}
            </button>
          ))}
        </div>
        {path.length > 0 && (
          <button onClick={() => ctx.onRemove(path)} className="text-muted-foreground hover:text-destructive" aria-label="Remove group">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="pl-3 border-l space-y-1">
        {node.children.map((child, i) => (
          <RuleNodeEditor key={i} node={child} path={[...path, i]} ctx={ctx} />
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={() => ctx.onAddCondition(path)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> Condition
        </button>
        <button onClick={() => ctx.onAddGroup(path)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" /> Group
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the builder**

```tsx
// src/components/segments/segment-builder.tsx
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { SegmentRule, Condition } from "@/types/segment";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";
import { addChild, removeAt, updateConditionAt, setJoinAt, emptyRule } from "@/lib/segments/rule-tree-ops";
import { RuleNodeEditor, type EditorContext } from "./rule-node-editor";

export type SegmentSummary = { id: string; name: string; description: string | null; updatedAt: string };

type Props = {
  segments: SegmentSummary[];
  personaOptions: { value: string; label: string }[];
  segmentNameOptions: string[];
};

const firstCondition = (): Condition => ({ kind: "condition", fieldId: FIELD_CATALOG[0].id, operator: FIELD_CATALOG[0].operators[0], value: null });

export function SegmentBuilder({ segments, personaOptions, segmentNameOptions }: Props) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rule, setRule] = useState<SegmentRule>(emptyRule());
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [exact, setExact] = useState<string | null>(null);
  const [exactLoading, setExactLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const newSegment = () => { setEditingId(null); setName(""); setDescription(""); setRule(emptyRule()); setExact(null); };

  async function loadSegment(id: string) {
    setError(null);
    const res = await fetch(`/api/segments/${id}`);
    if (!res.ok) { setError("Failed to load segment"); return; }
    const body = await res.json() as { data: { name: string; description: string | null; rule: SegmentRule } };
    setEditingId(id);
    setName(body.data.name);
    setDescription(body.data.description ?? "");
    setRule(body.data.rule);
    setExact(null);
  }

  // Live estimate (debounced) whenever the rule changes.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEstimating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/segments/size", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "estimate", rule }),
        });
        if (res.ok) { const b = await res.json(); setEstimate(b.data.count); }
      } finally {
        setEstimating(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [rule]);

  async function getExact() {
    setExactLoading(true);
    setExact(null);
    try {
      const res = await fetch("/api/segments/size", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "exact", rule }),
      });
      const b = await res.json();
      setExact(b.data?.timedOut ? "timed out — refine the segment" : `${b.data.count}`);
    } finally {
      setExactLoading(false);
    }
  }

  async function save() {
    setError(null);
    if (!name.trim()) { setError("Name is required"); return; }
    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/api/segments/${editingId}` : "/api/segments";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, rule }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Failed to save"); return;
    }
    router.refresh();
  }

  async function remove() {
    if (!editingId) return;
    if (!confirm("Delete this segment?")) return;
    await fetch(`/api/segments/${editingId}`, { method: "DELETE" });
    newSegment();
    router.refresh();
  }

  const ctx: EditorContext = {
    personaOptions,
    segmentNameOptions,
    onAddCondition: useCallback((path) => setRule((r) => addChild(r, path, firstCondition())), []),
    onAddGroup: useCallback((path) => setRule((r) => addChild(r, path, { kind: "group", join: "AND", children: [] })), []),
    onRemove: useCallback((path) => setRule((r) => removeAt(r, path)), []),
    onChangeCondition: useCallback((path, next) => setRule((r) => updateConditionAt(r, path, next)), []),
    onToggleJoin: useCallback((path, join) => setRule((r) => setJoinAt(r, path, join)), []),
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
      {/* Saved list */}
      <div className="space-y-2">
        <button onClick={newSegment} className="w-full rounded-lg border px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">
          New segment
        </button>
        <div className="rounded-lg border divide-y">
          {segments.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No saved segments yet.</p>
          ) : segments.map((s) => (
            <button key={s.id} onClick={() => loadSegment(s.id)} className={`block w-full text-left px-3 py-2 text-sm hover:bg-muted ${editingId === s.id ? "bg-muted" : ""}`}>
              <div className="font-medium truncate">{s.name}</div>
              <div className="text-[10px] text-muted-foreground">Updated {new Date(s.updatedAt).toLocaleDateString()}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="space-y-4 max-w-3xl">
        <div className="flex flex-wrap gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" className="flex-1 min-w-48 rounded-lg border bg-background px-3 py-2 text-sm" />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" className="flex-1 min-w-48 rounded-lg border bg-background px-3 py-2 text-sm" />
        </div>

        <RuleNodeEditor node={rule} path={[]} ctx={ctx} />

        <div className="flex flex-wrap items-center gap-4 rounded-lg border p-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Estimated size: </span>
            <span className="font-semibold">{estimating ? "estimating…" : estimate === null ? "—" : `≈ ${estimate.toLocaleString()} users`}</span>
          </div>
          <button onClick={getExact} disabled={exactLoading} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50">
            {exactLoading ? "counting…" : "Get exact count"}
          </button>
          {exact !== null && <span className="text-sm font-semibold">{exact}</span>}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button onClick={save} className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90">
            {editingId ? "Save changes" : "Create segment"}
          </button>
          {editingId && (
            <button onClick={remove} className="rounded-lg border px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Replace the page placeholder**

```tsx
// src/app/audience/segments/page.tsx
import { Header } from "@/components/layout/header";
import { prisma } from "@/lib/db";
import { SegmentBuilder, type SegmentSummary } from "@/components/segments/segment-builder";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  const [rows, personas, segmentNames] = await Promise.all([
    prisma.segment.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, name: true, description: true, updatedAt: true } }),
    prisma.persona.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.userSegment.findMany({ distinct: ["segmentName"], select: { segmentName: true }, orderBy: { segmentName: "asc" } }),
  ]);

  const segments: SegmentSummary[] = rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
  const personaOptions = personas.map((p) => ({ value: p.id, label: p.name }));
  const segmentNameOptions = segmentNames.map((s) => s.segmentName);

  return (
    <>
      <Header title="Segments" description="Build audience segments from your data fields and size them against the database." />
      <div className="flex-1 p-6">
        <SegmentBuilder segments={segments} personaOptions={personaOptions} segmentNameOptions={segmentNameOptions} />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/regression/segments-page.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/segments/rule-node-editor.tsx src/components/segments/segment-builder.tsx src/app/audience/segments/page.tsx tests/regression/segments-page.test.tsx
git commit -m "feat(audience): nested segment builder UI on /audience/segments"
```

---

## Final verification (before MR)

- [ ] **Quick check:** `bun run check:quick` → EXIT 0 (typecheck + lint + unit/contract).
- [ ] **Full check:** `env -u PGUSER -u PGPASSWORD -u PGHOST -u PGDATABASE -u PGPORT DATABASE_URL="postgresql://localhost:5432/nexus_test" bun run check` → EXIT 0.
- [ ] **Manual dev pass** (`bun run dev`, authenticated): on `/audience/segments` — add a condition, watch the live estimate update; add a nested OR group; click "Get exact count"; save a segment; reload it from the list; edit + save; delete. Note: the page + API sit behind WorkOS auth, so unauthenticated curl returns 307/401 (expected).
- [ ] **Ship:** push `feat/audience-segments-c1`; `glab mr create`; poll `glab api projects/lifechurch%2Fyouversion%2Fmarketing-group%2Fnexus/merge_requests/N` until `detailed_merge_status == "mergeable"`; then `glab mr merge`.

---

## Self-review (against the spec)

**Spec coverage:**
- §1 rule-tree model → Task 1 (types) + Task 2 (parser). ✓
- §2 field catalog (4 categories, operator-by-type, consistency test) → Task 1. ✓
- §3 recursive parameterized compiler (all operators, EXISTS, in/nin array, contains-in-value, empty group, depth via parser) → Task 3 (+ injection guard Task 9). ✓
- §4 sizing (planner estimate + exact COUNT + statement_timeout + timedOut result) → Task 5. ✓
- §5 `Segment` model + idempotent migration + CRUD + size route + name-collision (Segment + UserSegment) + requireAdmin → Tasks 6, 7, 8. ✓
- §6 builder UI (recursive editor, live estimate, exact button, save/delete, server-fetched persona + segment-name options) → Task 10. ✓
- §7 error handling (400 invalid rule, 409 dup, 404 missing, timedOut 200, corrupt-rule degrade) → Tasks 7, 8. ✓
- Testing matrix (unit compile/catalog/tree-ops/parse; integration routes + sizing; regression injection + page) → Tasks 1–10. ✓
- Out-of-scope (C2 sizes page, C3 materialization, exact-count caching) → not implemented, by design. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `CompiledWhere`, `SegmentRule`/`RuleNode`/`Condition`/`Operator`, `FieldDef`/`FieldCompile`, `ExactResult`, `SegmentSummary`, `EditorContext`, and the tree-ops signatures (`addChild`/`removeAt`/`updateConditionAt`/`setJoinAt`/`emptyRule`) are defined once and used consistently across tasks. The size route returns `{ count, mode, timedOut? }`, matching what the builder reads (`b.data.count`, `b.data.timedOut`).
