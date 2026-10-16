# Content Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each client pick where message content comes from: the Nexus library, Contentful, Sanity, a generic JSON endpoint, or Braze Catalogs. The bandit engine must not change.

**Architecture:**
- Each source implements a `ContentSource` port (`src/connectors/content/`).
- A sync service materialises the source's items as `MessageVariant` rows. Rows are keyed by `(contentSource, externalRef)`, so arms stay `MessageVariant.id`.
- A new pure module, `src/lib/content-core/`, holds the item schema, the field mapping and the activation-property builders. Spec B's demo shares it.
- Braze Catalog variants add `catalog_item_id` to the trigger and canvas properties.
- Config lives behind one accessor, so P1 can make it per-workspace.

**Tech Stack:** Next.js 16 route handlers, Prisma v7 + Postgres, Zod 4, Bun test, FakeFetch fixtures.

**Spec:** `docs/superpowers/specs/2026-10-15-content-sources-design.md`

## Global Constraints

- Arms stay `MessageVariant.id`. Don't change `src/lib/engine/**`.
- `src/lib/content-core/**` is pure: no DB, network, env, `Date.now()` or globals. It is the same contract as `src/lib/engine/CLAUDE.md`.
- Push and email `/messages/send` payloads stay **byte-identical**. The P0 characterization snapshots (`tests/unit/characterization/*`, `tests/integration/characterization-select-and-send.test.ts`) must pass without `-u`.
- Never delete synced variants. Items missing from the source get `status = 'archived'`.
- A failing source never blocks sends.
- Secrets live only in env vars: `CONTENTFUL_DELIVERY_TOKEN`, `SANITY_READ_TOKEN`, `GENERIC_CONTENT_TOKEN`, `CONTENT_WEBHOOK_SECRET`, plus the existing `BRAZE_API_KEY` and `BRAZE_REST_ENDPOINT`. Non-secret config goes in the `AppSetting` key `content_source_config`.
- API routes:
  - return `{ data } | { error }` through `ok()` / `fail()` / `handleRouteError()` from `@/lib/api/respond`;
  - validate with Zod at the boundary;
  - mutating routes call `requireAdmin()` from `@/lib/auth`;
  - cron uses Bearer `CRON_SECRET` checked with `constantTimeEqual` from `@/lib/constant-time-compare`.
- Migrations are hand-written SQL with `IF NOT EXISTS`, applied to the test DB only with `psql`. Never run `prisma migrate dev` or `db push`. `.env.local` points at a database. Applying to the demo DB is done by the controller in Task 10.
- Every new route gets an integration test in `tests/integration/`. Every new engine-like pure function gets a unit test in `tests/unit/`.
- Commit only the files the task names. No attribution lines. The working tree may hold an unrelated `src/lib/engine/thompson-sampling.ts` edit and many untracked `*.png` files; never `git add -A`.
- If `npx prisma generate` dirties the tracked `apps/api/src/generated/**`, revert it.

## Review Focus

1. **A source returns an item whose `externalRef` has changed.** For example, a Contentful entry was deleted and recreated. Expected: the old variant is archived and the new one is created. Their arm stats aren't merged. *Test: Task 6, "recreated entry archives old, creates new".*
2. **A sync fails halfway**, with a network error on page 3. Expected: the run is recorded as `failed` with an error, items already upserted stay, and **nothing is archived**, because a partial listing must not archive unseen items. *Test: Task 6, "failed listing archives nothing".*
3. **Two syncs of one source run at once** (cron and a webhook). Expected: the second run returns `skipped: locked` right away and doesn't double-write. *Test: Task 6 lock test.*
4. **Someone edits a synced variant through a library API.** Expected: 409 `{ error: "This variant is synced from <source>; edit it at the source." }`. *Test: Task 8.*
5. **A webhook with a missing or wrong signature, or an unknown source.** Expected: 401 for a bad or missing signature, 404 for an unknown source, and no sync. *Test: Task 8.*

---

### Task 1: Migration, schema and the content-source config accessor

**Files:**
- Create: `prisma/migrations/20261015120000_content_sources/migration.sql`
- Modify: `prisma/schema.prisma` (models `Message` and `MessageVariant`, plus the new model `ContentSyncRun`)
- Create: `src/connectors/content/config.ts`
- Test: `tests/integration/content-source-config.test.ts`

**Interfaces:**
- Produces:
  - `type ContentSourceId = "nexus-library" | "contentful" | "sanity" | "generic-json" | "braze-catalog"`
  - `CONTENT_SOURCE_IDS: readonly ContentSourceId[]`
  - `type ContentSourceConfig` (below)
  - `getContentSourceConfig(): Promise<ContentSourceConfig>`
  - `saveContentSourceConfig(c: ContentSourceConfig): Promise<void>`
  - `contentSourceConfigSchema` (Zod)
  - Prisma fields `Message.contentSource`, `MessageVariant.contentSource`, `MessageVariant.externalRef` and `MessageVariant.syncedAt`, and model `ContentSyncRun`

- [ ] **Step 1: Write the migration**

```sql
-- prisma/migrations/20261015120000_content_sources/migration.sql
-- Pluggable content sources (spec 2026-10-15). Additive and idempotent.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "contentSource" TEXT NOT NULL DEFAULT 'nexus-library';
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "contentSource" TEXT NOT NULL DEFAULT 'nexus-library';
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "MessageVariant" ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS "MessageVariant_contentSource_externalRef_key"
  ON "MessageVariant" ("contentSource", "externalRef") WHERE "externalRef" IS NOT NULL;
CREATE TABLE IF NOT EXISTS "ContentSyncRun" (
  "id"         TEXT PRIMARY KEY,
  "source"     TEXT NOT NULL,
  "startedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finishedAt" TIMESTAMPTZ,
  "status"     TEXT NOT NULL,
  "created"    INTEGER NOT NULL DEFAULT 0,
  "updated"    INTEGER NOT NULL DEFAULT 0,
  "archived"   INTEGER NOT NULL DEFAULT 0,
  "skipped"    INTEGER NOT NULL DEFAULT 0,
  "errors"     JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS "ContentSyncRun_source_startedAt_idx" ON "ContentSyncRun" ("source", "startedAt" DESC);
```

Schema additions:
- `Message`: `contentSource String @default("nexus-library")`
- `MessageVariant`:
  - `contentSource String @default("nexus-library")`
  - `externalRef String?`
  - `syncedAt DateTime? @db.Timestamptz(6)`
  - a comment: `// unique (contentSource, externalRef) WHERE externalRef IS NOT NULL — partial index in migration SQL, not expressible in Prisma`
- New model:

```prisma
model ContentSyncRun {
  id         String    @id @default(cuid())
  source     String
  startedAt  DateTime  @default(now()) @db.Timestamptz(6)
  finishedAt DateTime? @db.Timestamptz(6)
  status     String
  created    Int       @default(0)
  updated    Int       @default(0)
  archived   Int       @default(0)
  skipped    Int       @default(0)
  errors     Json      @default("[]")

  @@index([source, startedAt(sort: Desc)])
}
```

Apply to the test DB and regenerate:
- `psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" -f prisma/migrations/20261015120000_content_sources/migration.sql`
- `npx prisma generate`, then revert `apps/api/src/generated` if it changed.

- [ ] **Step 2: Write the failing config test**

```ts
// tests/integration/content-source-config.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { getContentSourceConfig, saveContentSourceConfig } from "@/connectors/content/config";

describe("content source config", () => {
  beforeEach(truncateAll);

  it("defaults to nexus-library only when nothing is stored", async () => {
    const c = await getContentSourceConfig();
    expect(c.enabled).toEqual(["nexus-library"]);
    expect(c.contentful).toBeUndefined();
  });

  it("round-trips a full config and never stores secrets", async () => {
    await saveContentSourceConfig({
      enabled: ["nexus-library", "contentful", "braze-catalog"],
      contentful: { spaceId: "sp1", environment: "master", contentType: "pushMessage", channel: "push", mapping: {} },
      brazeCatalog: { catalogName: "lumen_tips", channel: "content_card", mapping: { title: "headline" } },
    });
    const c = await getContentSourceConfig();
    expect(c.enabled).toContain("contentful");
    expect(c.brazeCatalog?.catalogName).toBe("lumen_tips");
    const raw = await prisma.appSetting.findUnique({ where: { key: "content_source_config" } });
    expect(raw?.value).not.toMatch(/token|secret/i);
  });

  it("falls back to the default when the stored JSON is invalid", async () => {
    await prisma.appSetting.create({ data: { key: "content_source_config", value: "{not json" } });
    expect((await getContentSourceConfig()).enabled).toEqual(["nexus-library"]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/content-source-config.test.ts`
Expected: FAIL, "Cannot find module '@/connectors/content/config'".

- [ ] **Step 4: Implement the accessor**

```ts
// src/connectors/content/config.ts
import { z } from "zod";
import { prisma } from "@/lib/db";

export const CONTENT_SOURCE_IDS = ["nexus-library", "contentful", "sanity", "generic-json", "braze-catalog"] as const;
export type ContentSourceId = (typeof CONTENT_SOURCE_IDS)[number];
const CHANNELS = ["push", "email", "content_card", "slideup", "modal"] as const;

const mappingSchema = z.record(z.string(), z.string().min(1)).default({});

export const contentSourceConfigSchema = z.object({
  enabled: z.array(z.enum(CONTENT_SOURCE_IDS)).min(1),
  contentful: z.object({
    spaceId: z.string().min(1), environment: z.string().min(1).default("master"),
    contentType: z.string().min(1), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
  sanity: z.object({
    projectId: z.string().min(1), dataset: z.string().min(1).default("production"),
    query: z.string().min(1), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
  genericJson: z.object({
    url: z.string().url(), itemsPath: z.string().min(1), channel: z.enum(CHANNELS),
    pagination: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("none") }),
      z.object({ mode: z.literal("cursor"), nextPath: z.string().min(1), param: z.string().min(1) }),
      z.object({ mode: z.literal("page"), param: z.string().min(1), pageSize: z.number().int().positive() }),
    ]).default({ mode: "none" }),
    mapping: mappingSchema,
  }).optional(),
  brazeCatalog: z.object({
    catalogName: z.string().regex(/^[a-zA-Z0-9_-]+$/), channel: z.enum(CHANNELS), mapping: mappingSchema,
  }).optional(),
});
export type ContentSourceConfig = z.infer<typeof contentSourceConfigSchema>;

const KEY = "content_source_config";
const DEFAULT: ContentSourceConfig = { enabled: ["nexus-library"] };

/** Single read path for content-source config. P1 replaces the body with a per-workspace Connection lookup. */
export async function getContentSourceConfig(): Promise<ContentSourceConfig> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT;
  try {
    const parsed = contentSourceConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export async function saveContentSourceConfig(c: ContentSourceConfig): Promise<void> {
  const value = JSON.stringify(contentSourceConfigSchema.parse(c));
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
```

Before relying on the `AppSetting` column names (`key`, `value`), check them in `prisma/schema.prisma`. Also confirm that `truncateAll` in `tests/helpers/db.ts` clears `AppSetting`. If it doesn't, delete the key in `beforeEach`.

- [ ] **Step 5: Run it to verify it passes**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/content-source-config.test.ts`. Expected: 3 pass.
Then run `bun run check:quick`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20261015120000_content_sources prisma/schema.prisma src/connectors/content/config.ts tests/integration/content-source-config.test.ts
git commit -m "feat(content): content-source columns, ContentSyncRun, and config accessor"
```

---

### Task 2: `content-core` (pure schema, mapping, activation helpers)

**Files:**
- Create: `src/lib/content-core/types.ts`, `src/lib/content-core/field-mapping.ts`, `src/lib/content-core/default-mappings.ts`, `src/lib/content-core/activation.ts`, `src/lib/content-core/index.ts`, `src/lib/content-core/CLAUDE.md`
- Test: `tests/unit/content-core/field-mapping.test.ts`, `tests/unit/content-core/activation.test.ts`

**Interfaces:**
- Produces, all exported from `@/lib/content-core`:
  - `contentItemSchema`, `ContentItem`, `ContentChannel`, `FieldMapping`
  - `applyFieldMapping(record: unknown, mapping: FieldMapping, defaults: { channel: ContentChannel }): { item: ContentItem } | { error: string }`
  - `getPath(obj: unknown, path: string): unknown`
  - `DEFAULT_MAPPINGS: Record<"contentful" | "sanity" | "generic-json" | "braze-catalog", FieldMapping>`
  - `referenceProperties(catalogItemId: string | null): Record<string, string>`
  - `buildActivationProperties(v: ActivationVariant, mode: "inline" | "reference"): Record<string, string>`
  - `ActivationVariant`
  - `brazeCatalogLiquid(catalogName: string, property?: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/content-core/field-mapping.test.ts
import { describe, expect, it } from "bun:test";
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";

describe("getPath", () => {
  const o = { a: { b: [{ c: 1 }, { c: 2 }] }, t: [{ sys: { id: "x" } }, { sys: { id: "y" } }] };
  it("reads dot paths, indexes and [*] collections", () => {
    expect(getPath(o, "a.b[1].c")).toBe(2);
    expect(getPath(o, "t[*].sys.id")).toEqual(["x", "y"]);
    expect(getPath(o, "a.missing.deep")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
});

describe("applyFieldMapping", () => {
  it("maps a Contentful-shaped entry with the default mapping", () => {
    const entry = {
      sys: { id: "e1", updatedAt: "2026-10-01T00:00:00Z" },
      fields: { title: { "en-US": "Breathe" }, body: { "en-US": "Two minutes.", "es": "Dos minutos." }, cta: { "en-US": "Start" } },
      metadata: { tags: [{ sys: { id: "calm" } }] },
    };
    const r = applyFieldMapping(entry, DEFAULT_MAPPINGS.contentful, { channel: "push" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item).toMatchObject({ externalRef: "e1", channel: "push", title: "Breathe", body: "Two minutes.", cta: "Start", tags: ["calm"] });
    expect(r.item.locales?.es?.body).toBe("Dos minutos.");
  });

  it("errors with the externalRef when a required field is missing", () => {
    const r = applyFieldMapping({ id: "x9", headline: "Hi" }, { externalRef: "id", title: "headline", body: "text" }, { channel: "push" });
    expect("error" in r && r.error).toMatch(/x9.*body/);
  });

  it("coerces numbers to strings, trims, and drops empty optional fields", () => {
    const r = applyFieldMapping({ id: 42, body: "  Hello  ", cta: "" }, { externalRef: "id", body: "body", cta: "cta" }, { channel: "content_card" });
    if (!("item" in r)) throw new Error(r.error);
    expect(r.item.externalRef).toBe("42");
    expect(r.item.body).toBe("Hello");
    expect(r.item.cta).toBeUndefined();
  });

  it("rejects non-object records", () => {
    expect("error" in applyFieldMapping("str", DEFAULT_MAPPINGS["generic-json"], { channel: "push" })).toBe(true);
  });
});
```

```ts
// tests/unit/content-core/activation.test.ts
import { describe, expect, it } from "bun:test";
import { brazeCatalogLiquid, buildActivationProperties, referenceProperties } from "@/lib/content-core";

const v = { contentSource: "braze-catalog", externalRef: "tip_7", title: "Breathe", body: "Two minutes.", cta: "Start", link: "lumen://breathe" };

describe("activation", () => {
  it("inline mode carries the copy only", () => {
    expect(buildActivationProperties(v, "inline")).toEqual({ title: "Breathe", message: "Two minutes.", cta: "Start", link: "lumen://breathe" });
  });
  it("reference mode adds catalog_item_id next to the copy", () => {
    expect(buildActivationProperties(v, "reference")).toEqual({ title: "Breathe", message: "Two minutes.", cta: "Start", link: "lumen://breathe", catalog_item_id: "tip_7" });
  });
  it("referenceProperties is empty without an id", () => {
    expect(referenceProperties(null)).toEqual({});
    expect(referenceProperties("tip_7")).toEqual({ catalog_item_id: "tip_7" });
  });
  it("renders the Liquid snippet for a catalog", () => {
    expect(brazeCatalogLiquid("lumen_tips")).toBe("{% catalog_items lumen_tips {{api_trigger_properties.${catalog_item_id}}} %}");
    expect(brazeCatalogLiquid("lumen_tips", "canvas_entry_properties")).toBe("{% catalog_items lumen_tips {{canvas_entry_properties.${catalog_item_id}}} %}");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/unit/content-core`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/content-core/types.ts
import { z } from "zod";

export const CONTENT_CHANNELS = ["push", "email", "content_card", "slideup", "modal"] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

const localeSchema = z.object({ title: z.string().optional(), body: z.string().optional(), subject: z.string().optional() });

export const contentItemSchema = z.object({
  externalRef: z.string().min(1).max(200),
  channel: z.enum(CONTENT_CHANNELS),
  title: z.string().max(500).optional(),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(20_000),
  cta: z.string().max(200).optional(),
  deeplink: z.string().max(2000).optional(),
  imageUrl: z.string().url().optional(),
  htmlBody: z.string().max(500_000).optional(),
  tags: z.array(z.string().max(100)).max(50),
  locales: z.record(z.string(), localeSchema).optional(),
  updatedAt: z.string().min(1),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

/** Nexus field → dot path in the source record. `locales` is derived, not mapped. */
export type FieldMapping = Partial<Record<Exclude<keyof ContentItem, "locales" | "channel">, string>>;
```

```ts
// src/lib/content-core/field-mapping.ts
import { contentItemSchema, type ContentChannel, type ContentItem, type FieldMapping } from "./types";

const TOKEN = /([^.[\]]+)|\[(\d+|\*)\]/g;

/** Reads `a.b[0].c` and `a[*].b` (collect). Returns undefined for any missing hop. */
export function getPath(obj: unknown, path: string): unknown {
  const tokens = [...path.matchAll(TOKEN)].map((m) => m[1] ?? m[2]!);
  let cur: unknown[] = [obj];
  let collecting = false;
  for (const t of tokens) {
    const next: unknown[] = [];
    for (const c of cur) {
      if (t === "*") {
        if (Array.isArray(c)) next.push(...c);
        collecting = true;
      } else if (c !== null && typeof c === "object") {
        const v = Array.isArray(c) && /^\d+$/.test(t) ? c[Number(t)] : (c as Record<string, unknown>)[t];
        if (v !== undefined) next.push(v);
      }
    }
    cur = next;
  }
  if (collecting) return cur;
  return cur[0];
}

/**
 * A Contentful field is a locale map ({ "en-US": "…", "es": "…" }). Returns the
 * default-locale value and every locale's value. Non-map values pass through.
 */
function splitLocales(v: unknown): { value: unknown; byLocale?: Record<string, unknown> } {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([k]) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k))) {
      const def = (v as Record<string, unknown>)["en-US"] ?? (v as Record<string, unknown>).en ?? entries[0]![1];
      return { value: def, byLocale: Object.fromEntries(entries) };
    }
  }
  return { value: v };
}

const asString = (v: unknown): string | undefined => {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
};

export function applyFieldMapping(
  record: unknown,
  mapping: FieldMapping,
  defaults: { channel: ContentChannel },
): { item: ContentItem } | { error: string } {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return { error: "record is not an object" };
  const ref = asString(splitLocales(getPath(record, mapping.externalRef ?? "id")).value) ?? "(no id)";
  const draft: Record<string, unknown> = { channel: defaults.channel, tags: [] };
  const locales: Record<string, Record<string, string>> = {};

  for (const [field, path] of Object.entries(mapping) as [keyof FieldMapping, string][]) {
    const { value, byLocale } = splitLocales(getPath(record, path));
    if (field === "tags") {
      const arr = Array.isArray(value) ? value : value === undefined ? [] : [value];
      draft.tags = arr.map(asString).filter((s): s is string => !!s);
      continue;
    }
    const s = asString(value);
    if (s !== undefined) draft[field] = s;
    if (byLocale && (field === "title" || field === "body" || field === "subject")) {
      for (const [loc, lv] of Object.entries(byLocale)) {
        const ls = asString(lv);
        if (ls && loc !== "en-US" && loc !== "en") (locales[loc] ??= {})[field] = ls;
      }
    }
  }
  if (Object.keys(locales).length) draft.locales = locales;
  draft.updatedAt ??= "1970-01-01T00:00:00Z";

  const parsed = contentItemSchema.safeParse(draft);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    return { error: `${ref}: invalid or missing ${fields}` };
  }
  return { item: parsed.data };
}
```

```ts
// src/lib/content-core/default-mappings.ts
import type { FieldMapping } from "./types";

export const DEFAULT_MAPPINGS: Record<"contentful" | "sanity" | "generic-json" | "braze-catalog", FieldMapping> = {
  contentful: {
    externalRef: "sys.id", updatedAt: "sys.updatedAt", title: "fields.title", body: "fields.body",
    subject: "fields.subject", cta: "fields.cta", deeplink: "fields.deeplink",
    imageUrl: "fields.imageUrl", tags: "metadata.tags[*].sys.id",
  },
  sanity: {
    externalRef: "_id", updatedAt: "_updatedAt", title: "title", body: "body", subject: "subject",
    cta: "cta", deeplink: "deeplink", imageUrl: "imageUrl", tags: "tags",
  },
  "generic-json": { externalRef: "id", updatedAt: "updatedAt", title: "title", body: "body", cta: "cta", deeplink: "deeplink", imageUrl: "imageUrl", tags: "tags" },
  "braze-catalog": { externalRef: "id", title: "title", body: "body", cta: "cta", deeplink: "deeplink", imageUrl: "image_url", tags: "tags" },
};
```

```ts
// src/lib/content-core/activation.ts
export type ActivationVariant = {
  contentSource: string;
  externalRef: string | null;
  title: string | null;
  body: string;
  cta: string | null;
  link: string | null;
};

/** The reference part of a trigger/canvas property bag. Empty when there is no catalog item. */
export function referenceProperties(catalogItemId: string | null): Record<string, string> {
  return catalogItemId ? { catalog_item_id: catalogItemId } : {};
}

/** Property bag Nexus sends to a Braze API-triggered campaign or canvas. Reference mode adds the catalog id NEXT TO the copy. */
export function buildActivationProperties(v: ActivationVariant, mode: "inline" | "reference"): Record<string, string> {
  const props: Record<string, string> = { message: v.body };
  if (v.title) props.title = v.title;
  if (v.cta) props.cta = v.cta;
  if (v.link) props.link = v.link;
  const ordered: Record<string, string> = {};
  for (const k of ["title", "message", "cta", "link"]) if (props[k] !== undefined) ordered[k] = props[k]!;
  return mode === "reference" ? { ...ordered, ...referenceProperties(v.externalRef) } : ordered;
}

/** The Liquid a Braze template uses to render the catalog item Nexus picked. */
export function brazeCatalogLiquid(catalogName: string, property: "api_trigger_properties" | "canvas_entry_properties" = "api_trigger_properties"): string {
  return `{% catalog_items ${catalogName} {{${property}.\${catalog_item_id}}} %}`;
}
```

```ts
// src/lib/content-core/index.ts
export * from "./types";
export * from "./field-mapping";
export * from "./default-mappings";
export * from "./activation";
```

`src/lib/content-core/CLAUDE.md` holds one paragraph: "Pure module shared by the Nexus app and apps/site (Spec B). Same contract as src/lib/engine: no DB, network, env, Date.now() or globals. Every export has a unit test in tests/unit/content-core/."

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/unit/content-core`, then `bun run check:quick`.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-core tests/unit/content-core
git commit -m "feat(content): pure content-core — item schema, field mapping, activation helpers"
```

---

### Task 3: The port, the registry and the Contentful adapter

**Files:**
- Create: `src/connectors/content/types.ts`, `src/connectors/content/registry.ts`, `src/connectors/content/http.ts`, `src/connectors/content/adapters/contentful.ts`, `src/connectors/content/adapters/nexus-library.ts`
- Create fixtures: `tests/fixtures/content/contentful/page-1.json`, `tests/fixtures/content/contentful/page-2.json`
- Test: `tests/contracts/content-sources/contentful.test.ts`

**Interfaces:**
- Consumes: `ContentSourceConfig` and `ContentSourceId` (Task 1); `applyFieldMapping`, `DEFAULT_MAPPINGS` and `ContentItem` (Task 2).
- Produces:
  - `interface ContentSource { id; activation: "inline" | "reference"; testConnection(): Promise<{ ok: true; sample: ContentItem[] } | { ok: false; error: string }>; listItems(cursor?: string): Promise<ListPage> }`
  - `type ListPage = { items: ContentItem[]; skipped: { externalRef: string; error: string }[]; next?: string }`
  - `createContentSource(id: ContentSourceId, config: ContentSourceConfig, env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource`, which throws `ContentSourceNotConfigured` when config or a token is missing
  - `fetchJson(url, init, fetchImpl): Promise<{ status: number; json: unknown; headers: Headers }>`, with a 10s timeout and never throwing on non-2xx

- [ ] **Step 1: Create the fixtures**

`page-1.json` is a Contentful Delivery API response with `"total": 3`, `"skip": 0`, `"limit": 2` and two `items`:
- entry `e1`: localized `title`, a `body` with `en-US` and `es` values, `cta`, and `metadata.tags` `[{"sys":{"id":"calm"}}]`;
- entry `e2`: missing `body`, so it must be skipped.

`page-2.json` has `"skip": 2` and one valid item, `e3`. Each item uses Contentful's shape: `{ "sys": { "id", "updatedAt", "contentType": { "sys": { "id": "pushMessage" } } }, "fields": { "<name>": { "en-US": … } }, "metadata": { "tags": [...] } }`.

- [ ] **Step 2: Write the failing contract test**

```ts
// tests/contracts/content-sources/contentful.test.ts
import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import page1 from "../../fixtures/content/contentful/page-1.json";
import page2 from "../../fixtures/content/contentful/page-2.json";

const config = { enabled: ["contentful" as const], contentful: { spaceId: "sp1", environment: "master", contentType: "pushMessage", channel: "push" as const, mapping: {} } };
const env = { CONTENTFUL_DELIVERY_TOKEN: "cf-token" } as unknown as NodeJS.ProcessEnv;

describe("contentful adapter", () => {
  it("pages to the end, maps locales, skips malformed items with their id, sends the token", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(page1);
    ff.queueResponse(page2);
    const src = createContentSource("contentful", config, env, ff.fetch);
    const p1 = await src.listItems();
    expect(p1.items.map((i) => i.externalRef)).toEqual(["e1"]);
    expect(p1.skipped).toEqual([{ externalRef: "e2", error: expect.stringContaining("body") }]);
    expect(p1.items[0]!.locales?.es?.body).toBeDefined();
    expect(p1.next).toBe("2");
    const p2 = await src.listItems(p1.next);
    expect(p2.items.map((i) => i.externalRef)).toEqual(["e3"]);
    expect(p2.next).toBeUndefined();
    expect(ff.requests[0]!.url).toContain("/spaces/sp1/environments/master/entries?content_type=pushMessage&locale=*&skip=0&limit=100");
    expect(ff.requests[0]!.headers.authorization).toBe("Bearer cf-token");
  });

  it("testConnection reports an auth failure without throwing", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ message: "The access token you sent could not be found or is invalid." }, 401);
    const r = await createContentSource("contentful", config, env, ff.fetch).testConnection();
    expect(r).toEqual({ ok: false, error: "Contentful responded 401" });
  });

  it("throws ContentSourceNotConfigured without a token", () => {
    expect(() => createContentSource("contentful", config, {} as NodeJS.ProcessEnv)).toThrow(/CONTENTFUL_DELIVERY_TOKEN/);
  });
});
```

`FakeFetch` records the `url` and lowercased headers and returns queued bodies in order. It lives in `tests/helpers/braze.ts`. The adapter must pass headers as a plain object for `FakeFetch` to read them.

- [ ] **Step 3: Run to verify it fails**

Run: `bun test tests/contracts/content-sources/contentful.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 4: Implement**

```ts
// src/connectors/content/types.ts
import type { ContentItem } from "@/lib/content-core";
import type { ContentSourceId } from "./config";

export type ListPage = { items: ContentItem[]; skipped: { externalRef: string; error: string }[]; next?: string };

export interface ContentSource {
  id: ContentSourceId;
  activation: "inline" | "reference";
  testConnection(): Promise<{ ok: true; sample: ContentItem[] } | { ok: false; error: string }>;
  listItems(cursor?: string): Promise<ListPage>;
}

export class ContentSourceNotConfigured extends Error {}
```

```ts
// src/connectors/content/http.ts
export async function fetchJson(url: string, init: { headers: Record<string, string> }, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url, { method: "GET", headers: init.headers, signal: AbortSignal.timeout(10_000) });
  const json: unknown = await res.json().catch(() => null);
  return { status: res.status, json, headers: res.headers };
}

/** Shared helper: split mapped results into items and skipped. */
export function partition<T>(results: ({ item: T } | { error: string; ref: string })[]) {
  const items: T[] = [];
  const skipped: { externalRef: string; error: string }[] = [];
  for (const r of results) "item" in r ? items.push(r.item) : skipped.push({ externalRef: r.ref, error: r.error });
  return { items, skipped };
}
```

```ts
// src/connectors/content/adapters/contentful.ts
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

const PAGE = 100;

export function contentfulSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const c = config.contentful;
  if (!c) throw new ContentSourceNotConfigured("Contentful is not configured");
  const token = env.CONTENTFUL_DELIVERY_TOKEN;
  if (!token) throw new ContentSourceNotConfigured("CONTENTFUL_DELIVERY_TOKEN is not set");
  const mapping = { ...DEFAULT_MAPPINGS.contentful, ...c.mapping };
  const base = `https://cdn.contentful.com/spaces/${encodeURIComponent(c.spaceId)}/environments/${encodeURIComponent(c.environment)}/entries`;

  async function page(skip: number, limit: number) {
    const url = `${base}?content_type=${encodeURIComponent(c!.contentType)}&locale=*&skip=${skip}&limit=${limit}`;
    const r = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, fetchImpl);
    if (r.status !== 200) throw new Error(`Contentful responded ${r.status}`);
    return r.json as { items?: unknown[]; total?: number; skip?: number };
  }

  function map(items: unknown[]) {
    return partition(items.map((raw) => {
      const r = applyFieldMapping(raw, mapping, { channel: c!.channel });
      return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "sys.id") ?? "(no id)") };
    }));
  }

  return {
    id: "contentful",
    activation: "inline",
    async listItems(cursor) {
      const skip = cursor ? Number(cursor) : 0;
      const body = await page(skip, PAGE);
      const items = body.items ?? [];
      const nextSkip = skip + items.length;
      return { ...map(items), next: items.length > 0 && nextSkip < (body.total ?? 0) ? String(nextSkip) : undefined };
    },
    async testConnection() {
      try {
        return { ok: true, sample: map((await page(0, 3)).items ?? []).items };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Contentful request failed" };
      }
    },
  };
}
```

```ts
// src/connectors/content/adapters/nexus-library.ts
import type { ContentSource } from "../types";
/** The built-in library: variants are authored in Nexus, so there is nothing to sync. */
export const nexusLibrarySource: ContentSource = {
  id: "nexus-library",
  activation: "inline",
  async listItems() { return { items: [], skipped: [] }; },
  async testConnection() { return { ok: true, sample: [] }; },
};
```

```ts
// src/connectors/content/registry.ts
import type { ContentSourceConfig, ContentSourceId } from "./config";
import { contentfulSource } from "./adapters/contentful";
import { nexusLibrarySource } from "./adapters/nexus-library";
import { ContentSourceNotConfigured, type ContentSource } from "./types";

export function createContentSource(
  id: ContentSourceId, config: ContentSourceConfig,
  env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch,
): ContentSource {
  switch (id) {
    case "nexus-library": return nexusLibrarySource;
    case "contentful": return contentfulSource(config, env, fetchImpl);
    default: throw new ContentSourceNotConfigured(`${id} adapter is not available`);
  }
}
```

Note on the image: the Contentful default mapping reads `fields.imageUrl`, a plain text field. Resolving `includes.Asset` links is out of scope. Clients map their own image URL field.

- [ ] **Step 5: Run to verify it passes**

Run: `bun test tests/contracts/content-sources/contentful.test.ts`, then `bun run check:quick`.
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/connectors/content tests/contracts/content-sources/contentful.test.ts tests/fixtures/content/contentful
git commit -m "feat(content): ContentSource port, registry, and Contentful adapter"
```

---

### Task 4: The Sanity and generic-JSON adapters

**Files:**
- Create: `src/connectors/content/adapters/sanity.ts`, `src/connectors/content/adapters/generic-json.ts`
- Modify: `src/connectors/content/registry.ts` (add the two cases)
- Fixtures:
  - `tests/fixtures/content/sanity/page-1.json`: `{ "result": [3 docs, one with no body] }`
  - `tests/fixtures/content/sanity/page-2.json`: `{ "result": [] }`
  - `tests/fixtures/content/generic/cursor-1.json`: `{ "data": { "items": [2 items] }, "next": "abc" }`
  - `tests/fixtures/content/generic/cursor-2.json`: `{ "data": { "items": [1 item] }, "next": null }`
- Test: `tests/contracts/content-sources/sanity.test.ts`, `tests/contracts/content-sources/generic-json.test.ts`

**Interfaces:**
- Consumes: the `ContentSource` contract, `fetchJson`, `partition` and `ContentSourceNotConfigured` (Task 3); `applyFieldMapping`, `DEFAULT_MAPPINGS` and `getPath` (Task 2).
- Produces: the registry supports `"sanity"` and `"generic-json"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/contracts/content-sources/sanity.test.ts
import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import p1 from "../../fixtures/content/sanity/page-1.json";
import p2 from "../../fixtures/content/sanity/page-2.json";

const config = { enabled: ["sanity" as const], sanity: { projectId: "abc123", dataset: "production", query: '*[_type == "tip"]', channel: "content_card" as const, mapping: {} } };

describe("sanity adapter", () => {
  it("slices with GROQ until an empty page, skips malformed docs", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(p1);
    ff.queueResponse(p2);
    const src = createContentSource("sanity", config, { SANITY_READ_TOKEN: "s-tok" } as unknown as NodeJS.ProcessEnv, ff.fetch);
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.skipped).toHaveLength(1);
    expect(a.next).toBe("100");
    const b = await src.listItems(a.next);
    expect(b.items).toHaveLength(0);
    expect(b.next).toBeUndefined();
    const url = decodeURIComponent(ff.requests[0]!.url);
    expect(url).toContain("https://abc123.api.sanity.io/v2025-02-19/data/query/production?query=");
    expect(url).toContain('*[_type == "tip"][0...100]');
    expect(ff.requests[0]!.headers.authorization).toBe("Bearer s-tok");
  });

  it("works without a token for public datasets", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(p2);
    await createContentSource("sanity", config, {} as NodeJS.ProcessEnv, ff.fetch).listItems();
    expect(ff.requests[0]!.headers.authorization).toBeUndefined();
  });
});
```

```ts
// tests/contracts/content-sources/generic-json.test.ts
import { describe, expect, it } from "bun:test";
import { FakeFetch } from "../../helpers/braze";
import { createContentSource } from "@/connectors/content/registry";
import c1 from "../../fixtures/content/generic/cursor-1.json";
import c2 from "../../fixtures/content/generic/cursor-2.json";

const base = { url: "https://cms.example.com/api/messages", itemsPath: "data.items", channel: "push" as const, mapping: { externalRef: "id", body: "text", title: "headline" } };

describe("generic-json adapter", () => {
  it("follows a cursor and uses the custom mapping", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c1);
    ff.queueResponse(c2);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "cursor" as const, nextPath: "next", param: "after" } } };
    const src = createContentSource("generic-json", config, { GENERIC_CONTENT_TOKEN: "g" } as unknown as NodeJS.ProcessEnv, ff.fetch);
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.next).toBe("abc");
    const b = await src.listItems(a.next);
    expect(b.next).toBeUndefined();
    expect(ff.requests[1]!.url).toBe("https://cms.example.com/api/messages?after=abc");
  });

  it("page mode stops when a page is shorter than pageSize", async () => {
    const ff = new FakeFetch();
    ff.queueResponse(c2);
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "page" as const, param: "page", pageSize: 50 } } };
    const p = await createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch).listItems();
    expect(p.next).toBeUndefined();
    expect(ff.requests[0]!.url).toBe("https://cms.example.com/api/messages?page=1");
  });

  it("reports a non-array itemsPath as an error, not a crash", async () => {
    const ff = new FakeFetch();
    ff.queueResponse({ data: { items: "nope" } });
    const config = { enabled: ["generic-json" as const], genericJson: { ...base, pagination: { mode: "none" as const } } };
    await expect(createContentSource("generic-json", config, {} as NodeJS.ProcessEnv, ff.fetch).listItems()).rejects.toThrow(/itemsPath/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/contracts/content-sources`
Expected: the new tests fail with `sanity adapter is not available` or `generic-json adapter is not available`.

- [ ] **Step 3: Implement**

```ts
// src/connectors/content/adapters/sanity.ts
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

const PAGE = 100;

export function sanitySource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const s = config.sanity;
  if (!s) throw new ContentSourceNotConfigured("Sanity is not configured");
  const mapping = { ...DEFAULT_MAPPINGS.sanity, ...s.mapping };
  const headers: Record<string, string> = env.SANITY_READ_TOKEN ? { Authorization: `Bearer ${env.SANITY_READ_TOKEN}` } : {};

  async function slice(from: number, to: number) {
    const q = `${s!.query}[${from}...${to}]`;
    const url = `https://${s!.projectId}.api.sanity.io/v2025-02-19/data/query/${encodeURIComponent(s!.dataset)}?query=${encodeURIComponent(q)}`;
    const r = await fetchJson(url, { headers }, fetchImpl);
    if (r.status !== 200) throw new Error(`Sanity responded ${r.status}`);
    const result = (r.json as { result?: unknown }).result;
    if (!Array.isArray(result)) throw new Error("Sanity query did not return an array");
    return result;
  }
  const map = (docs: unknown[]) => partition(docs.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: s.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "_id") ?? "(no id)") };
  }));

  return {
    id: "sanity",
    activation: "inline",
    async listItems(cursor) {
      const from = cursor ? Number(cursor) : 0;
      const docs = await slice(from, from + PAGE);
      return { ...map(docs), next: docs.length > 0 ? String(from + PAGE) : undefined };
    },
    async testConnection() {
      try { return { ok: true, sample: map(await slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Sanity request failed" }; }
    },
  };
}
```

```ts
// src/connectors/content/adapters/generic-json.ts
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

export function genericJsonSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const g = config.genericJson;
  if (!g) throw new ContentSourceNotConfigured("Generic JSON source is not configured");
  const mapping = { ...DEFAULT_MAPPINGS["generic-json"], ...g.mapping };
  const headers: Record<string, string> = env.GENERIC_CONTENT_TOKEN ? { Authorization: `Bearer ${env.GENERIC_CONTENT_TOKEN}` } : {};

  function urlFor(cursor?: string): string {
    const u = new URL(g!.url);
    if (g!.pagination.mode === "cursor" && cursor) u.searchParams.set(g!.pagination.param, cursor);
    if (g!.pagination.mode === "page") u.searchParams.set(g!.pagination.param, cursor ?? "1");
    return u.toString();
  }
  async function fetchPage(cursor?: string) {
    const r = await fetchJson(urlFor(cursor), { headers }, fetchImpl);
    if (r.status !== 200) throw new Error(`Content endpoint responded ${r.status}`);
    const items = getPath(r.json, g!.itemsPath);
    if (!Array.isArray(items)) throw new Error(`itemsPath "${g!.itemsPath}" did not resolve to an array`);
    return { items, json: r.json };
  }
  const map = (items: unknown[]) => partition(items.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: g.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, mapping.externalRef ?? "id") ?? "(no id)") };
  }));

  return {
    id: "generic-json",
    activation: "inline",
    async listItems(cursor) {
      const { items, json } = await fetchPage(cursor);
      let next: string | undefined;
      const p = g.pagination;
      if (p.mode === "cursor") { const n = getPath(json, p.nextPath); next = typeof n === "string" && n ? n : undefined; }
      if (p.mode === "page") next = items.length >= p.pageSize ? String(Number(cursor ?? "1") + 1) : undefined;
      return { ...map(items), next };
    },
    async testConnection() {
      try { return { ok: true, sample: map((await fetchPage()).items.slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Content endpoint request failed" }; }
    },
  };
}
```

Add `case "sanity": return sanitySource(config, env, fetchImpl);` and `case "generic-json": return genericJsonSource(config, env, fetchImpl);` to the registry switch.

- [ ] **Step 4: Run to verify they pass**

Run: `bun test tests/contracts/content-sources`, then `bun run check:quick`.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/content/adapters/sanity.ts src/connectors/content/adapters/generic-json.ts src/connectors/content/registry.ts tests/contracts/content-sources/sanity.test.ts tests/contracts/content-sources/generic-json.test.ts tests/fixtures/content/sanity tests/fixtures/content/generic
git commit -m "feat(content): Sanity and generic JSON content adapters"
```

---

### Task 5: The Braze Catalog adapter

**Files:**
- Create: `src/connectors/content/adapters/braze-catalog.ts`
- Modify: `src/connectors/content/registry.ts`
- Fixtures: `tests/fixtures/content/braze-catalog/page-1.json` (`{ "items": [2 items], "message": "success" }`) and `page-2.json` (`{ "items": [1 item], "message": "success" }`)
- Test: `tests/contracts/content-sources/braze-catalog.test.ts`

**Interfaces:**
- Produces: the registry supports `"braze-catalog"` with `activation: "reference"`. The cursor is the full next URL taken from the `Link` header.

- [ ] **Step 1: Write the failing test**

```ts
// tests/contracts/content-sources/braze-catalog.test.ts
import { describe, expect, it } from "bun:test";
import { createContentSource } from "@/connectors/content/registry";
import p1 from "../../fixtures/content/braze-catalog/page-1.json";
import p2 from "../../fixtures/content/braze-catalog/page-2.json";

const config = { enabled: ["braze-catalog" as const], brazeCatalog: { catalogName: "lumen_tips", channel: "content_card" as const, mapping: {} } };
const env = { BRAZE_API_KEY: "bk", BRAZE_REST_ENDPOINT: "https://rest.iad-01.braze.com" } as unknown as NodeJS.ProcessEnv;

describe("braze-catalog adapter", () => {
  it("follows the Link header and is reference-mode", async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string>).Authorization });
      const first = calls.length === 1;
      return new Response(JSON.stringify(first ? p1 : p2), {
        status: 200,
        headers: first ? { Link: '<https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c2>; rel="next"' } : {},
      });
    }) as typeof fetch;
    const src = createContentSource("braze-catalog", config, env, fakeFetch);
    expect(src.activation).toBe("reference");
    const a = await src.listItems();
    expect(a.items).toHaveLength(2);
    expect(a.next).toBe("https://rest.iad-01.braze.com/catalogs/lumen_tips/items?cursor=c2");
    const b = await src.listItems(a.next);
    expect(b.items).toHaveLength(1);
    expect(b.next).toBeUndefined();
    expect(calls[0]!.url).toBe("https://rest.iad-01.braze.com/catalogs/lumen_tips/items");
    expect(calls[0]!.auth).toBe("Bearer bk");
  });

  it("refuses a cursor URL on a different host", async () => {
    const src = createContentSource("braze-catalog", config, env, (async () => new Response("{}")) as typeof fetch);
    await expect(src.listItems("https://evil.example.com/x")).rejects.toThrow(/cursor/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/contracts/content-sources/braze-catalog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/connectors/content/adapters/braze-catalog.ts
import { applyFieldMapping, DEFAULT_MAPPINGS, getPath } from "@/lib/content-core";
import type { ContentSourceConfig } from "../config";
import { fetchJson, partition } from "../http";
import { ContentSourceNotConfigured, type ContentSource } from "../types";

function nextFromLink(link: string | null): string | undefined {
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  return m?.[1];
}

export function brazeCatalogSource(config: ContentSourceConfig, env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): ContentSource {
  const b = config.brazeCatalog;
  if (!b) throw new ContentSourceNotConfigured("Braze catalog is not configured");
  const key = env.BRAZE_API_KEY;
  const endpoint = env.BRAZE_REST_ENDPOINT ?? env.BRAZE_REST_URL;
  if (!key || !endpoint) throw new ContentSourceNotConfigured("BRAZE_API_KEY and BRAZE_REST_ENDPOINT must be set");
  const origin = new URL(endpoint).origin;
  const mapping = { ...DEFAULT_MAPPINGS["braze-catalog"], ...b.mapping };
  const first = `${origin}/catalogs/${b.catalogName}/items`;

  async function fetchPage(url: string) {
    if (new URL(url).origin !== origin) throw new Error("Refusing cursor outside the Braze REST endpoint");
    const r = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } }, fetchImpl);
    if (r.status !== 200) throw new Error(`Braze catalogs responded ${r.status}`);
    const items = (r.json as { items?: unknown }).items;
    if (!Array.isArray(items)) throw new Error("Braze catalogs response had no items array");
    return { items, next: nextFromLink(r.headers.get("link")) };
  }
  const map = (items: unknown[]) => partition(items.map((raw) => {
    const r = applyFieldMapping(raw, mapping, { channel: b.channel });
    return "item" in r ? r : { error: r.error, ref: String(getPath(raw, "id") ?? "(no id)") };
  }));

  return {
    id: "braze-catalog",
    activation: "reference",
    async listItems(cursor) {
      const p = await fetchPage(cursor ?? first);
      return { ...map(p.items), next: p.next };
    },
    async testConnection() {
      try { return { ok: true, sample: map((await fetchPage(first)).items.slice(0, 3)).items }; }
      catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Braze catalogs request failed" }; }
    },
  };
}
```

Add the registry case `case "braze-catalog": return brazeCatalogSource(config, env, fetchImpl);`. Catalog items have no `updatedAt`, so `applyFieldMapping` falls back to `1970-01-01`. That's acceptable, because sync compares content, not timestamps.

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `bun test tests/contracts/content-sources`, then `bun run check:quick`.

```bash
git add src/connectors/content/adapters/braze-catalog.ts src/connectors/content/registry.ts tests/contracts/content-sources/braze-catalog.test.ts tests/fixtures/content/braze-catalog
git commit -m "feat(content): Braze Catalog content adapter (reference mode)"
```

---

### Task 6: The sync service

**Files:**
- Create: `src/connectors/content/sync.ts`
- Test: `tests/integration/content-sync.test.ts`

**Interfaces:**
- Consumes: `createContentSource`, `ContentSource` and `getContentSourceConfig` (Tasks 1–5).
- Produces:
  - `type SyncResult = { status: "ok" | "partial" | "failed" | "skipped"; reason?: "locked" | "not-enabled"; created: number; updated: number; archived: number; skipped: number; errors: { externalRef: string; message: string }[] }`
  - `syncContentSource(id: ContentSourceId, deps?: { source?: ContentSource; now?: () => Date }): Promise<SyncResult>`
  - `LIBRARY_MESSAGE_NAME(source, channel): string`

- [ ] **Step 1: Write the failing integration tests**

```ts
// tests/integration/content-sync.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { syncContentSource } from "@/connectors/content/sync";
import { saveContentSourceConfig } from "@/connectors/content/config";
import type { ContentSource, ListPage } from "@/connectors/content/types";
import type { ContentItem } from "@/lib/content-core";

const item = (ref: string, body = `Body ${ref}`): ContentItem => ({ externalRef: ref, channel: "push", body, title: `T ${ref}`, tags: [], updatedAt: "2026-10-01T00:00:00Z", locales: { es: { body: `ES ${ref}` } } });
function fakeSource(pages: (ListPage | Error)[]): ContentSource {
  let i = 0;
  return { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
    listItems: async () => { const p = pages[i++]!; if (p instanceof Error) throw p; return p; } };
}

describe("syncContentSource", () => {
  beforeEach(async () => {
    await truncateAll();
    await saveContentSourceConfig({ enabled: ["nexus-library", "contentful"], contentful: { spaceId: "s", environment: "master", contentType: "t", channel: "push", mapping: {} } });
  });

  it("creates variants under one library message, with translations, and records a run", async () => {
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [], next: "1" }, { items: [item("b")], skipped: [{ externalRef: "bad", error: "bad: invalid body" }] }]) });
    expect(r).toMatchObject({ status: "partial", created: 2, updated: 0, archived: 0, skipped: 1 });
    const vs = await prisma.messageVariant.findMany({ where: { contentSource: "contentful" }, include: { message: true, translations: true } });
    expect(vs.map((v) => v.externalRef).sort()).toEqual(["a", "b"]);
    expect(new Set(vs.map((v) => v.messageId)).size).toBe(1);
    expect(vs[0]!.message.agentId).toBeNull();
    expect(vs[0]!.message.contentSource).toBe("contentful");
    expect(vs.find((v) => v.externalRef === "a")!.translations[0]).toMatchObject({ body: "ES a" });
    expect(await prisma.contentSyncRun.count()).toBe(1);
  });

  it("is idempotent and updates changed copy", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a", "New body")], skipped: [] }]) });
    expect(r).toMatchObject({ status: "ok", created: 0, updated: 1 });
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "a" } })).body).toBe("New body");
    const again = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a", "New body")], skipped: [] }]) });
    expect(again).toMatchObject({ created: 0, updated: 0 });
  });

  it("archives variants missing from a complete listing, never deletes", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a"), item("b")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [] }]) });
    expect(r.archived).toBe(1);
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("archived");
  });

  it("recreated entry archives old, creates new", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("old")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("new")], skipped: [] }]) });
    expect(r).toMatchObject({ created: 1, archived: 1 });
  });

  it("failed listing archives nothing and records the error", async () => {
    await syncContentSource("contentful", { source: fakeSource([{ items: [item("a"), item("b")], skipped: [] }]) });
    const r = await syncContentSource("contentful", { source: fakeSource([{ items: [item("a")], skipped: [], next: "1" }, new Error("Contentful responded 503")]) });
    expect(r.status).toBe("failed");
    expect(r.archived).toBe(0);
    expect(r.errors[0]!.message).toContain("503");
    expect((await prisma.messageVariant.findFirstOrThrow({ where: { externalRef: "b" } })).status).toBe("active");
  });

  it("an overlapping run for the same source is skipped as locked", async () => {
    let release!: () => void;
    const slow: ContentSource = { id: "contentful", activation: "inline", testConnection: async () => ({ ok: true, sample: [] }),
      listItems: () => new Promise((res) => { release = () => res({ items: [item("a")], skipped: [] }); }) };
    const first = syncContentSource("contentful", { source: slow });
    await new Promise((r) => setTimeout(r, 50));
    const second = await syncContentSource("contentful", { source: fakeSource([{ items: [], skipped: [] }]) });
    expect(second).toMatchObject({ status: "skipped", reason: "locked" });
    release();
    expect((await first).status).toBe("ok");
  });

  it("a disabled source is skipped", async () => {
    expect(await syncContentSource("sanity", { source: fakeSource([]) })).toMatchObject({ status: "skipped", reason: "not-enabled" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/content-sync.test.ts`
Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement**

```ts
// src/connectors/content/sync.ts
import { prisma } from "@/lib/db";
import type { ContentItem } from "@/lib/content-core";
import { getContentSourceConfig, type ContentSourceId } from "./config";
import { createContentSource } from "./registry";
import type { ContentSource } from "./types";

export type SyncResult = {
  status: "ok" | "partial" | "failed" | "skipped";
  reason?: "locked" | "not-enabled";
  created: number; updated: number; archived: number; skipped: number;
  errors: { externalRef: string; message: string }[];
};
const MAX_ERRORS = 50;
const MAX_PAGES = 500;
export const LIBRARY_MESSAGE_NAME = (source: string, channel: string) => `[${source}] ${channel} library`;

const copyOf = (i: ContentItem) => ({
  name: i.title ?? i.externalRef, title: i.title ?? null, subject: i.subject ?? null, body: i.body,
  cta: i.cta ?? null, deeplink: i.deeplink ?? null, iconImageUrl: i.imageUrl ?? null, htmlBody: i.htmlBody ?? null,
});

export async function syncContentSource(id: ContentSourceId, deps: { source?: ContentSource; now?: () => Date } = {}): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const empty = { created: 0, updated: 0, archived: 0, skipped: 0, errors: [] as SyncResult["errors"] };
  const config = await getContentSourceConfig();
  if (!config.enabled.includes(id)) return { status: "skipped", reason: "not-enabled", ...empty };

  return prisma.$transaction(async (tx) => {
    const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`content-sync:${id}`})) AS locked`;
    if (!locked) return { status: "skipped" as const, reason: "locked" as const, ...empty };

    const result: SyncResult = { status: "ok", ...empty, errors: [] };
    const startedAt = now();
    const seen = new Set<string>();
    let complete = false;
    try {
      const source = deps.source ?? createContentSource(id, config);
      let cursor: string | undefined;
      for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
        const page = await source.listItems(cursor);
        for (const s of page.skipped) {
          result.skipped++;
          if (result.errors.length < MAX_ERRORS) result.errors.push({ externalRef: s.externalRef, message: s.error });
        }
        for (const item of page.items) {
          seen.add(item.externalRef);
          await upsertItem(tx, id, item, now(), result);
        }
        if (!page.next) { complete = true; break; }
        cursor = page.next;
      }
    } catch (e) {
      result.status = "failed";
      result.errors.push({ externalRef: "(listing)", message: e instanceof Error ? e.message : "sync failed" });
    }
    // Only a complete listing may archive: a partial listing doesn't prove absence.
    if (complete) {
      const stale = await tx.messageVariant.updateMany({
        where: { contentSource: id, externalRef: { notIn: [...seen] }, status: { not: "archived" } },
        data: { status: "archived" },
      });
      result.archived = stale.count;
      if (result.skipped > 0) result.status = "partial";
    }
    await tx.contentSyncRun.create({
      data: { source: id, startedAt, finishedAt: now(), status: result.status, created: result.created, updated: result.updated,
        archived: result.archived, skipped: result.skipped, errors: result.errors.slice(0, MAX_ERRORS) },
    });
    return result;
  }, { timeout: 120_000, maxWait: 5_000 });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertItem(tx: Tx, source: string, item: ContentItem, at: Date, result: SyncResult) {
  const name = LIBRARY_MESSAGE_NAME(source, item.channel);
  const message = (await tx.message.findFirst({ where: { agentId: null, contentSource: source, channel: item.channel, name } }))
    ?? (await tx.message.create({ data: { name, channel: item.channel, contentSource: source } }));
  const existing = await tx.messageVariant.findFirst({ where: { contentSource: source, externalRef: item.externalRef } });
  const copy = copyOf(item);
  let variantId: string;
  if (!existing) {
    variantId = (await tx.messageVariant.create({ data: { ...copy, messageId: message.id, contentSource: source, externalRef: item.externalRef, syncedAt: at, status: "active" } })).id;
    result.created++;
  } else {
    variantId = existing.id;
    const changed = (Object.keys(copy) as (keyof typeof copy)[]).some((k) => existing[k] !== copy[k]) || existing.status === "archived";
    if (changed) {
      await tx.messageVariant.update({ where: { id: existing.id }, data: { ...copy, status: "active", syncedAt: at } });
      result.updated++;
    }
  }
  for (const [language, l] of Object.entries(item.locales ?? {})) {
    await tx.messageVariantTranslation.upsert({
      where: { variantId_language: { variantId, language } },
      create: { variantId, language, title: l.title ?? null, body: l.body ?? null, subject: l.subject ?? null },
      update: { title: l.title ?? null, body: l.body ?? null, subject: l.subject ?? null },
    });
  }
}
```

Before relying on `MessageVariantTranslation`'s exact column and unique names (`variantId`, `language`, the compound key name), check them in `prisma/schema.prisma` around line 127, and adapt the `upsert` `where` to the real compound key. If `body` is required there, skip locales that have no `body`. `MAX_PAGES` guards against a source that never stops returning `next`.

The `not-enabled` check reads the stored config even when a `source` is injected, which is why the test seeds the config.

- [ ] **Step 4: Run to verify it passes**

Run: `TEST_DB=true bun test --timeout 30000 tests/integration/content-sync.test.ts` (7 pass), then `bun run check:quick`.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/content/sync.ts tests/integration/content-sync.test.ts
git commit -m "feat(content): sync service — upsert, archive on complete listing, advisory lock, run log"
```

---

### Task 7: Activation (Braze Catalog reference in the trigger and canvas properties)

**Files:**
- Modify: `src/lib/cron/send-grouping.ts` (`VariantMeta` and `VariantSendGroup` get `catalogItemId: string | null`, threaded through `groupDecisionsByVariant` into the payload calls)
- Modify: `src/lib/braze/payload-factory.ts` (the content-card and canvas message types accept an optional `catalogItemId`, spread through `referenceProperties`)
- Modify: `src/app/api/cron/select-and-send/route.ts:879-899` (select `contentSource` and `externalRef`, and set `catalogItemId`)
- Test: `tests/unit/cron-send-grouping.test.ts` (new cases), `tests/unit/characterization/send-variant-group.snapshot.test.ts` (one new reference-mode case, reviewed by hand)

**Interfaces:**
- Consumes: `referenceProperties` from `@/lib/content-core` (Task 2).
- Produces: `VariantMeta.catalogItemId: string | null`. It is non-null only when `variant.contentSource === "braze-catalog"`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/cron-send-grouping.test.ts`, building on its existing `meta()` fixture:
- a content-card variant with `catalogItemId: "tip_7"`, sent through `sendVariantGroup` with `FakeFetch`. The `/campaigns/trigger/send` body's `trigger_properties` must contain `catalog_item_id: "tip_7"` **and** `title` and `message`.
- a slideup variant with `catalogItemId: "tip_7"`. The `/canvas/trigger/send` `canvas_entry_properties.catalog_item_id` must equal `"tip_7"`.
- a push variant with `catalogItemId: "tip_7"`. The `/messages/send` or schedule payload must **not** contain `catalog_item_id` anywhere: `JSON.stringify(body)` must not match `/catalog_item_id/`.
- `catalogItemId: null` produces no `catalog_item_id` key.

Update the existing `meta()` helper to default `catalogItemId: null`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test tests/unit/cron-send-grouping.test.ts`
Expected: the new cases fail, and type errors appear for the missing field.

- [ ] **Step 3: Implement**

1. `VariantMeta` gets `/** Braze catalog item id when the variant is synced from a Braze Catalog; null otherwise. */ catalogItemId: string | null;`. Copy it onto `VariantSendGroup` wherever the group copies `title`, `body`, `cta` and `deeplink` from the meta (around `send-grouping.ts:244-270`).
2. In `payload-factory.ts`, add `catalogItemId?: string | null` to `ContentCardMessage` and to the canvas message type. In `buildContentCardApiTriggerPayload`, after the `link` handling, add `Object.assign(trigger_properties, referenceProperties(msg.catalogItemId ?? null));`. In the canvas builder, add the same into `canvas_entry_properties`. Import `referenceProperties` from `@/lib/content-core`.
3. In `sendVariantGroup`, pass `catalogItemId: group.catalogItemId` into the content-card and canvas message objects only. Don't touch the push and email builders.
4. In `select-and-send/route.ts`, add `contentSource: true, externalRef: true` to the variant `select` that feeds `variantMeta` (find it from the `variantMeta.set(v.id, …)` call at ~898), and set `catalogItemId: v.contentSource === "braze-catalog" ? v.externalRef : null`. If the variants come from a typed helper rather than an inline `select`, add the two fields there.
5. Find every other construction of `VariantMeta` with `grep -rn "givingHandleStrategy:" src tests`. That includes `src/lib/decide.ts`, the demo send path and the test fixtures. Add `catalogItemId: null` where the variant's source isn't available, or the real value where it is.

- [ ] **Step 4: Prove nothing else changed**

Run:
- `bun test tests/unit/cron-send-grouping.test.ts tests/unit/characterization`
- `TEST_DB=true bun test --timeout 30000 tests/integration/characterization-select-and-send.test.ts tests/integration/cron-send.test.ts`

Expected: every P0 snapshot passes **without `-u`**.

Then add one case to `send-variant-group.snapshot.test.ts`, "content-card — braze-catalog reference", with `catalogItemId: "tip_7"`. Run it with `-u` for **that file only**. Confirm with `git diff` on the `.snap` that the only change is one new entry.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/send-grouping.ts src/lib/braze/payload-factory.ts src/app/api/cron/select-and-send/route.ts tests/unit/cron-send-grouping.test.ts tests/unit/characterization/send-variant-group.snapshot.test.ts tests/unit/characterization/__snapshots__/send-variant-group.snapshot.test.ts.snap
git commit -m "feat(content): send catalog_item_id for Braze Catalog variants on triggered channels"
```

Also add any other file Step 3.5 touched to the commit.

---

### Task 8: API routes (settings, test, sync, runs, webhook, cron, read-only guard)

**Files:**
- Create:
  - `src/app/api/settings/content-sources/route.ts` (GET, PUT)
  - `src/app/api/content/test/[source]/route.ts` (POST)
  - `src/app/api/content/sync/[source]/route.ts` (POST)
  - `src/app/api/content/sync-runs/route.ts` (GET)
  - `src/app/api/content/webhook/[source]/route.ts` (POST)
  - `src/app/api/cron/content-sync/route.ts` (GET)
- Create: `src/connectors/content/webhook-signature.ts`, `src/lib/api/assert-editable-variant.ts`
- Modify: every library route that mutates a variant's copy. Find them with `grep -rln "messageVariant.update\|messageVariant.delete" src/app/api`, then add the guard.
- Modify: `src/lib/auth/route-access.ts`. The webhook and cron paths are service routes (no session); follow how `/api/cron/select-and-send` and `/api/ingest/*` are classified there.
- Test:
  - `tests/integration/content-routes.test.ts`
  - `tests/unit/content-webhook-signature.test.ts`
  - `tests/integration/library-synced-readonly.test.ts`

**Interfaces:**
- Consumes: `getContentSourceConfig`, `saveContentSourceConfig`, `contentSourceConfigSchema`, `CONTENT_SOURCE_IDS`, `createContentSource`, `syncContentSource`, `ContentSourceNotConfigured`.
- Produces:
  - `verifyWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean`
  - `assertEditableVariant(variantId: string): Promise<NextResponse<{ error: string }> | null>`
  - response shapes:
    - `GET /api/settings/content-sources` → `{ data: { config, tokens: { contentful: boolean, sanity: boolean, genericJson: boolean, braze: boolean } } }`
    - `POST /api/content/test/[source]` → `{ data: { ok, sample?, error? } }`
    - `POST /api/content/sync/[source]` → `{ data: SyncResult }`
    - `GET /api/content/sync-runs?source=` → `{ data: ContentSyncRun[] }`, the latest 10

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/content-webhook-signature.test.ts
import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "@/connectors/content/webhook-signature";

const body = '{"sys":{"id":"e1"}}';
const sig = createHmac("sha256", "s3cret").update(body).digest("hex");

describe("verifyWebhookSignature", () => {
  it("accepts the right hex HMAC, with or without a sha256= prefix", () => {
    expect(verifyWebhookSignature(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${sig}`, "s3cret")).toBe(true);
  });
  it("rejects wrong, missing, or unconfigured", () => {
    expect(verifyWebhookSignature(body, sig.replace(/.$/, "0"), "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, null, "s3cret")).toBe(false);
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false);
    expect(verifyWebhookSignature(`${body} `, sig, "s3cret")).toBe(false);
  });
});
```

`tests/integration/content-routes.test.ts` follows the auth-mocking pattern of an existing settings or admin-route integration test (find one with `grep -rln "requireAdmin" tests/integration | head -3`). It covers:
- `GET /api/settings/content-sources`, admin: 200, the default config, and `tokens` booleans that reflect env presence. It must never include token values: assert that the JSON doesn't contain the test token string.
- `PUT`, admin, with a valid config: 200, and a later GET returns it. With `enabled: []` or an unknown source: 400. As a non-admin: 403.
- `POST /api/content/test/contentful` without a token in env: 200 `{ data: { ok: false, error: "CONTENTFUL_DELIVERY_TOKEN is not set" } }`.
- `POST /api/content/sync/nope`: 404. `POST /api/content/sync/sanity` while not enabled: 200 with `status: "skipped"`.
- `GET /api/content/sync-runs`: the latest runs, newest first, at most 10.
- `POST /api/content/webhook/contentful` with no or a bad signature: 401. An unknown source: 404. A valid signature (set `process.env.CONTENT_WEBHOOK_SECRET` in the test): 202, and the sync runs. Assert with `contentSyncRun.count()` after awaiting, or have the route `await` the sync for testability.
- `GET /api/cron/content-sync` without a Bearer token: 401. With `CRON_SECRET`: 200, `{ data: { results: { <source>: SyncResult } } }` for each enabled non-library source.

`tests/integration/library-synced-readonly.test.ts`: create a variant with `contentSource: "contentful"` under a library message, call one push-library mutating route against it (the `[id]` route's PATCH or DELETE), and expect 409 `{ error: "This variant is synced from contentful; edit it at the source." }`. A `nexus-library` variant is still editable.

- [ ] **Step 2: Run to verify they fail**

Run:
- `bun test tests/unit/content-webhook-signature.test.ts`
- `TEST_DB=true bun test --timeout 30000 tests/integration/content-routes.test.ts tests/integration/library-synced-readonly.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/connectors/content/webhook-signature.ts
import { createHmac } from "node:crypto";
import { constantTimeEqual } from "@/lib/constant-time-compare";

/** HMAC-SHA256 of the raw body, hex. Accepts "sha256=<hex>" or "<hex>". */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return given.length === expected.length && constantTimeEqual(given, expected);
}
```

```ts
// src/lib/api/assert-editable-variant.ts
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/api/respond";

/** Synced variants are read-only in Nexus — edits happen at the source. */
export async function assertEditableVariant(variantId: string): Promise<NextResponse<{ error: string }> | null> {
  const v = await prisma.messageVariant.findUnique({ where: { id: variantId }, select: { contentSource: true } });
  if (v && v.contentSource !== "nexus-library") return fail(`This variant is synced from ${v.contentSource}; edit it at the source.`, 409);
  return null;
}
```

The route bodies follow the repo pattern: `requireAdmin()` first on GET/PUT settings, test, sync and sync-runs; Zod-parse params and body; `ok()` / `fail()`; `handleRouteError(context, err)` in the catch. Specifics:

- **Source param:** `z.enum(CONTENT_SOURCE_IDS)`. Failure returns `fail("Unknown content source", 404)`.
- **Settings GET:** `tokens = { contentful: !!process.env.CONTENTFUL_DELIVERY_TOKEN, sanity: !!process.env.SANITY_READ_TOKEN, genericJson: !!process.env.GENERIC_CONTENT_TOKEN, braze: !!process.env.BRAZE_API_KEY }`.
- **Test route:** `try { const r = await createContentSource(id, await getContentSourceConfig()).testConnection(); return ok(r); } catch (e) { if (e instanceof ContentSourceNotConfigured) return ok({ ok: false, error: e.message }); return handleRouteError(…) }`.
- **Webhook:** read `await req.text()` for the raw body. Take the header from `x-nexus-signature`, falling back to `x-contentful-signature` and then `sanity-webhook-signature` raw values. If verification fails, return `fail("Invalid signature", 401)`. Otherwise `await syncContentSource(id)` and return `ok({ queued: true }, 202)`.
- **Cron:** a Bearer `CRON_SECRET` check via `constantTimeEqual`, the same as `select-and-send`'s `verifyAuth`. Then sync each `config.enabled` source except `nexus-library`, in sequence, and return `ok({ results })`.

Then add `const locked = await assertEditableVariant(id); if (locked) return locked;` at the top of every mutating library variant route found by the grep, after the auth check. List the files you changed in the report.

- [ ] **Step 4: Run to verify they pass**

Run the three test files above, then `bun run check:quick`.

- [ ] **Step 5: Commit**

Commit the new route files, the two helper files, the modified library routes, `route-access.ts` and the three test files, using explicit paths:

```bash
git commit -m "feat(content): content-source API routes, signed webhooks, cron, read-only synced variants"
```

---

### Task 9: The settings UI and source badges

**Files:**
- Create: `src/app/settings/content-sources/page.tsx` (server component; loads config and runs, and renders the client form)
- Create: `src/components/settings/content-sources-form.tsx` (client)
- Create: `src/components/content/source-badge.tsx`
- Modify: the library variant card and row components listed by `grep -rln "variant.body\|v.body" src/components/*-library`: `push-library/template-card.tsx`, `email-library/email-card.tsx`, `slideup-library/slideup-card.tsx`, `slideup-library/slideup-list-row.tsx`, `modal-iam-library/modal-iam-card.tsx`, `modal-iam-library/modal-iam-list-row.tsx`, `content-card-library/content-card-card.tsx` and `content-card-library/content-card-list-row.tsx`
- Modify: `src/app/settings/page.tsx` (add a link card, "Content sources →")
- Test: `tests/unit/source-badge.test.tsx`, `tests/integration/content-sources-page.test.ts`

**Interfaces:**
- Consumes: the Task 8 routes.
- Produces: `<SourceBadge source={string} externalRef={string | null} editUrl?: string />`, which renders nothing for `nexus-library`. For anything else it renders a small pill, `Contentful` / `Sanity` / `JSON` / `Braze Catalog`, with a title attribute of "Synced — edit at the source", and links to `editUrl` when given. Also `contentfulEditUrl(spaceId, entryId)`, which returns `https://app.contentful.com/spaces/${spaceId}/entries/${entryId}`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/source-badge.test.tsx` (React Testing Library, following an existing `tests/unit/*.test.tsx` setup):
- renders nothing for `nexus-library`;
- renders "Contentful" with the title "Synced — edit at the source" for `contentful`;
- renders an `<a href>` when `editUrl` is set;
- `contentfulEditUrl("sp1", "e1")` returns the exact URL.

`tests/integration/content-sources-page.test.ts` follows the pattern of an existing page-data integration test. It checks that the data the page renders matches `GET /api/settings/content-sources` (config plus token booleans), and that `GET /api/content/sync-runs` returns at most 10 runs.

- [ ] **Step 2: Run to verify they fail, then implement**

`content-sources-form.tsx` contains:
- one card for each source in `CONTENT_SOURCE_IDS`, with an enabled toggle. `nexus-library` is always on and disabled.
- each card's config fields as inputs:
  - Contentful: spaceId, environment, contentType, channel select;
  - Sanity: projectId, dataset, GROQ query textarea, channel;
  - Generic: url, itemsPath, pagination mode with its fields, channel;
  - Braze Catalog: catalogName, channel.
- a field-mapping editor: one text input per `FieldMapping` key, with the placeholder showing `DEFAULT_MAPPINGS[source][key]`.
- a "Token set ✓ / not set ✗" line from `tokens`.
- **Test connection**: it calls the test route and shows `ok` with the first 3 mapped items (title and body), or the error string.
- **Sync now**: it calls the sync route and shows the `SyncResult` counts.
- **Save**: it PUTs the whole config and shows a 400 error inline.
- below the cards, a table of the last 10 sync runs: source, started, status, created, updated, archived, skipped, first error.

Use the existing shadcn primitives in `src/components/ui/` (`card`, `button`, `input`, `badge`, `table`) and `cn()`. No business logic in the component: request bodies are built from form state and sent as is.

In each library card and row component, render `<SourceBadge source={variant.contentSource} externalRef={variant.externalRef} />` next to the variant name. When `contentSource !== "nexus-library"`, hide or disable that component's edit and delete controls. Make sure the data feeding those components includes `contentSource` and `externalRef`: add them to the library pages' Prisma `select`s or the API responses those pages read, and include those files in the commit.

- [ ] **Step 3: Run the tests, then check visually**

Run `bun run check:quick`, then `TEST_DB=true bun test --timeout 30000 tests/integration/content-sources-page.test.ts`.

Run `bun run dev`, open `/settings/content-sources`, and confirm the page renders with the default config and that Save shows a validation error for an invalid URL. If no browser is available, say so in the report.

- [ ] **Step 4: Commit**

Commit the page, the form, the badge, the edited library components, any `select` or API files changed for `contentSource`/`externalRef`, the settings link, and the two tests:

```bash
git commit -m "feat(content): Content sources settings page and synced-variant source badges"
```

---

### Task 10: Deploy and live check (the controller runs this)

This task touches the external demo DB, Vercel and third-party accounts. Never echo secrets: export the Vercel token as `VERCEL_TOKEN` and read it from the keychain.

- [ ] **Step 1:** Apply the migration to the demo DB (`nexus-demo-db`). Pull the env into a 0600 scratch file, run `psql "$DEMO_UNPOOLED" -v ON_ERROR_STOP=1 -f prisma/migrations/20261015120000_content_sources/migration.sql`, then delete the scratch file.
- [ ] **Step 2:** On the `nexus-ai` Vercel project (Dan's projects), set `CONTENT_WEBHOOK_SECRET` (`openssl rand -hex 32`, sensitive). Add the cron to `vercel.json`: `"crons": [{ "path": "/api/cron/content-sync", "schedule": "0 6 * * *" }]`. That's daily, because the demo is on the Hobby plan; the spec covers this. Commit `vercel.json`.
- [ ] **Step 3:** Ask Dan for a sandbox Contentful space ID and delivery token. Set `CONTENTFUL_DELIVERY_TOKEN` (sensitive). In the demo console, enable Contentful with a `pushMessage` content type, run **Test connection** and then **Sync now**, and confirm that variants appear in the push library with a Contentful badge. If Dan has a Sanity project or a Braze catalog, repeat for those.
- [ ] **Step 4:** Merge to `main` and push. The pre-push hook runs `check:quick`. Confirm the `nexus-ai` deploy is Ready and that `/settings/content-sources` loads on `nexus-ai-demo-dl.vercel.app`.

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Covered by |
  |---|---|
  | §3 data model | Task 1 |
  | §4 content-core | Task 2 |
  | §5 adapters | Tasks 3–5 |
  | §6 sync and triggers | Task 6, plus the cron and webhook in Task 8 |
  | §7 activation | Task 7 |
  | §8 UI | Task 9 |
  | §9 routes | Task 8 |
  | §10 tests | in every task |
  | §12 open items | Task 10 |

- **Deviation from the spec, with ruling:** Contentful's image is mapped from a plain `fields.imageUrl` field. Resolving linked assets through `includes.Asset` is deferred, and clients can map their own URL field (Task 3 note).
