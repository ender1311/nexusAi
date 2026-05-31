# Verse-Push Title-Strategy Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bandit that converges to the best title strategy (reference / headline-a / headline-b / inverted) for a localized scripture push, with the verse rotating per recipient at send time.

**Architecture:** Four `MessageVariant` arms under one push `Message`. Each arm stores `body = VERSE_PUSH_SENTINEL` and `subcategory = <strategy>`; the cron resolves localized verse copy from the `CampaignContent` pool inside `groupDecisionsByVariant` (mirroring the existing `GIVING_LINK_SENTINEL` pattern). No schema migration; reuses bandit/reward/grouping/Braze/analytics untouched.

**Tech Stack:** TypeScript (strict, no `any`), Prisma v7 + Neon, bun test, Next.js App Router cron route.

**Spec:** `docs/superpowers/specs/2026-05-31-verse-push-title-strategy-experiment-design.md`

---

## File Structure

- `src/lib/verse-content.ts` (new) — pure: sentinel, strategy map, FNV-1a hash, verse-copy resolver. No I/O.
- `src/lib/cron/verse-pool.ts` (new) — I/O: load + shape the `CampaignContent` verse pool.
- `src/lib/youversion/verse-api.ts` (modify) — parse localized `reference.human`.
- `scripts/fetch-localized-verses.ts` (modify) — also upsert `reference` contentType rows.
- `src/app/api/campaign-content/route.ts` (modify) — accept `reference` contentType.
- `src/lib/cron/send-grouping.ts` (modify) — resolve verse copy for sentinel variants.
- `src/app/api/cron/select-and-send/route.ts` (modify) — preload pool + strategy map into `localization`.
- `scripts/create-verse-experiment.ts` (new) — generator for the agent/message/4 arms.
- Tests: `tests/unit/verse-content.test.ts`, `tests/unit/verse-pool.test.ts`, extend `tests/unit/youversion-verse-api.test.ts`, `tests/regression/verse-push-send-grouping.test.ts`.

---

## Task 1: Pure verse-content lib

**Files:**
- Create: `src/lib/verse-content.ts`
- Test: `tests/unit/verse-content.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/verse-content.test.ts
import { describe, it, expect } from "bun:test";
import {
  VERSE_PUSH_SENTINEL, VERSE_STRATEGY, isVerseStrategy, hashToIndex,
  pickVerse, resolveVerseCopy, type VerseEntry, type VersePool,
} from "@/lib/verse-content";

const entry = (usfm: string, byLang: Record<string, Record<string, string>>): VerseEntry => ({
  usfm,
  byLang: new Map(Object.entries(byLang).map(([k, v]) => [k, v])),
});

describe("isVerseStrategy", () => {
  it("accepts the four strategies, rejects others", () => {
    for (const s of ["reference", "headline-a", "headline-b", "inverted"]) expect(isVerseStrategy(s)).toBe(true);
    expect(isVerseStrategy("nope")).toBe(false);
    expect(isVerseStrategy(null)).toBe(false);
    expect(isVerseStrategy(undefined)).toBe(false);
  });
});

describe("hashToIndex", () => {
  it("is deterministic and bounded", () => {
    expect(hashToIndex("user-1:2026-05-31", 10)).toBe(hashToIndex("user-1:2026-05-31", 10));
    for (let i = 0; i < 50; i++) {
      const idx = hashToIndex(`u${i}:d`, 7);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(7);
    }
  });
  it("returns 0 for empty pool", () => {
    expect(hashToIndex("x", 0)).toBe(0);
  });
  it("changes with the date salt", () => {
    // Not guaranteed for every key, but true for this fixed pair (regression guard).
    expect(hashToIndex("user-1:2026-05-31", 100)).not.toBe(hashToIndex("user-1:2026-06-01", 100));
  });
});

describe("pickVerse", () => {
  it("returns null for an empty pool", () => {
    expect(pickVerse([], "u", "d")).toBeNull();
  });
  it("returns a deterministic entry from the pool", () => {
    const pool: VersePool = [entry("A", {}), entry("B", {}), entry("C", {})];
    const a = pickVerse(pool, "user-1", "2026-05-31");
    const b = pickVerse(pool, "user-1", "2026-05-31");
    expect(a).toBe(b);
    expect(pool).toContain(a!);
  });
});

describe("resolveVerseCopy", () => {
  const v = entry("JHN.3.16", {
    en: { reference: "John 3:16", "a-title": "God did something", "b-title": "Reflect on John 3:16", "verse-text": "For God so loved..." },
    es: { reference: "Juan 3:16", "verse-text": "Porque tanto amó Dios..." }, // no es a/b-title
  });

  it("reference arm: title=ref, body=verse-text, localized", () => {
    expect(resolveVerseCopy(v, "es", "reference")).toEqual({ title: "Juan 3:16", body: "Porque tanto amó Dios..." });
  });
  it("inverted arm: title=verse-text, body=ref", () => {
    expect(resolveVerseCopy(v, "es", "inverted")).toEqual({ title: "Porque tanto amó Dios...", body: "Juan 3:16" });
  });
  it("headline-a falls back to English title when language lacks it, keeps localized body", () => {
    expect(resolveVerseCopy(v, "es", "headline-a")).toEqual({ title: "God did something", body: "Porque tanto amó Dios..." });
  });
  it("unknown language falls back fully to English", () => {
    expect(resolveVerseCopy(v, "xx", "reference")).toEqual({ title: "John 3:16", body: "For God so loved..." });
  });
  it("null tag → English", () => {
    expect(resolveVerseCopy(v, null, "reference")).toEqual({ title: "John 3:16", body: "For God so loved..." });
  });
});

describe("constants", () => {
  it("sentinel is stable and strategy map covers four arms", () => {
    expect(VERSE_PUSH_SENTINEL).toBe("__NEXUS_VERSE_PUSH__");
    expect(Object.keys(VERSE_STRATEGY).sort()).toEqual(["headline-a", "headline-b", "inverted", "reference"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/verse-content.test.ts`
Expected: FAIL — module `@/lib/verse-content` not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/verse-content.ts
// Pure helpers for the verse-push title-strategy experiment. A MessageVariant
// whose body equals VERSE_PUSH_SENTINEL is a verse arm: its title/body are
// resolved at send time from the CampaignContent verse pool, per the strategy
// stored in MessageVariant.subcategory. No I/O.
import { normalizePushLocaleTag, type LocalizedCopy } from "@/lib/push-locale";

export const VERSE_PUSH_SENTINEL = "__NEXUS_VERSE_PUSH__";

export type VerseField = "reference" | "a-title" | "b-title" | "verse-text";
export type VerseStrategy = "reference" | "headline-a" | "headline-b" | "inverted";

export const VERSE_STRATEGY: Record<VerseStrategy, { title: VerseField; body: VerseField }> = {
  "reference":  { title: "reference",  body: "verse-text" },
  "headline-a": { title: "a-title",    body: "verse-text" },
  "headline-b": { title: "b-title",    body: "verse-text" },
  "inverted":   { title: "verse-text", body: "reference"  },
};

export function isVerseStrategy(s: string | null | undefined): s is VerseStrategy {
  return s === "reference" || s === "headline-a" || s === "headline-b" || s === "inverted";
}

export type VerseLangContent = Partial<Record<VerseField, string>>;
export type VerseEntry = { usfm: string; byLang: Map<string, VerseLangContent> };
export type VersePool = VerseEntry[];

/** FNV-1a 32-bit. Stable across processes/runs (unlike object identity hashing). */
export function hashToIndex(key: string, len: number): number {
  if (len <= 0) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % len;
}

/** Deterministically pick a verse for a user on a given date (rotates over time). */
export function pickVerse(pool: VersePool, userId: string, dateBucket: string): VerseEntry | null {
  if (pool.length === 0) return null;
  return pool[hashToIndex(`${userId}:${dateBucket}`, pool.length)];
}

/** Resolve {title, body} for a verse arm. Per-field English fallback, reusing
 *  the push-locale full/primary/en resolution rules. */
export function resolveVerseCopy(
  verse: VerseEntry,
  tag: string | null | undefined,
  strategy: VerseStrategy,
): LocalizedCopy {
  const en = verse.byLang.get("en") ?? {};
  let lang: VerseLangContent = en;
  const norm = tag ? normalizePushLocaleTag(tag) : null;
  if (norm) {
    const exact = verse.byLang.get(norm.full);
    const base = norm.primary !== "zh" ? verse.byLang.get(norm.primary) : undefined;
    lang = exact ?? base ?? en;
  }
  const { title: titleField, body: bodyField } = VERSE_STRATEGY[strategy];
  return {
    title: lang[titleField] ?? en[titleField] ?? null,
    body:  lang[bodyField]  ?? en[bodyField]  ?? "",
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/unit/verse-content.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/verse-content.ts tests/unit/verse-content.test.ts
git commit -m "feat(verse-push): pure verse-content resolver + strategy map"
```

---

## Task 2: Parse localized reference from the YouVersion API

**Files:**
- Modify: `src/lib/youversion/verse-api.ts`
- Test: `tests/unit/youversion-verse-api.test.ts`

- [ ] **Step 1: Add failing tests** (append to the existing file)

```ts
import { parseVerseRef, fetchVerse } from "@/lib/youversion/verse-api";

describe("parseVerseRef", () => {
  it("reads top-level data.reference.human", () => {
    const json = { response: { data: { reference: { human: "Juan 3:16" }, verses: [{ content: "x" }] } } };
    expect(parseVerseRef(json)).toBe("Juan 3:16");
  });
  it("falls back to the first verse's reference.human", () => {
    const json = { response: { data: { verses: [{ content: "x", reference: { human: "ヨハネ 3:16" } }] } } };
    expect(parseVerseRef(json)).toBe("ヨハネ 3:16");
  });
  it("returns null when no human reference is present", () => {
    expect(parseVerseRef({ response: { data: { verses: [{ content: "x" }] } } })).toBeNull();
    expect(parseVerseRef({})).toBeNull();
    expect(parseVerseRef(null)).toBeNull();
  });
});

describe("fetchVerse", () => {
  const okJson = (text: string, human: string) =>
    Promise.resolve(new Response(JSON.stringify({
      response: { data: { reference: { human }, verses: [{ content: text }] } },
    }), { status: 200 }));
  it("returns text + reference on 200", async () => {
    const stub = (() => okJson("Jesus wept.", "John 11:35")) as unknown as typeof fetch;
    expect(await fetchVerse("JHN.11.35", 111, stub)).toEqual({ text: "Jesus wept.", reference: "John 11:35" });
  });
  it("returns nulls on non-OK", async () => {
    const stub = (() => Promise.resolve(new Response("nope", { status: 404 }))) as unknown as typeof fetch;
    expect(await fetchVerse("JHN.11.35", 111, stub)).toEqual({ text: null, reference: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/youversion-verse-api.test.ts`
Expected: FAIL — `parseVerseRef` / `fetchVerse` not exported.

- [ ] **Step 3: Implement** (add to `src/lib/youversion/verse-api.ts`; extend the response type)

```ts
// extend the existing VerseApiResponse type:
type VerseApiResponse = {
  response?: {
    data?: {
      reference?: { human?: unknown };
      verses?: Array<{ content?: unknown; reference?: { human?: unknown } }>;
    };
  };
};

export type VerseResult = { text: string | null; reference: string | null };

/** Localized human reference ("Juan 3:16"). Prefers the range-level
 *  data.reference.human; falls back to the first verse's reference.human. */
export function parseVerseRef(json: unknown): string | null {
  const data = (json as VerseApiResponse)?.response?.data;
  const top = data?.reference?.human;
  if (typeof top === "string" && top.trim()) return top.trim();
  const first = data?.verses?.[0]?.reference?.human;
  if (typeof first === "string" && first.trim()) return first.trim();
  return null;
}

/** Fetch verse text + localized reference in one request. */
export async function fetchVerse(
  usfm: string,
  versionId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<VerseResult> {
  let res: Response;
  try {
    res = await fetchImpl(buildVerseUrl(usfm, versionId), {
      headers: YV_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return { text: null, reference: null };
  }
  if (!res.ok) return { text: null, reference: null };
  let json: unknown;
  try { json = await res.json(); } catch { return { text: null, reference: null }; }
  return { text: parseVerseText(json), reference: parseVerseRef(json) };
}
```

Leave `fetchVerseText` and `parseVerseText` unchanged (still used elsewhere / by existing tests).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/unit/youversion-verse-api.test.ts`
Expected: PASS (existing 11 + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/youversion/verse-api.ts tests/unit/youversion-verse-api.test.ts
git commit -m "feat(youversion): parse localized reference.human; add fetchVerse"
```

---

## Task 3: Accept `reference` contentType in the campaign-content API

**Files:**
- Modify: `src/app/api/campaign-content/route.ts`
- Test: `tests/integration/campaign-content.test.ts` (add a case if the file exists; otherwise create one using `tests/helpers/builders.ts`)

- [ ] **Step 1: Write the failing test** (POST a `reference` row with body, expect 201; POST without body expect 400)

```ts
// in tests/integration/campaign-content.test.ts
it("accepts a reference contentType with a body", async () => {
  const res = await POST(makeReq({
    campaign: "test-campaign", contentType: "reference", language: "es",
    usfmReference: "JHN.3.16", body: "Juan 3:16",
  }));
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.data.body).toBe("Juan 3:16");
});
it("rejects a reference contentType without a body", async () => {
  const res = await POST(makeReq({
    campaign: "test-campaign", contentType: "reference", language: "es", usfmReference: "JHN.3.16",
  }));
  expect(res.status).toBe(400);
});
```

(Follow the existing test's `makeReq`/import pattern; if none exists, model it on another route integration test and clean up created rows.)

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/integration/campaign-content.test.ts`
Expected: FAIL — `reference` rejected with 400 ("contentType must be...").

- [ ] **Step 3: Implement** — in `src/app/api/campaign-content/route.ts`:

Change line 5:
```ts
const VALID_CONTENT_TYPES = new Set(["a-title", "b-title", "verse-text", "reference"]);
```
Change the error string (line 51):
```ts
{ error: "contentType must be a-title, b-title, verse-text, or reference" },
```
Change the title/body branching (line 62) so `reference` is treated as a body type (like `verse-text`):
```ts
const isTitle = contentType === "a-title" || contentType === "b-title";
```
The existing `!isTitle` body-required check (lines 66-68) and the `create` data block (lines 78-79) then handle `reference` correctly (body required, title null). Update the body-required error string to mention reference:
```ts
return NextResponse.json({ error: "body is required for verse-text and reference" }, { status: 400 });
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/integration/campaign-content.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/campaign-content/route.ts tests/integration/campaign-content.test.ts
git commit -m "feat(api/campaign-content): accept reference contentType"
```

---

## Task 4: Backfill localized references via the fetcher

**Files:**
- Modify: `scripts/fetch-localized-verses.ts`

No unit test (it's a one-shot backfill script with `--commit`/dry-run, like its siblings). Verify via dry-run output.

- [ ] **Step 1: Implement** — switch the per-ref fetch from `fetchVerseText` to `fetchVerse`, and write BOTH a `verse-text` row (body=text) and a `reference` row (body=localized ref) when present.

Changes in `scripts/fetch-localized-verses.ts`:
- Import: `import { LANGUAGE_VERSION_MAP, fetchVerse } from "@/lib/youversion/verse-api";`
- Widen the write type:
```ts
type Upsert = { contentType: "verse-text" | "reference"; language: string; usfmReference: string; usfmHuman: string; body: string };
```
- In the per-ref worker, replace the `fetchVerseText` call:
```ts
const { text, reference } = await fetchVerse(ref.usfmReference, versionId);
if (!text && !reference) { stats.missing++; return; }
stats.fetched++;
if (text) toWrite.push({ contentType: "verse-text", language, usfmReference: ref.usfmReference, usfmHuman: ref.usfmHuman, body: text });
if (reference) toWrite.push({ contentType: "reference", language, usfmReference: ref.usfmReference, usfmHuman: ref.usfmHuman, body: reference });
```
- The existing-key skip must be per contentType. Change the preload query to load both types and key as `${contentType}\0${language}\0${usfmReference}`, and in the worker skip a (lang,ref) only when BOTH verse-text and reference already exist (unless `--force`). Simplest correct approach: track existing per type and only push the missing type:
```ts
// existing keys:
const existing = await prisma.campaignContent.findMany({
  where: { campaign, contentType: { in: ["verse-text", "reference"] } },
  select: { contentType: true, language: true, usfmReference: true },
});
const existingKeys = new Set(existing.map((e) => `${e.contentType} ${e.language} ${e.usfmReference}`));
const has = (ct: string, l: string, u: string) => existingKeys.has(`${ct} ${l} ${u}`);
```
In the worker, skip the whole fetch only when `!force && has("verse-text",...) && has("reference",...)`; otherwise fetch, and only push a row when `force || !has(type,...)`.
- In the `--commit` upsert block, use `w.contentType` instead of the hardcoded `"verse-text"` in both the `where` unique key and the `create` data.

- [ ] **Step 2: Dry-run to verify**

Run: `bun run scripts/fetch-localized-verses.ts --limit=3`
Expected: prints per-language counts; "DRY RUN — nothing written"; reports verse-text + reference rows would be written. NO `--commit` in this step.

- [ ] **Step 3: Commit**

```bash
git add scripts/fetch-localized-verses.ts
git commit -m "feat(scripts): backfill localized reference rows via fetchVerse"
```

> **Note for the controller:** running the actual `--commit` writes to the PRODUCTION DB. Do NOT run `--commit` during implementation — leave it for the user to run after review (it is a data backfill, not code).

---

## Task 5: Load + shape the verse pool

**Files:**
- Create: `src/lib/cron/verse-pool.ts`
- Test: `tests/unit/verse-pool.test.ts`

- [ ] **Step 1: Write the failing test** (pure shaping function takes raw rows, builds the pool)

```ts
// tests/unit/verse-pool.test.ts
import { describe, it, expect } from "bun:test";
import { shapeVersePool, type CampaignContentRow } from "@/lib/cron/verse-pool";

const rows: CampaignContentRow[] = [
  { contentType: "verse-text", language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "For God..." },
  { contentType: "a-title",    language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: "Clickbait", body: null },
  { contentType: "b-title",    language: "en", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: "Reflect", body: null },
  { contentType: "reference",  language: "es", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "Juan 3:16" },
  { contentType: "verse-text", language: "es", usfmReference: "JHN.3.16", usfmHuman: "John 3:16", title: null, body: "Porque..." },
  // ISA.1.1 only has verse-text in en — must be excluded (can't render a/b arms)
  { contentType: "verse-text", language: "en", usfmReference: "ISA.1.1", usfmHuman: "Isaiah 1:1", title: null, body: "Vision..." },
];

describe("shapeVersePool", () => {
  const pool = shapeVersePool(rows);

  it("includes only refs whose EN entry can render every arm", () => {
    expect(pool.map((e) => e.usfm)).toEqual(["JHN.3.16"]);
  });
  it("derives EN reference from usfmHuman when no reference row exists", () => {
    expect(pool[0].byLang.get("en")!.reference).toBe("John 3:16");
  });
  it("keeps localized fields (es reference + verse-text)", () => {
    const es = pool[0].byLang.get("es")!;
    expect(es.reference).toBe("Juan 3:16");
    expect(es["verse-text"]).toBe("Porque...");
  });
  it("maps a-title/b-title from the title column", () => {
    const en = pool[0].byLang.get("en")!;
    expect(en["a-title"]).toBe("Clickbait");
    expect(en["b-title"]).toBe("Reflect");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/unit/verse-pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/cron/verse-pool.ts
// Load + shape the CampaignContent verse pool for the verse-push experiment.
import { usfmToHuman, usfmSortKey } from "@/lib/usfm";
import type { VersePool, VerseEntry, VerseField, VerseLangContent } from "@/lib/verse-content";

const CAMPAIGN = "resurrection-push";
const CONTENT_TYPES = ["reference", "a-title", "b-title", "verse-text"] as const;

export type CampaignContentRow = {
  contentType: string;
  language: string;
  usfmReference: string;
  usfmHuman: string | null;
  title: string | null;
  body: string | null;
};

/** Pure: raw CampaignContent rows → ordered verse pool. EN must be able to
 *  render every arm (verse-text + a-title + b-title; reference is derivable). */
export function shapeVersePool(rows: CampaignContentRow[]): VersePool {
  const byUsfm = new Map<string, VerseEntry>();
  for (const r of rows) {
    const field = r.contentType as VerseField;
    if (!CONTENT_TYPES.includes(field as (typeof CONTENT_TYPES)[number])) continue;
    let e = byUsfm.get(r.usfmReference);
    if (!e) { e = { usfm: r.usfmReference, byLang: new Map() }; byUsfm.set(r.usfmReference, e); }
    let lc = e.byLang.get(r.language) as VerseLangContent | undefined;
    if (!lc) { lc = {}; e.byLang.set(r.language, lc); }
    const value = field === "a-title" || field === "b-title" ? r.title : r.body;
    if (value && value.trim()) lc[field] = value;
  }
  for (const e of byUsfm.values()) {
    const en = (e.byLang.get("en") ?? {}) as VerseLangContent;
    if (!en.reference) en.reference = usfmToHuman(e.usfm);
    e.byLang.set("en", en);
  }
  const pool = [...byUsfm.values()].filter((e) => {
    const en = e.byLang.get("en");
    return !!(en && en["verse-text"] && en["a-title"] && en["b-title"]);
  });
  pool.sort((a, b) => usfmSortKey(a.usfm).localeCompare(usfmSortKey(b.usfm)));
  return pool;
}

/** Load the active verse pool from the DB and shape it. */
export async function loadVersePool(prisma: typeof import("@/lib/db").prisma): Promise<VersePool> {
  const rows = await prisma.campaignContent.findMany({
    where: { campaign: CAMPAIGN, status: "active", contentType: { in: [...CONTENT_TYPES] } },
    select: { contentType: true, language: true, usfmReference: true, usfmHuman: true, title: true, body: true },
  });
  return shapeVersePool(rows);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/unit/verse-pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/verse-pool.ts tests/unit/verse-pool.test.ts
git commit -m "feat(verse-push): load + shape CampaignContent verse pool"
```

---

## Task 6: Resolve verse copy in send-grouping

**Files:**
- Modify: `src/lib/cron/send-grouping.ts`
- Test: `tests/regression/verse-push-send-grouping.test.ts`

- [ ] **Step 1: Write the failing regression test**

```ts
// tests/regression/verse-push-send-grouping.test.ts
// Regression for the verse-push title-strategy experiment:
// a VERSE_PUSH_SENTINEL variant resolves localized copy per language/strategy
// and batches users by resolved copy.
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import { VERSE_PUSH_SENTINEL, type VersePool } from "@/lib/verse-content";

const meta = new Map<string, VariantMeta>([
  ["v-ref", { channel: "push", body: VERSE_PUSH_SENTINEL, title: "[verse:reference]", deeplink: null, brazeCampaignId: null, brazeVariantId: null }],
]);

const pool: VersePool = [{
  usfm: "JHN.3.16",
  byLang: new Map<string, Record<string, string>>([
    ["en", { reference: "John 3:16", "a-title": "A", "b-title": "B", "verse-text": "For God..." }],
    ["es", { reference: "Juan 3:16", "verse-text": "Porque..." }],
  ]),
}];

const localization = {
  enabled: true,
  translationsByVariant: new Map(),
  versePool: pool,
  strategyByVariant: new Map([["v-ref", "reference" as const]]),
};

const at = new Date("2026-05-31T08:00:00Z");

function input(externalId: string, lang: string) {
  return { user: { externalId, brazeId: null, attributes: { language_tag: lang } }, variantId: "v-ref", scheduledAt: at, inLocalTime: false };
}

describe("verse-push send grouping", () => {
  it("resolves localized reference-arm copy per language", () => {
    const decById = new Map([["u-es", "d-es"], ["u-en", "d-en"]]);
    const groups = groupDecisionsByVariant([input("u-es", "es"), input("u-en", "en")], meta, decById, localization);
    const all = Object.values(groups);
    const es = all.find((g) => g.externalUserIds.includes("u-es"))!;
    const en = all.find((g) => g.externalUserIds.includes("u-en"))!;
    // single-verse pool → both see JHN.3.16, localized
    expect(es.body).toBe("Porque...");
    expect(es.title).toBe("Juan 3:16");
    expect(en.body).toBe("For God...");
    expect(en.title).toBe("John 3:16");
  });
  it("batches users sharing the same resolved copy", () => {
    const decById = new Map([["u-es1", "d1"], ["u-es2", "d2"]]);
    const groups = groupDecisionsByVariant([input("u-es1", "es"), input("u-es2", "es")], meta, decById, localization);
    // same verse + lang + strategy → one group
    expect(Object.values(groups).filter((g) => g.body === "Porque...").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/regression/verse-push-send-grouping.test.ts`
Expected: FAIL — `localization` type has no `versePool`/`strategyByVariant`; sentinel body sent verbatim.

- [ ] **Step 3: Implement** — in `src/lib/cron/send-grouping.ts`:

Add imports:
```ts
import { VERSE_PUSH_SENTINEL, pickVerse, resolveVerseCopy, type VersePool, type VerseStrategy } from "@/lib/verse-content";
```
Extend the `localization` param type in `groupDecisionsByVariant`'s signature:
```ts
localization?: {
  enabled: boolean;
  translationsByVariant: Map<string, Map<string, LocalizedCopy>>;
  versePool?: VersePool;
  strategyByVariant?: Map<string, VerseStrategy>;
},
```
Replace the copy-resolution block (current lines 67-86) with:
```ts
    // Verse-push arms (body sentinel): resolve a rotated, localized verse at send
    // time. Otherwise fall back to the standard translation path.
    const verseStrategy = localization?.strategyByVariant?.get(variantId);
    const isVerse = meta.body === VERSE_PUSH_SENTINEL && verseStrategy != null && localization?.versePool != null;
    let copy: LocalizedCopy = { title: meta.title, body: meta.body };
    const attrs = (user.attributes as Record<string, unknown>) ?? {};
    const tag = attrs.language_tag as string | undefined;
    if (isVerse) {
      const dateBucket = scheduledAt.toISOString().slice(0, 10);
      const verse = pickVerse(localization!.versePool!, user.externalId, dateBucket);
      if (verse) copy = resolveVerseCopy(verse, tag, verseStrategy!);
    } else if (localization?.enabled && meta.channel === "push") {
      copy = resolvePushLocale(
        tag,
        localization.translationsByVariant.get(variantId) ?? new Map(),
        { title: meta.title, body: meta.body },
      );
    }

    const groupInLocalTime = isFallback;
    const baseKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:${resolvedDeeplink ?? ""}`;
    // Key by resolved copy whenever copy was resolved per-user (localized push or
    // verse arm), so users sharing a payload batch together.   = NUL separator.
    const copyKeyed = meta.channel === "push" && (isVerse || (localization?.enabled ?? false));
    const groupKey = copyKeyed ? `${baseKey}:${copy.title ?? ""} ${copy.body}` : baseKey;
```

(Everything below — the `byVariant[groupKey]` construction using `copy.body`/`copy.title` — is unchanged.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/regression/verse-push-send-grouping.test.ts`
Expected: PASS. Also run `bun test tests/unit/` to confirm no existing send-grouping test regressed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/regression/verse-push-send-grouping.test.ts
git commit -m "feat(cron): resolve localized verse copy for sentinel variants"
```

---

## Task 7: Wire the verse pool into the cron route

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`

No new test (covered by Task 6's grouping regression + existing cron integration tests). Verify via typecheck + existing cron tests.

- [ ] **Step 1: Implement** — in `src/app/api/cron/select-and-send/route.ts`:

Add imports near the top (with the other `@/lib` imports):
```ts
import { VERSE_PUSH_SENTINEL, isVerseStrategy, type VersePool, type VerseStrategy } from "@/lib/verse-content";
import { loadVersePool } from "@/lib/cron/verse-pool";
```
After the `translationsByVariant` block (right before line 451 `const localization = ...`), build the strategy map + pool:
```ts
    // Verse-push experiment: variants flagged with VERSE_PUSH_SENTINEL resolve
    // their copy from the CampaignContent verse pool at send time.
    const strategyByVariant = new Map<string, VerseStrategy>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        if (v.body === VERSE_PUSH_SENTINEL && isVerseStrategy(v.subcategory)) {
          strategyByVariant.set(v.id, v.subcategory);
        }
      }
    }
    let versePool: VersePool | undefined;
    if (strategyByVariant.size > 0) versePool = await loadVersePool(prisma);
```
Change the `localization` object (line 451) to include them:
```ts
    const localization = { enabled: localizeEnabled, translationsByVariant, versePool, strategyByVariant };
```
Both `groupDecisionsByVariant(... , localization)` call sites (≈ lines 879, 1227) already pass `localization` — no change needed there.

Note: the variant query that builds `agent.messages[].variants` must already select `subcategory` and `body` (it selects full variant rows via `m.variants`). Confirm `v.subcategory` is present on the loaded variants; if the query uses an explicit `select`, add `subcategory: true`. (The `variantMeta` build at line 406 iterates `msg.variants`, so the relation is loaded — verify the select includes `subcategory`.)

- [ ] **Step 2: Run typecheck + cron tests**

Run: `bun run typecheck && bun test tests/integration/ -t "select-and-send"` (or the cron integration test file name).
Expected: PASS, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts
git commit -m "feat(cron): preload verse pool + strategy map for verse-push agents"
```

---

## Task 8: Generator script for the experiment agent

**Files:**
- Create: `scripts/create-verse-experiment.ts`

No unit test (one-shot generator, dry-run default like siblings). Verify via dry-run.

- [ ] **Step 1: Implement**

```ts
// scripts/create-verse-experiment.ts
// Create the "Resurrection Verse Push" experiment: one push Message with four
// title-strategy arms (reference / headline-a / headline-b / inverted). Each arm
// is a MessageVariant whose body is VERSE_PUSH_SENTINEL; the cron resolves a
// rotated, localized verse at send time. Dry-run by default; pass --commit.
//
// prisma here targets .env.local (production) per CLAUDE.md — review the dry run.
import { prisma } from "@/lib/db";
import { VERSE_PUSH_SENTINEL, VERSE_STRATEGY, type VerseStrategy } from "@/lib/verse-content";

const ARMS: Array<{ strategy: VerseStrategy; name: string; title: string }> = [
  { strategy: "reference",  name: "Reference title",      title: "[verse:reference]" },
  { strategy: "headline-a", name: "Headline A (clickbait)", title: "[verse:a-title]" },
  { strategy: "headline-b", name: "Headline B (ref sentence)", title: "[verse:b-title]" },
  { strategy: "inverted",   name: "Inverted (text in title)", title: "[verse:inverted]" },
];

async function main() {
  const doCommit = process.argv.includes("--commit");
  console.log(`Verse-push experiment — ${doCommit ? "COMMIT" : "DRY RUN"}`);
  for (const a of ARMS) {
    console.log(`  arm ${a.strategy.padEnd(11)} title="${a.title}" body=${VERSE_PUSH_SENTINEL} ` +
      `(title<-${VERSE_STRATEGY[a.strategy].title}, body<-${VERSE_STRATEGY[a.strategy].body})`);
  }
  if (!doCommit) { console.log("\nDRY RUN — nothing written. Re-run with --commit."); return; }

  const agent = await prisma.agent.create({
    data: { name: "Resurrection Verse Push", description: "Title-strategy experiment over localized scripture verses.",
      status: "draft", algorithm: "thompson", localizePush: true },
  });
  const message = await prisma.message.create({
    data: { agentId: agent.id, name: "Resurrection Verse", channel: "push" },
  });
  for (const a of ARMS) {
    await prisma.messageVariant.create({
      data: { messageId: message.id, name: a.name, body: VERSE_PUSH_SENTINEL, title: a.title,
        status: "active", category: "verse-experiment", subcategory: a.strategy },
    });
  }
  console.log(`\nCreated agent ${agent.id} (draft), message ${message.id}, ${ARMS.length} arms.`);
  console.log("Activate + set targeting in the UI before launching.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Dry-run to verify**

Run: `bun run scripts/create-verse-experiment.ts`
Expected: prints the four arms + "DRY RUN — nothing written". (Do NOT `--commit` during implementation — leave for the user.)

- [ ] **Step 3: Commit**

```bash
git add scripts/create-verse-experiment.ts
git commit -m "feat(scripts): generator for the verse-push title-strategy experiment"
```

---

## Final verification

- [ ] Run `bun run check` (typecheck + lint + full test suite). Expected: green.
- [ ] Confirm no `--commit` was run against production during implementation (Tasks 4 and 8 are user-run).
- [ ] Dispatch a final code review over the whole branch diff.
