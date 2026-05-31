# Push Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each English push `MessageVariant` carries localized strings; the cron picks the right localized title/body per recipient's `language_tag`, falling back to English, opt-in per agent via `Agent.localizePush`.

**Architecture:** A new `MessageVariantTranslation` child table holds per-language copy. A pure resolver (`src/lib/push-locale.ts`) maps a recipient `language_tag` → localized copy. The send-path localizes at batch-grouping time by extending the existing `groupDecisionsByVariant` key with the resolved language. One pure importer (`src/lib/push-import/`) powers both UI folder-upload and the 2025/2026 Dropbox backfill. Bandit selection and reward logic are unchanged — localization happens after variant selection, at payload build.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma v7 + PostgreSQL (Neon HTTP adapter), shadcn/ui, bun test runner.

**Spec:** `docs/superpowers/specs/2026-05-30-push-localization-design.md`

**Branch:** `feat/push-localization` (already checked out; spec committed).

---

## File Structure

**New files:**
- `src/lib/push-locale.ts` — pure language resolver (`resolvePushLocale`, `normalizePushLocaleTag`)
- `src/lib/push-import/types.ts` — shared importer types
- `src/lib/push-import/parse.ts` — parse `<stem>-<lang>.{json,yml}` filenames + file contents
- `src/lib/push-import/group.ts` — group parsed files by stem
- `src/lib/push-import/plan.ts` — match stems → variants, produce dry-run plan (pure)
- `src/lib/push-import/commit.ts` — upsert translation rows (only DB-touching stage)
- `src/lib/push-import/index.ts` — barrel re-export
- `src/app/api/push-translations/import/route.ts` — multipart upload endpoint (dry-run + commit)
- `src/components/messages/push-translation-upload.tsx` — folder-upload UI (client)
- `src/components/messages/language-coverage-badge.tsx` — coverage badge (server-friendly)
- `scripts/apply-message-variant-translation-to-test-db.ts` — test-DB schema apply
- `scripts/import-push-translations.ts` — 2025/2026 backfill (dry-run default)
- Tests: `tests/unit/push-locale.test.ts`, `tests/unit/push-import-parse.test.ts`, `tests/unit/push-import-group.test.ts`, `tests/unit/push-import-plan.test.ts`, `tests/unit/send-grouping-localization.test.ts`, `tests/integration/push-translations-import.test.ts`, `tests/regression/cron-push-localization.test.ts`
- Fixtures: `tests/fixtures/push-import/` (real-file-shaped JSON + a YAML)

**Modified files:**
- `prisma/schema.prisma` — add `Agent.localizePush`, `MessageVariantTranslation` model, `MessageVariant.translations` back-relation
- `src/lib/cron/send-grouping.ts` — extend group key + localized body/title
- `src/app/api/cron/select-and-send/route.ts` — load translations, skip EN-force when `localizePush`, pass to both grouping call sites
- `tests/helpers/builders.ts` — `createVariantTranslation` + `localizePush` on `createAgent`

---

## Task 1: Schema — `MessageVariantTranslation` + `Agent.localizePush`

**Files:**
- Modify: `prisma/schema.prisma` (Agent model ~line 30; MessageVariant model lines 81-114)
- Create: `scripts/apply-message-variant-translation-to-test-db.ts`

- [ ] **Step 1: Add `localizePush` to the Agent model**

In `prisma/schema.prisma`, after the `languageFilter` line (line 30) inside `model Agent`, add:

```prisma
  localizePush     Boolean     @default(false) // opt-in; OFF = today's EN-only push behavior
```

- [ ] **Step 2: Add the `translations` back-relation to MessageVariant**

In `model MessageVariant`, in the relations block (after line 110 `decisions UserDecision[]`), add:

```prisma
  translations   MessageVariantTranslation[]
```

- [ ] **Step 3: Add the `MessageVariantTranslation` model**

Immediately after the `MessageVariant` model's closing brace (after line 114), add:

```prisma
model MessageVariantTranslation {
  id                String   @id @default(cuid())
  messageVariantId  String
  language          String   // canonical code: es, pt, fr, zh_CN, zh_TW, ... (never "en")
  title             String?
  body              String
  bodyPersonal      String?  // push_message_personal — stored for future personalization wiring
  status            String   @default("active")
  source            String?  // "import:dropbox" | "upload" | "manual"
  sourceFile        String?  // provenance for audit / re-import
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  variant MessageVariant @relation(fields: [messageVariantId], references: [id], onDelete: Cascade)

  @@unique([messageVariantId, language])
  @@index([messageVariantId, status])
}
```

- [ ] **Step 4: Generate the client + create the prod migration**

Run: `npx prisma migrate dev --name add_message_variant_translation`
Expected: migration file created under `prisma/migrations/`, applied to the prod DB (per CLAUDE.md, `prisma.config.ts` → `.env.local` = production), Prisma client regenerated. Confirm output ends with "Your database is now in sync with your schema."

- [ ] **Step 5: Write the test-DB apply script**

Create `scripts/apply-message-variant-translation-to-test-db.ts` (mirrors `scripts/apply-userpreference-to-test-db.ts` — same endpoint guards):

```ts
// One-off: apply MessageVariantTranslation + Agent.localizePush to the TEST database only.
//
// prisma migrate/db push target .env.local (production) in this repo, so the test
// DB schema is maintained out-of-band. This reads the connection string straight
// from .env.test, hard-refuses the known production endpoint, and runs idempotent
// DDL matching the committed migration. Safe to run repeatedly.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const PROD_ENDPOINT = "ep-old-surf-a4p5os6s";
const TEST_ENDPOINT = "ep-cold-dawn-anok51q1";

function readEnvTest(key: string): string | undefined {
  const text = readFileSync(new URL("../.env.test", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnvTest("DATABASE_URL_UNPOOLED") ?? readEnvTest("DATABASE_URL");
if (!url) throw new Error("No DATABASE_URL(_UNPOOLED) found in .env.test");
if (url.includes(PROD_ENDPOINT)) throw new Error(`SAFETY ABORT: .env.test points at production endpoint ${PROD_ENDPOINT}`);
if (!url.includes(TEST_ENDPOINT)) throw new Error(`SAFETY ABORT: expected test endpoint ${TEST_ENDPOINT}, refusing unknown DB`);

const sql = neon(url);

await sql`ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "localizePush" BOOLEAN NOT NULL DEFAULT false`;

await sql`
  CREATE TABLE IF NOT EXISTS "MessageVariantTranslation" (
    "id" TEXT NOT NULL,
    "messageVariantId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "bodyPersonal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageVariantTranslation_pkey" PRIMARY KEY ("id")
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_language_key" ON "MessageVariantTranslation"("messageVariantId", "language")`;
await sql`CREATE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_status_idx" ON "MessageVariantTranslation"("messageVariantId", "status")`;
// FK with cascade delete (idempotent: drop-if-exists then add)
await sql`ALTER TABLE "MessageVariantTranslation" DROP CONSTRAINT IF EXISTS "MessageVariantTranslation_messageVariantId_fkey"`;
await sql`ALTER TABLE "MessageVariantTranslation" ADD CONSTRAINT "MessageVariantTranslation_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "MessageVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE`;

const rows = await sql`SELECT to_regclass('public."MessageVariantTranslation"') AS tbl`;
console.log("MessageVariantTranslation present on test DB:", rows[0]?.tbl);
const col = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'Agent' AND column_name = 'localizePush'`;
console.log("Agent.localizePush present on test DB:", col.length === 1);
```

- [ ] **Step 6: Apply to test DB**

Run: `bun run scripts/apply-message-variant-translation-to-test-db.ts`
Expected: prints `MessageVariantTranslation present on test DB: MessageVariantTranslation` and `Agent.localizePush present on test DB: true`.

- [ ] **Step 7: Extend test builders**

In `tests/helpers/builders.ts`:

Add `localizePush?: boolean;` to the `createAgent` overrides type (after `segmentTargeting`), and since it has no special JSON handling it flows through `...rest` automatically (it's not destructured out). Confirm `localizePush` is NOT in the destructure on line 15 — leave it in `rest`.

Append a new builder at the end of the file:

```ts
export async function createVariantTranslation(
  messageVariantId: string,
  overrides: {
    language?: string;
    title?: string | null;
    body?: string;
    bodyPersonal?: string | null;
    status?: string;
    source?: string | null;
    sourceFile?: string | null;
  } = {}
) {
  return prisma.messageVariantTranslation.create({
    data: {
      messageVariantId,
      language: "es",
      body: "Cuerpo de prueba",
      title: "Título de prueba",
      status: "active",
      ...overrides,
    },
  });
}
```

- [ ] **Step 8: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS (Prisma client now knows `messageVariantTranslation` and `Agent.localizePush`).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations scripts/apply-message-variant-translation-to-test-db.ts tests/helpers/builders.ts
git commit -m "feat(db): add MessageVariantTranslation + Agent.localizePush

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: `src/lib/push-locale.ts` — pure language resolver

**Files:**
- Create: `src/lib/push-locale.ts`
- Test: `tests/unit/push-locale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/push-locale.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { resolvePushLocale, normalizePushLocaleTag } from "@/lib/push-locale";

const en = { title: "Build your Bible habit!", body: "take a moment in God's Word today." };
const es = { title: "Construye tu hábito", body: "tómate un momento hoy." };
const ptBR = { title: "Crie seu hábito", body: "reserve um momento hoje." };
const zhTW = { title: "建立習慣", body: "今天花點時間。" };
const zhCN = { title: "建立习惯", body: "今天花点时间。" };

function map(entries: Record<string, { title: string | null; body: string }>) {
  return new Map(Object.entries(entries));
}

describe("normalizePushLocaleTag", () => {
  it("lowercases primary, uppercases region", () => {
    expect(normalizePushLocaleTag("ES")).toEqual({ full: "es", primary: "es" });
    expect(normalizePushLocaleTag("es-es")).toEqual({ full: "es_ES", primary: "es" });
    expect(normalizePushLocaleTag("pt_BR")).toEqual({ full: "pt_BR", primary: "pt" });
  });
  it("canonicalizes Chinese scripts", () => {
    expect(normalizePushLocaleTag("zh_tw")).toEqual({ full: "zh_TW", primary: "zh" });
    expect(normalizePushLocaleTag("zh-CN")).toEqual({ full: "zh_CN", primary: "zh" });
    expect(normalizePushLocaleTag("zh_hk")).toEqual({ full: "zh_HK", primary: "zh" });
  });
  it("returns null for blank/garbage", () => {
    expect(normalizePushLocaleTag("")).toBeNull();
    expect(normalizePushLocaleTag("   ")).toBeNull();
  });
});

describe("resolvePushLocale", () => {
  it("exact full-tag match wins", () => {
    expect(resolvePushLocale("pt_BR", map({ pt_BR: ptBR, pt: { title: "x", body: "y" } }), en)).toEqual(ptBR);
  });
  it("base-subtag match when no exact", () => {
    expect(resolvePushLocale("es_ES", map({ es }), en)).toEqual(es);
    expect(resolvePushLocale("es", map({ es }), en)).toEqual(es);
  });
  it("keeps zh scripts distinct", () => {
    expect(resolvePushLocale("zh_TW", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(zhTW);
    expect(resolvePushLocale("zh_CN", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(zhCN);
  });
  it("bare zh with no exact row falls through to English (never picks a script)", () => {
    expect(resolvePushLocale("zh", map({ zh_TW: zhTW, zh_CN: zhCN }), en)).toEqual(en);
  });
  it("English fallback when language missing or absent", () => {
    expect(resolvePushLocale("fr", map({ es }), en)).toEqual(en);
    expect(resolvePushLocale(null, map({ es }), en)).toEqual(en);
    expect(resolvePushLocale(undefined, map({ es }), en)).toEqual(en);
    expect(resolvePushLocale("  ", map({ es }), en)).toEqual(en);
  });
  it("English recipients get English (no en row stored)", () => {
    expect(resolvePushLocale("en_US", map({ es }), en)).toEqual(en);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-locale.test.ts`
Expected: FAIL — `Cannot find module '@/lib/push-locale'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/push-locale.ts`:

```ts
// Pure push-localization resolver. Maps a recipient language_tag to localized
// copy from a per-language translation map, with English fallback. No I/O.
//
// Storage convention: translation rows use canonical codes (es, pt, fr, zh_CN,
// zh_TW, ...). English text lives on the MessageVariant itself — there is NO "en"
// translation row, so English recipients always resolve via the fallback.

export type LocalizedCopy = { title: string | null; body: string };

const CHINESE_SCRIPTS: Record<string, string> = { cn: "CN", tw: "TW", hk: "HK" };

/**
 * Normalize a raw language_tag to a canonical full tag + primary subtag.
 * - trims, splits on "_" or "-"
 * - lowercases the primary subtag
 * - uppercases a region subtag (es-es → es_ES)
 * - canonicalizes Chinese scripts (zh_tw → zh_TW); unknown zh subtag → bare "zh"
 * Returns null for blank input.
 */
export function normalizePushLocaleTag(raw: string): { full: string; primary: string } | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/[_-]/).filter(Boolean);
  if (parts.length === 0) return null;
  const primary = parts[0].toLowerCase();
  if (parts.length === 1) return { full: primary, primary };
  const sub = parts[1];
  if (primary === "zh") {
    const script = CHINESE_SCRIPTS[sub.toLowerCase()];
    return script ? { full: `zh_${script}`, primary } : { full: "zh", primary };
  }
  return { full: `${primary}_${sub.toUpperCase()}`, primary };
}

/**
 * Resolve localized copy for a recipient:
 *   1. exact full-tag match (es_ES, zh_TW)
 *   2. base-subtag match (es_ES → es) — skipped for zh so scripts never collapse
 *   3. English fallback (always available from the variant)
 */
export function resolvePushLocale(
  tag: string | null | undefined,
  translationsByLang: Map<string, LocalizedCopy>,
  englishVariant: { title: string | null; body: string },
): LocalizedCopy {
  const english: LocalizedCopy = { title: englishVariant.title, body: englishVariant.body };
  if (!tag) return english;
  const norm = normalizePushLocaleTag(tag);
  if (!norm) return english;

  const exact = translationsByLang.get(norm.full);
  if (exact) return exact;

  if (norm.primary !== "zh") {
    const base = translationsByLang.get(norm.primary);
    if (base) return base;
  }
  return english;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/push-locale.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/push-locale.ts tests/unit/push-locale.test.ts
git commit -m "feat(push-locale): pure language resolver with zh-script-distinct fallback

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: `src/lib/push-import/` — types + filename/content parse

**Files:**
- Create: `src/lib/push-import/types.ts`
- Create: `src/lib/push-import/parse.ts`
- Test: `tests/unit/push-import-parse.test.ts`
- Create fixtures under: `tests/fixtures/push-import/`

- [ ] **Step 1: Create fixtures (real-file-shaped)**

Create `tests/fixtures/push-import/2026-01-daily-remind-PUSH-1-en.json`:

```json
{
  "push_title": "Build your Bible habit!",
  "push_message_personal": "${NAME}, take a moment to spend time in God's Word today.",
  "push_message_non_personal": "take a moment to spend time in God's Word today.",
  "push_deeplink": "https://www.bible.com/today"
}
```

Create `tests/fixtures/push-import/2026-01-daily-remind-PUSH-1-es.json`:

```json
{
  "push_title": "¡Crea tu hábito bíblico!",
  "push_message_personal": "${NAME}, tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
  "push_message_non_personal": "tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
  "push_deeplink": "https://www.bible.com/today"
}
```

Create `tests/fixtures/push-import/2026-01-daily-remind-PUSH-1-zh_TW.json`:

```json
{
  "push_title": "建立你的讀經習慣！",
  "push_message_personal": "${NAME}，今天花點時間親近神的話語。",
  "push_message_non_personal": "今天花點時間親近神的話語。",
  "push_deeplink": "https://www.bible.com/today"
}
```

Create `tests/fixtures/push-import/resurrection-verse-PUSH-1-fr.yml` (older verse-campaign shape):

```yaml
push_title: "Il est ressuscité"
push_message_non_personal: "Célébrez la résurrection aujourd'hui."
push_deeplink: "https://www.bible.com/verse"
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/push-import-parse.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseFilename, parseFileContents } from "@/lib/push-import/parse";

function fixture(name: string) {
  return readFileSync(new URL(`../fixtures/push-import/${name}`, import.meta.url), "utf8");
}

describe("parseFilename", () => {
  it("splits stem and lang on the last hyphen (preserves hyphens in stem)", () => {
    expect(parseFilename("2026-01-daily-remind-PUSH-1-en.json")).toEqual({
      stem: "2026-01-daily-remind-PUSH-1", language: "en",
    });
  });
  it("keeps underscore lang codes intact", () => {
    expect(parseFilename("2026-01-daily-remind-PUSH-1-zh_TW.json")).toEqual({
      stem: "2026-01-daily-remind-PUSH-1", language: "zh_TW",
    });
  });
  it("canonicalizes lang casing (es-ES style not expected in filenames, but lowercase regions normalized)", () => {
    expect(parseFilename("foo-bar-pt_br.json")).toEqual({ stem: "foo-bar", language: "pt_BR" });
  });
  it("handles .yml extension", () => {
    expect(parseFilename("resurrection-verse-PUSH-1-fr.yml")).toEqual({
      stem: "resurrection-verse-PUSH-1", language: "fr",
    });
  });
  it("returns null for unsupported extension or no lang suffix", () => {
    expect(parseFilename("schedule.md")).toBeNull();
    expect(parseFilename("combined/liquid_title.html")).toBeNull();
    expect(parseFilename("nohyphen.json")).toBeNull();
  });
  it("returns null when the trailing token is not a language code", () => {
    expect(parseFilename("2026-01-reward-remind-PUSH-1.json")).toBeNull();
  });
});

describe("parseFileContents", () => {
  it("maps JSON keys to copy", () => {
    expect(parseFileContents(fixture("2026-01-daily-remind-PUSH-1-es.json"), "json")).toEqual({
      title: "¡Crea tu hábito bíblico!",
      body: "tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
      bodyPersonal: "${NAME}, tómate un momento para pasar tiempo en la Palabra de Dios hoy.",
    });
  });
  it("falls back to personal body when non_personal is absent", () => {
    const copy = parseFileContents(JSON.stringify({ push_title: "T", push_message_personal: "${NAME} hi" }), "json");
    expect(copy).toEqual({ title: "T", body: "${NAME} hi", bodyPersonal: "${NAME} hi" });
  });
  it("parses YAML", () => {
    expect(parseFileContents(fixture("resurrection-verse-PUSH-1-fr.yml"), "yml")).toEqual({
      title: "Il est ressuscité",
      body: "Célébrez la résurrection aujourd'hui.",
      bodyPersonal: null,
    });
  });
  it("returns null when no usable body", () => {
    expect(parseFileContents(JSON.stringify({ push_title: "only title" }), "json")).toBeNull();
    expect(parseFileContents("not json", "json")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/push-import-parse.test.ts`
Expected: FAIL — `Cannot find module '@/lib/push-import/parse'`.

- [ ] **Step 4: Write types**

Create `src/lib/push-import/types.ts`:

```ts
// Shared types for the push-translation importer. The parse/group/plan stages are
// pure; only commit touches the DB.

export type ParsedFilename = { stem: string; language: string };

export type ParsedCopy = { title: string | null; body: string; bodyPersonal: string | null };

export type ImportFile = { relativePath: string; contents: string };

/** One logical push (all languages for a single stem). */
export type GroupedPush = {
  stem: string;
  byLang: Map<string, ParsedCopy>; // canonical lang code → copy (includes "en" anchor)
};

export type PerLanguagePlan = {
  language: string;       // canonical code
  action: "create" | "update" | "noop";
  title: string | null;
  body: string;
  bodyPersonal: string | null;
};

export type StemPlan =
  | {
      stem: string;
      matched: true;
      messageVariantId: string;
      variantName: string;
      languages: PerLanguagePlan[];
      englishDivergence: { incoming: string; current: string } | null; // body diff vs variant.body
    }
  | {
      stem: string;
      matched: false;
      languages: string[]; // languages present for the unmatched stem (informational)
    };

export type ImportPlan = {
  matched: Extract<StemPlan, { matched: true }>[];
  unmatched: Extract<StemPlan, { matched: false }>[];
  totals: { stems: number; matchedStems: number; unmatchedStems: number; creates: number; updates: number; noops: number };
};
```

- [ ] **Step 5: Write parse.ts**

Create `src/lib/push-import/parse.ts`:

```ts
import { load as parseYaml } from "js-yaml";
import { normalizePushLocaleTag } from "@/lib/push-locale";
import type { ParsedFilename, ParsedCopy } from "./types";

const LANG_TOKEN = /^[a-z]{2,3}(_[a-z]{2,4})?$/i;

/**
 * Parse `<stem>-<lang>.{json,yml,yaml}` into { stem, canonical language }.
 * Splits on the LAST hyphen so hyphens inside the stem survive. Returns null when
 * the extension is unsupported, there is no hyphen, or the trailing token is not a
 * language code.
 */
export function parseFilename(relativePath: string): ParsedFilename | null {
  const base = relativePath.split("/").pop() ?? relativePath;
  const extMatch = base.match(/\.(json|ya?ml)$/i);
  if (!extMatch) return null;
  const nameNoExt = base.slice(0, base.length - extMatch[0].length);
  const lastDash = nameNoExt.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const stem = nameNoExt.slice(0, lastDash);
  const langRaw = nameNoExt.slice(lastDash + 1);
  if (!LANG_TOKEN.test(langRaw)) return null;
  const norm = normalizePushLocaleTag(langRaw);
  if (!norm) return null;
  return { stem, language: norm.full };
}

export function fileKind(relativePath: string): "json" | "yml" | null {
  if (/\.json$/i.test(relativePath)) return "json";
  if (/\.ya?ml$/i.test(relativePath)) return "yml";
  return null;
}

/**
 * Map a translation file's contents to copy. body prefers push_message_non_personal
 * (tokenless — Nexus sends plain strings, no Liquid layer), falling back to
 * push_message_personal. Returns null when contents are unparseable or have no body.
 */
export function parseFileContents(contents: string, kind: "json" | "yml"): ParsedCopy | null {
  let obj: unknown;
  try {
    obj = kind === "json" ? JSON.parse(contents) : parseYaml(contents);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  const title = str(rec.push_title);
  const nonPersonal = str(rec.push_message_non_personal);
  const personal = str(rec.push_message_personal);
  const body = nonPersonal ?? personal;
  if (!body) return null;
  return { title, body, bodyPersonal: personal };
}
```

- [ ] **Step 6: Verify the `js-yaml` package is available**

Run: `node -e "require.resolve('js-yaml')" && echo OK`
Expected: `OK`. `js-yaml` is already a dependency (used by the seed scripts), so no install is needed. `load()` returns `unknown`, which the `typeof obj !== "object"` guard already handles.

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test tests/unit/push-import-parse.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/push-import/types.ts src/lib/push-import/parse.ts tests/unit/push-import-parse.test.ts tests/fixtures/push-import package.json bun.lock
git commit -m "feat(push-import): filename + content parse with canonical lang codes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `src/lib/push-import/group.ts` — group files by stem

**Files:**
- Create: `src/lib/push-import/group.ts`
- Test: `tests/unit/push-import-group.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/push-import-group.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { groupImportFiles } from "@/lib/push-import/group";
import type { ImportFile } from "@/lib/push-import/types";

function f(name: string): ImportFile {
  return { relativePath: name, contents: readFileSync(new URL(`../fixtures/push-import/${name}`, import.meta.url), "utf8") };
}

describe("groupImportFiles", () => {
  it("groups files of one stem across languages", () => {
    const { groups, skipped } = groupImportFiles([
      f("2026-01-daily-remind-PUSH-1-en.json"),
      f("2026-01-daily-remind-PUSH-1-es.json"),
      f("2026-01-daily-remind-PUSH-1-zh_TW.json"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe("2026-01-daily-remind-PUSH-1");
    expect([...groups[0].byLang.keys()].sort()).toEqual(["en", "es", "zh_TW"]);
    expect(groups[0].byLang.get("es")?.body).toContain("tómate un momento");
    expect(skipped).toHaveLength(0);
  });

  it("skips non-translation files and unparseable contents", () => {
    const { groups, skipped } = groupImportFiles([
      { relativePath: "combined/liquid_title.html", contents: "<x>" },
      { relativePath: "schedule.md", contents: "# notes" },
      { relativePath: "foo-bar-es.json", contents: "not json" },
    ]);
    expect(groups).toHaveLength(0);
    expect(skipped.map((s) => s.relativePath).sort()).toEqual([
      "combined/liquid_title.html", "foo-bar-es.json", "schedule.md",
    ]);
  });

  it("last file wins on duplicate (stem, lang)", () => {
    const { groups } = groupImportFiles([
      { relativePath: "x-es.json", contents: JSON.stringify({ push_message_non_personal: "first" }) },
      { relativePath: "x-es.json", contents: JSON.stringify({ push_message_non_personal: "second" }) },
    ]);
    expect(groups[0].byLang.get("es")?.body).toBe("second");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-import-group.test.ts`
Expected: FAIL — `Cannot find module '@/lib/push-import/group'`.

- [ ] **Step 3: Write group.ts**

Create `src/lib/push-import/group.ts`:

```ts
import { parseFilename, parseFileContents, fileKind } from "./parse";
import type { ImportFile, GroupedPush } from "./types";

export type SkippedFile = { relativePath: string; reason: string };

/**
 * Group a flat list of files into one GroupedPush per stem. Files that aren't
 * `<stem>-<lang>.{json,yml}` or whose contents don't parse are reported as skipped.
 */
export function groupImportFiles(files: ImportFile[]): { groups: GroupedPush[]; skipped: SkippedFile[] } {
  const byStem = new Map<string, GroupedPush>();
  const skipped: SkippedFile[] = [];

  for (const file of files) {
    const parsed = parseFilename(file.relativePath);
    if (!parsed) {
      skipped.push({ relativePath: file.relativePath, reason: "not a <stem>-<lang> translation file" });
      continue;
    }
    const kind = fileKind(file.relativePath);
    if (!kind) {
      skipped.push({ relativePath: file.relativePath, reason: "unsupported extension" });
      continue;
    }
    const copy = parseFileContents(file.contents, kind);
    if (!copy) {
      skipped.push({ relativePath: file.relativePath, reason: "unparseable or empty body" });
      continue;
    }
    let group = byStem.get(parsed.stem);
    if (!group) {
      group = { stem: parsed.stem, byLang: new Map() };
      byStem.set(parsed.stem, group);
    }
    group.byLang.set(parsed.language, copy); // last write wins on duplicate (stem, lang)
  }

  return { groups: [...byStem.values()], skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/push-import-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/push-import/group.ts tests/unit/push-import-group.test.ts
git commit -m "feat(push-import): group files by stem with skip reporting

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: `src/lib/push-import/plan.ts` — match stems → variants (pure)

**Files:**
- Create: `src/lib/push-import/plan.ts`
- Test: `tests/unit/push-import-plan.test.ts`

The plan stage is pure: it takes grouped pushes plus a snapshot of candidate variants (id, name, body, sourceFile, and existing translation languages) and decides per-language create/update/noop. The English file is the anchor — no `en` row is planned; instead the English body is compared to the variant's current body to surface divergence.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/push-import-plan.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { stripLangSuffix, buildImportPlan } from "@/lib/push-import/plan";
import type { GroupedPush, VariantSnapshot } from "@/lib/push-import/types";

function group(stem: string, langs: Record<string, { title?: string | null; body: string }>): GroupedPush {
  const byLang = new Map(Object.entries(langs).map(([l, c]) => [l, { title: c.title ?? null, body: c.body, bodyPersonal: null }]));
  return { stem, byLang };
}

describe("stripLangSuffix", () => {
  it("strips the -<lang>.json suffix from a sourceFile to get the stem", () => {
    expect(stripLangSuffix("2026-01-daily-remind-PUSH-1-en.json")).toBe("2026-01-daily-remind-PUSH-1");
    expect(stripLangSuffix("foo-bar-zh_TW.yml")).toBe("foo-bar");
  });
  it("returns the input unchanged when no recognizable suffix", () => {
    expect(stripLangSuffix("foo-bar")).toBe("foo-bar");
  });
});

describe("buildImportPlan", () => {
  const variants: VariantSnapshot[] = [
    { id: "v1", name: "Daily Remind 1", body: "take a moment in God's Word today.", sourceFile: "2026-01-daily-remind-PUSH-1-en.json", existingLanguages: new Set(["es"]) },
  ];

  it("matches stem to variant and plans creates/updates, skipping en", () => {
    const plan = buildImportPlan(
      [group("2026-01-daily-remind-PUSH-1", {
        en: { body: "take a moment in God's Word today." },
        es: { title: "ES", body: "es body" },   // existing → update
        pt: { title: "PT", body: "pt body" },    // new → create
      })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched).toHaveLength(1);
    const m = plan.matched[0];
    expect(m.messageVariantId).toBe("v1");
    const byLang = Object.fromEntries(m.languages.map((l) => [l.language, l.action]));
    expect(byLang).toEqual({ es: "update", pt: "create" }); // no "en" entry
    expect(m.englishDivergence).toBeNull(); // en body identical
    expect(plan.totals).toMatchObject({ creates: 1, updates: 1, matchedStems: 1, unmatchedStems: 0 });
  });

  it("flags english divergence when the en file differs from variant.body", () => {
    const plan = buildImportPlan(
      [group("2026-01-daily-remind-PUSH-1", { en: { body: "NEW english copy" }, es: { body: "es" } })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched[0].englishDivergence).toEqual({ incoming: "NEW english copy", current: "take a moment in God's Word today." });
  });

  it("reports unmatched stems", () => {
    const plan = buildImportPlan(
      [group("unknown-stem-PUSH-9", { en: { body: "x" }, es: { body: "y" } })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0]).toMatchObject({ stem: "unknown-stem-PUSH-9", matched: false });
    expect(plan.unmatched[0].languages.sort()).toEqual(["en", "es"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-import-plan.test.ts`
Expected: FAIL — missing exports / module.

- [ ] **Step 3: Add `VariantSnapshot` to types.ts**

Append to `src/lib/push-import/types.ts`:

```ts
/** Pure snapshot of a candidate variant for plan matching (no DB access in plan stage). */
export type VariantSnapshot = {
  id: string;
  name: string;
  body: string;
  sourceFile: string | null;       // actionFeatures.sourceFile
  existingLanguages: Set<string>;  // languages already present as translation rows
};
```

- [ ] **Step 4: Write plan.ts**

Create `src/lib/push-import/plan.ts`:

```ts
import type { GroupedPush, VariantSnapshot, ImportPlan, PerLanguagePlan, StemPlan } from "./types";

const SUFFIX = /-[a-z]{2,3}(_[a-z]{2,4})?\.(json|ya?ml)$/i;

/** Strip a trailing `-<lang>.{json,yml}` suffix to recover the shared stem. */
export function stripLangSuffix(sourceFile: string): string {
  return sourceFile.replace(SUFFIX, "");
}

export function buildImportPlan(
  groups: GroupedPush[],
  variants: VariantSnapshot[],
  opts: { refreshEnglish: boolean },
): ImportPlan {
  // Index variants by their stem (derived from sourceFile). First writer wins on
  // collision; collisions are unexpected for distinct pushes.
  const byStem = new Map<string, VariantSnapshot>();
  for (const v of variants) {
    if (!v.sourceFile) continue;
    const stem = stripLangSuffix(v.sourceFile);
    if (!byStem.has(stem)) byStem.set(stem, v);
  }

  const matched: Extract<StemPlan, { matched: true }>[] = [];
  const unmatched: Extract<StemPlan, { matched: false }>[] = [];
  let creates = 0, updates = 0, noops = 0;

  for (const group of groups) {
    const variant = byStem.get(group.stem);
    if (!variant) {
      unmatched.push({ stem: group.stem, matched: false, languages: [...group.byLang.keys()] });
      continue;
    }

    const enCopy = group.byLang.get("en");
    const englishDivergence =
      enCopy && enCopy.body !== variant.body
        ? { incoming: enCopy.body, current: variant.body }
        : null;

    const languages: PerLanguagePlan[] = [];
    for (const [lang, copy] of group.byLang) {
      if (lang === "en") continue; // English lives on the variant; never a translation row
      const exists = variant.existingLanguages.has(lang);
      const action: PerLanguagePlan["action"] = exists ? "update" : "create";
      if (action === "create") creates++; else updates++;
      languages.push({ language: lang, action, title: copy.title, body: copy.body, bodyPersonal: copy.bodyPersonal });
    }

    matched.push({
      stem: group.stem,
      matched: true,
      messageVariantId: variant.id,
      variantName: variant.name,
      languages,
      englishDivergence: opts.refreshEnglish ? englishDivergence : englishDivergence, // surfaced either way; commit decides whether to apply
    });
  }

  return {
    matched,
    unmatched,
    totals: {
      stems: groups.length,
      matchedStems: matched.length,
      unmatchedStems: unmatched.length,
      creates, updates, noops,
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/push-import-plan.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/push-import/plan.ts src/lib/push-import/types.ts tests/unit/push-import-plan.test.ts
git commit -m "feat(push-import): pure plan stage matching stems to variants

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `src/lib/push-import/commit.ts` + barrel — upsert translations

**Files:**
- Create: `src/lib/push-import/commit.ts`
- Create: `src/lib/push-import/index.ts`
- Integration coverage comes in Task 9 (the endpoint test); this task has no standalone DB test (the commit is exercised end-to-end via the endpoint, per spec testing section).

- [ ] **Step 1: Write commit.ts**

Create `src/lib/push-import/commit.ts`:

```ts
import type { prisma as prismaClient } from "@/lib/db";
import type { ImportPlan } from "./types";

export type CommitResult = { created: number; updated: number; englishRefreshed: number };

/**
 * Apply an import plan to the DB: upsert MessageVariantTranslation rows by
 * (messageVariantId, language). When refreshEnglish is true, also overwrite the
 * matched variant's English body/title from the en anchor where it diverged.
 * Idempotent via the unique key. No deletes.
 */
export async function commitImportPlan(
  plan: ImportPlan,
  prisma: typeof prismaClient,
  opts: { source: string; refreshEnglish: boolean; englishByStem?: Map<string, { title: string | null; body: string }> },
): Promise<CommitResult> {
  let created = 0, updated = 0, englishRefreshed = 0;

  for (const stem of plan.matched) {
    for (const lang of stem.languages) {
      const existing = await prisma.messageVariantTranslation.findUnique({
        where: { messageVariantId_language: { messageVariantId: stem.messageVariantId, language: lang.language } },
        select: { id: true },
      });
      await prisma.messageVariantTranslation.upsert({
        where: { messageVariantId_language: { messageVariantId: stem.messageVariantId, language: lang.language } },
        create: {
          messageVariantId: stem.messageVariantId,
          language: lang.language,
          title: lang.title,
          body: lang.body,
          bodyPersonal: lang.bodyPersonal,
          status: "active",
          source: opts.source,
          sourceFile: `${stem.stem}-${lang.language}`,
        },
        update: {
          title: lang.title,
          body: lang.body,
          bodyPersonal: lang.bodyPersonal,
          status: "active",
          source: opts.source,
          sourceFile: `${stem.stem}-${lang.language}`,
        },
      });
      if (existing) updated++; else created++;
    }

    if (opts.refreshEnglish && stem.englishDivergence) {
      await prisma.messageVariant.update({
        where: { id: stem.messageVariantId },
        data: { body: stem.englishDivergence.incoming },
      });
      englishRefreshed++;
    }
  }

  return { created, updated, englishRefreshed };
}
```

- [ ] **Step 2: Write the barrel**

Create `src/lib/push-import/index.ts`:

```ts
export * from "./types";
export { parseFilename, parseFileContents, fileKind } from "./parse";
export { groupImportFiles } from "./group";
export type { SkippedFile } from "./group";
export { buildImportPlan, stripLangSuffix } from "./plan";
export { commitImportPlan } from "./commit";
export type { CommitResult } from "./commit";
```

- [ ] **Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/push-import/commit.ts src/lib/push-import/index.ts
git commit -m "feat(push-import): commit stage (idempotent upsert) + barrel export

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `send-grouping.ts` — localize at batch-grouping time

**Files:**
- Modify: `src/lib/cron/send-grouping.ts` (lines 45-90: `groupDecisionsByVariant`)
- Test: `tests/unit/send-grouping-localization.test.ts`

**Approach:** Add an optional `localization` parameter. When enabled, resolve each user's `language_tag` to localized copy, set the group's `body`/`title` to the localized strings, and extend the group key with the localized copy so users sharing copy batch together (English-fallback users merge into one group). When disabled, behavior is byte-for-byte identical to today.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/send-grouping-localization.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant } from "@/lib/cron/send-grouping";
import type { VariantMeta } from "@/lib/cron/send-grouping";
import type { LocalizedCopy } from "@/lib/push-locale";

const meta: VariantMeta = { channel: "push", body: "EN body", title: "EN title", deeplink: null, brazeCampaignId: "c1", brazeVariantId: "bv1" };
const variantMeta = new Map<string, VariantMeta>([["v1", meta]]);
const when = new Date("2026-06-01T08:00:00.000Z");

function user(externalId: string, lang: string | undefined) {
  return { user: { externalId, brazeId: null, attributes: lang ? { language_tag: lang } : {} }, variantId: "v1", scheduledAt: when, inLocalTime: false };
}
function decisionMap(ids: string[]) { return new Map(ids.map((id) => [id, `dec-${id}`])); }

const translationsByVariant = new Map<string, Map<string, LocalizedCopy>>([
  ["v1", new Map<string, LocalizedCopy>([
    ["es", { title: "ES title", body: "ES body" }],
    ["zh_TW", { title: "ZH title", body: "ZH body" }],
  ])],
]);

describe("groupDecisionsByVariant localization", () => {
  it("disabled: single English group, body/title untouched", () => {
    const groups = groupDecisionsByVariant(
      [user("a", "es"), user("b", "en")], variantMeta, decisionMap(["a", "b"]),
    );
    const list = Object.values(groups);
    expect(list).toHaveLength(1);
    expect(list[0].body).toBe("EN body");
    expect(list[0].title).toBe("EN title");
    expect(list[0].externalUserIds.sort()).toEqual(["a", "b"]);
  });

  it("enabled: separate groups per resolved language with localized copy", () => {
    const groups = groupDecisionsByVariant(
      [user("a", "es"), user("b", "es_ES"), user("c", "zh_TW"), user("d", "en"), user("e", "fr")],
      variantMeta, decisionMap(["a", "b", "c", "d", "e"]),
      { enabled: true, translationsByVariant },
    );
    const list = Object.values(groups);
    const es = list.find((g) => g.body === "ES body")!;
    const zh = list.find((g) => g.body === "ZH body")!;
    const en = list.find((g) => g.body === "EN body")!;
    expect(es.externalUserIds.sort()).toEqual(["a", "b"]); // es + es_ES merge
    expect(es.title).toBe("ES title");
    expect(zh.externalUserIds).toEqual(["c"]);
    expect(en.externalUserIds.sort()).toEqual(["d", "e"]); // en + fr-fallback merge
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/send-grouping-localization.test.ts`
Expected: FAIL — `groupDecisionsByVariant` ignores the 4th arg; "enabled" case groups everyone into one EN group.

- [ ] **Step 3: Edit send-grouping.ts**

Add the import at the top of `src/lib/cron/send-grouping.ts` (after line 5):

```ts
import { resolvePushLocale, type LocalizedCopy } from "@/lib/push-locale";
```

Replace the `groupDecisionsByVariant` signature and body (lines 45-90) with:

```ts
export function groupDecisionsByVariant(
  inputs: Array<{ user: GroupUser; variantId: string; scheduledAt: Date; inLocalTime: boolean }>,
  variantMeta: Map<string, VariantMeta>,
  decisionIdByUser: Map<string, string>,
  localization?: {
    enabled: boolean;
    translationsByVariant: Map<string, Map<string, LocalizedCopy>>;
  },
): Record<string, VariantSendGroup> {
  const byVariant: Record<string, VariantSendGroup> = {};

  for (const { user, variantId, scheduledAt, inLocalTime: isFallback } of inputs) {
    const meta = variantMeta.get(variantId);
    if (!meta) continue;
    const decisionId = decisionIdByUser.get(user.externalId);
    if (!decisionId) continue;

    const resolvedDeeplink = meta.deeplink === GIVING_LINK_SENTINEL
      ? buildGivingDeeplink((user.attributes as Record<string, unknown>) ?? {})
      : meta.deeplink;

    // Localize copy when enabled and this is a push variant with translations.
    let copy: LocalizedCopy = { title: meta.title, body: meta.body };
    if (localization?.enabled && meta.channel === "push") {
      const attrs = (user.attributes as Record<string, unknown>) ?? {};
      const tag = attrs.language_tag as string | undefined;
      copy = resolvePushLocale(
        tag,
        localization.translationsByVariant.get(variantId) ?? new Map(),
        { title: meta.title, body: meta.body },
      );
    }

    const groupInLocalTime = isFallback;
    const baseKey = `${variantId}:${scheduledAt.toISOString()}:${groupInLocalTime}:${resolvedDeeplink ?? ""}`;
    // When localizing, users sharing the same resolved copy must batch together;
    // the copy fully determines the payload, so key by it. \u0000 is a NUL field
    // separator (cannot appear in title/body) preventing title|body ambiguity.
    const groupKey = localization?.enabled
      ? `${baseKey}:${copy.title ?? ""}\u0000${copy.body}`
      : baseKey;

    if (!byVariant[groupKey]) {
      byVariant[groupKey] = {
        variantId,
        brazeVariantId:  meta.brazeVariantId,
        brazeCampaignId: meta.brazeCampaignId,
        channel:         meta.channel,
        body:            copy.body,
        title:           copy.title,
        deeplink:        resolvedDeeplink,
        inLocalTime:     groupInLocalTime,
        scheduledAt,
        externalUserIds: [],
        brazeOnlyIds:    new Set(),
        decisionIds:     [],
      };
    }
    byVariant[groupKey].externalUserIds.push(user.externalId);
    if (user.brazeId && user.externalId === user.brazeId) {
      byVariant[groupKey].brazeOnlyIds.add(user.externalId);
    }
    byVariant[groupKey].decisionIds.push(decisionId);
  }

  return byVariant;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/send-grouping-localization.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/unit/send-grouping-localization.test.ts
git commit -m "feat(cron): localize push copy at send-grouping time (opt-in)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Cron route — load translations, relax targeting, pass localization

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts` (lines 435, 649-662, 862, 1210)
- Test: `tests/regression/cron-push-localization.test.ts`

- [ ] **Step 1: Load translations once per agent (after `allVariantIds`)**

In `src/app/api/cron/select-and-send/route.ts`, immediately after line 435 (`const allVariantIds = agent.messages.flatMap(...)`), add:

```ts
    // Push localization: load active translations for this agent's variants once
    // per run (batch — avoids N+1). Built into variantId -> (canonical lang -> copy).
    const localizeEnabled = agent.localizePush && agent.messages.some((m) => m.channel === "push");
    const translationsByVariant = new Map<string, Map<string, import("@/lib/push-locale").LocalizedCopy>>();
    if (localizeEnabled && allVariantIds.length > 0) {
      const rows = await prisma.messageVariantTranslation.findMany({
        where: { messageVariantId: { in: allVariantIds }, status: "active" },
        select: { messageVariantId: true, language: true, title: true, body: true },
      });
      for (const r of rows) {
        let m = translationsByVariant.get(r.messageVariantId);
        if (!m) { m = new Map(); translationsByVariant.set(r.messageVariantId, m); }
        m.set(r.language, { title: r.title, body: r.body });
      }
    }
    const localization = { enabled: localizeEnabled, translationsByVariant };
```

- [ ] **Step 2: Relax the language filter when localizing (lines 649-662)**

Replace the `effectiveAgentLang` / `langFiltered` block (lines 651-662) with:

```ts
      // Language filter for push agents: English-only sends by default. When the
      // agent opts into push localization, do NOT force EN and do NOT exclude
      // missing-language_tag users — every recipient gets copy (English fallback).
      const effectiveAgentLang =
        agent.languageFilter && agent.languageFilter !== "all"
          ? agent.languageFilter
          : (hasPushMessages && !localizeEnabled) ? "en" : null;
      const langFiltered = effectiveAgentLang
        ? channelFiltered.filter((u) => {
            const attrs = u.attributes as Record<string, unknown>;
            const lang = attrs?.language_tag as string | undefined;
            return lang?.startsWith(effectiveAgentLang) === true;
          })
        : channelFiltered;
      suppress.targetFilter += channelFiltered.length - langFiltered.length;
```

(Note: an explicit `languageFilter` other than "all" still wins — an operator who pinned a language keeps that behavior even with localization on. Localization only changes the *default* EN-force.)

- [ ] **Step 3: Pass localization to the lottery grouping call (line 862)**

Replace line 862:

```ts
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser, localization);
```

- [ ] **Step 4: Pass localization to the in-window grouping call (line 1210)**

Replace line 1210:

```ts
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser, localization);
```

- [ ] **Step 5: Write the regression test**

Create `tests/regression/cron-push-localization.test.ts` (asserts the send-path grouping contract the cron now relies on):

```ts
// Regression: push localization send-path. Guards two invariants:
//  1. localizePush=false -> behavior unchanged (single EN group, EN copy).
//  2. localizePush=true  -> per-language groups, English fallback for missing langs.
// See docs/superpowers/specs/2026-05-30-push-localization-design.md
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { LocalizedCopy } from "@/lib/push-locale";

const meta: VariantMeta = { channel: "push", body: "EN", title: "ENt", deeplink: null, brazeCampaignId: "c", brazeVariantId: "b" };
const vm = new Map([["v1", meta]]);
const when = new Date("2026-06-01T08:00:00.000Z");
const u = (id: string, lang?: string) => ({ user: { externalId: id, brazeId: null, attributes: lang ? { language_tag: lang } : {} }, variantId: "v1", scheduledAt: when, inLocalTime: false });
const dm = (ids: string[]) => new Map(ids.map((i) => [i, `d-${i}`]));
const tx = new Map<string, Map<string, LocalizedCopy>>([["v1", new Map([["pt", { title: "PTt", body: "PT" }]])]]);

describe("cron push localization regression", () => {
  it("localizePush=false keeps EN-only single group", () => {
    const g = Object.values(groupDecisionsByVariant([u("a", "pt"), u("b")], vm, dm(["a", "b"])));
    expect(g).toHaveLength(1);
    expect(g[0].body).toBe("EN");
    expect(g[0].externalUserIds.sort()).toEqual(["a", "b"]);
  });

  it("localizePush=true localizes pt and falls back to EN for missing langs", () => {
    const g = Object.values(groupDecisionsByVariant(
      [u("a", "pt"), u("b", "de"), u("c")], vm, dm(["a", "b", "c"]),
      { enabled: true, translationsByVariant: tx },
    ));
    const pt = g.find((x) => x.body === "PT")!;
    const en = g.find((x) => x.body === "EN")!;
    expect(pt.externalUserIds).toEqual(["a"]);
    expect(en.externalUserIds.sort()).toEqual(["b", "c"]); // de + missing -> English
  });
});
```

- [ ] **Step 6: Run typecheck + the new tests**

Run: `bun run typecheck && bun test tests/regression/cron-push-localization.test.ts`
Expected: typecheck PASS; regression tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/regression/cron-push-localization.test.ts
git commit -m "feat(cron): wire push localization into select-and-send

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Import API endpoint — `POST /api/push-translations/import`

**Files:**
- Create: `src/app/api/push-translations/import/route.ts`
- Test: `tests/integration/push-translations-import.test.ts`

**Contract (per `src/app/api/CLAUDE.md`):** `requireAdmin()` gates the mutation; validate before DB; `{ data }` / `{ error }`; no Prisma leakage. Accepts multipart form-data with one or more files (each part named `files`) plus form fields `commit` ("true"|"false") and `refreshEnglish` ("true"|"false"). Dry-run (default) returns the plan; commit upserts and returns counts.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/push-translations-import.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { POST } from "@/app/api/push-translations/import/route";
import { prisma } from "@/lib/db";
import { createAgent, createMessage, createVariant } from "@/tests/helpers/builders";

// Auth is stubbed: requireAdmin reads getAuth(); integration env sets admin=true.
// (Mirror the pattern used by other mutation-endpoint integration tests.)

function form(files: { name: string; body: string }[], fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const f of files) fd.append("files", new File([f.body], f.name, { type: "application/json" }));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://test/api/push-translations/import", { method: "POST", body: fd });
}

const en = JSON.stringify({ push_title: "EN", push_message_non_personal: "english copy" });
const es = JSON.stringify({ push_title: "ES", push_message_non_personal: "copia" });
const pt = JSON.stringify({ push_title: "PT", push_message_non_personal: "cópia" });

describe("POST /api/push-translations/import", () => {
  let variantId: string;
  let createdIds: string[] = [];

  beforeEach(async () => {
    const agent = await createAgent({ name: "Import Test Agent" });
    const msg = await createMessage(agent.id, { channel: "push" });
    const variant = await prisma.messageVariant.create({
      data: { messageId: msg.id, name: "V", body: "english copy", title: "EN",
        actionFeatures: { sourceFile: "import-stem-1-en.json" } as object },
    });
    variantId = variant.id;
    createdIds = [agent.id];
  });

  afterEach(async () => {
    await prisma.messageVariantTranslation.deleteMany({ where: { messageVariantId: variantId } });
    await prisma.agent.deleteMany({ where: { id: { in: createdIds } } });
  });

  it("dry-run returns the plan without writing", async () => {
    const res = await POST(form([
      { name: "import-stem-1-en.json", body: en },
      { name: "import-stem-1-es.json", body: es },
      { name: "import-stem-1-pt.json", body: pt },
    ]));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.totals).toMatchObject({ matchedStems: 1, creates: 2 });
    const count = await prisma.messageVariantTranslation.count({ where: { messageVariantId: variantId } });
    expect(count).toBe(0); // dry-run wrote nothing
  });

  it("commit upserts translation rows (idempotent)", async () => {
    const files = [
      { name: "import-stem-1-en.json", body: en },
      { name: "import-stem-1-es.json", body: es },
    ];
    const res1 = await POST(form(files, { commit: "true" }));
    expect(res1.status).toBe(200);
    const { data: d1 } = await res1.json();
    expect(d1.committed).toMatchObject({ created: 1, updated: 0 });

    const row = await prisma.messageVariantTranslation.findUnique({
      where: { messageVariantId_language: { messageVariantId: variantId, language: "es" } },
    });
    expect(row?.body).toBe("copia");

    // Re-commit → update, not duplicate
    const res2 = await POST(form(files, { commit: "true" }));
    const { data: d2 } = await res2.json();
    expect(d2.committed).toMatchObject({ created: 0, updated: 1 });
    const count = await prisma.messageVariantTranslation.count({ where: { messageVariantId: variantId, language: "es" } });
    expect(count).toBe(1);
  });

  it("rejects an empty upload with 400", async () => {
    const res = await POST(form([]));
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(typeof error).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/push-translations-import.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Write the route**

Create `src/app/api/push-translations/import/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  groupImportFiles, buildImportPlan, commitImportPlan,
  type ImportFile, type VariantSnapshot, type ImportPlan, type CommitResult, type SkippedFile,
} from "@/lib/push-import";

type Ok = { data: { plan: ImportPlan; skipped: SkippedFile[]; committed?: CommitResult } };
type Err = { error: string };

export async function POST(req: NextRequest): Promise<NextResponse<Ok | Err>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden as NextResponse<Err>;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const fileParts = formData.getAll("files").filter((p): p is File => p instanceof File);
  if (fileParts.length === 0) {
    return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  }
  const doCommit = formData.get("commit") === "true";
  const refreshEnglish = formData.get("refreshEnglish") === "true";

  const files: ImportFile[] = [];
  for (const part of fileParts) {
    // webkitdirectory submits relative paths in the filename; honor them for stem parsing.
    const relativePath = (part as File & { webkitRelativePath?: string }).webkitRelativePath || part.name;
    files.push({ relativePath, contents: await part.text() });
  }

  const { groups, skipped } = groupImportFiles(files);

  // Candidate variants: push variants whose message belongs to any agent. Snapshot
  // sourceFile + existing translation languages for pure plan matching.
  const variants = await prisma.messageVariant.findMany({
    where: { message: { channel: "push" } },
    select: { id: true, name: true, body: true, actionFeatures: true, translations: { select: { language: true } } },
  });
  const snapshots: VariantSnapshot[] = variants.map((v) => {
    const af = (v.actionFeatures as Record<string, unknown> | null) ?? null;
    const sourceFile = af && typeof af.sourceFile === "string" ? af.sourceFile : null;
    return { id: v.id, name: v.name, body: v.body, sourceFile, existingLanguages: new Set(v.translations.map((t) => t.language)) };
  });

  const plan = buildImportPlan(groups, snapshots, { refreshEnglish });

  if (!doCommit) {
    return NextResponse.json({ data: { plan, skipped } }, { status: 200 });
  }

  try {
    const committed = await commitImportPlan(plan, prisma, { source: "upload", refreshEnglish });
    return NextResponse.json({ data: { plan, skipped, committed } }, { status: 200 });
  } catch (err) {
    console.error("[push-translations/import] commit failed:", err);
    return NextResponse.json({ error: "Failed to commit translations" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/push-translations-import.test.ts`
Expected: PASS. (If auth blocks with 403, mirror the admin-stub used by other integration tests in `tests/integration/`, e.g. `campaign-content` — set the same env/mocking those tests use.)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/push-translations/import/route.ts tests/integration/push-translations-import.test.ts
git commit -m "feat(api): push-translations/import dry-run + commit endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Folder-upload UI

**Files:**
- Create: `src/components/messages/push-translation-upload.tsx`
- Mount point: the push library page that lists variants (e.g. `src/app/messages/` or `src/app/push-library/`). Locate the existing push-library page and add the component to its header.

This is a client component: it lets the operator pick a folder (`webkitdirectory`), POSTs a dry-run, shows the plan (matched/unmatched + per-language counts), then a confirm button that re-POSTs with `commit=true`. There is no pure logic to unit-test here (it orchestrates `fetch`); verify it manually in the browser per the UI-testing convention.

- [ ] **Step 1: Find the push-library page to mount on**

Run: `ls src/app/push-library/ src/app/messages/ 2>/dev/null; grep -rln "Push Library\|push-library\|MessageVariant" src/app --include=*.tsx | head`
Expected: identifies the page component (e.g. `src/app/push-library/page.tsx`). Note its path for Step 3.

- [ ] **Step 2: Write the component**

Create `src/components/messages/push-translation-upload.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

type PerLang = { language: string; action: "create" | "update" | "noop" };
type Matched = { stem: string; variantName: string; languages: PerLang[]; englishDivergence: { incoming: string; current: string } | null };
type Unmatched = { stem: string; languages: string[] };
type Plan = { matched: Matched[]; unmatched: Unmatched[]; totals: { stems: number; matchedStems: number; unmatchedStems: number; creates: number; updates: number; noops: number } };
type ImportResponse = { data: { plan: Plan; skipped: { relativePath: string; reason: string }[]; committed?: { created: number; updated: number; englishRefreshed: number } } };

export function PushTranslationUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [committed, setCommitted] = useState<ImportResponse["data"]["committed"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(commit: boolean) {
    if (!files || files.length === 0) { setError("Pick a folder first."); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append("files", f, (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
      if (commit) fd.append("commit", "true");
      const res = await fetch("/api/push-translations/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Upload failed"); return; }
      const data = (json as ImportResponse).data;
      setPlan(data.plan);
      setCommitted(data.committed ?? null);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-base font-semibold">Upload translations</h3>
        <p className="text-sm text-muted-foreground">Pick a push folder (e.g. <code>push1/</code>) or a parent folder of pushes. We match each file to its English push and show a plan before saving.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error non-standard but widely supported directory upload attrs
          webkitdirectory=""
          directory=""
          multiple
          onChange={(e) => { setFiles(e.target.files); setPlan(null); setCommitted(null); setError(null); }}
          className="block text-sm"
        />
        <div className="flex gap-2">
          <Button onClick={() => send(false)} disabled={busy || !files} variant="outline">
            {busy ? "Analyzing…" : "Preview plan"}
          </Button>
          <Button onClick={() => send(true)} disabled={busy || !plan || plan.totals.matchedStems === 0}>
            {busy ? "Saving…" : `Commit ${plan ? plan.totals.creates + plan.totals.updates : 0} translations`}
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {committed && (
          <p className="text-sm text-emerald-600">
            Saved: {committed.created} created, {committed.updated} updated{committed.englishRefreshed ? `, ${committed.englishRefreshed} English refreshed` : ""}.
          </p>
        )}

        {plan && (
          <div className="space-y-3 text-sm">
            <p className="font-medium">
              {plan.totals.matchedStems} matched · {plan.totals.unmatchedStems} unmatched ·
              {" "}{plan.totals.creates} new · {plan.totals.updates} updates
            </p>
            {plan.matched.map((m) => (
              <div key={m.stem} className="rounded border border-border p-2">
                <p className="font-medium">{m.variantName}</p>
                <p className="text-muted-foreground">
                  {m.languages.map((l) => `${l.language} (${l.action})`).join(", ") || "no non-English languages"}
                </p>
                {m.englishDivergence && (
                  <p className="text-amber-600">⚠ English differs from the stored variant (not overwritten).</p>
                )}
              </div>
            ))}
            {plan.unmatched.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 p-2 dark:bg-amber-950/20">
                <p className="font-medium text-amber-700 dark:text-amber-400">Unmatched pushes (skipped)</p>
                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
                  {plan.unmatched.map((u) => <li key={u.stem}>{u.stem} — {u.languages.join(", ")}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Mount it on the push-library page**

In the page identified in Step 1, import and render `<PushTranslationUpload />` in the page header area:

```tsx
import { PushTranslationUpload } from "@/components/messages/push-translation-upload";
// ...in the JSX, near the top of the page content:
<PushTranslationUpload />
```

- [ ] **Step 4: Typecheck + lint + manual browser check**

Run: `bun run check:quick`
Expected: PASS.
Then run `bun run dev`, open the push-library page, pick the example folder
`~/Library/CloudStorage/Dropbox-Life.Church/.../2026/2026-01 Daily reward-remind/push/remind/push1`,
click "Preview plan" → confirm matched/unmatched render → click commit → confirm the saved counts. If you cannot run the browser, say so explicitly.

- [ ] **Step 5: Commit**

```bash
git add src/components/messages/push-translation-upload.tsx <push-library-page-path>
git commit -m "feat(ui): folder-upload for push translations with dry-run plan

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Language-coverage visibility on the push library

**Files:**
- Create: `src/lib/push-coverage.ts`
- Test: `tests/unit/push-coverage.test.ts`
- Create: `src/components/push-library/language-coverage-badge.tsx`
- Modify: `src/app/messages/page.tsx` (the `getGroups` query + its variant mapping)
- Modify: `src/components/push-library/push-library-client.tsx` (the `TemplateVariant` type, lines 13-22)
- Modify: `src/components/push-library/template-card.tsx` (the duplicate `TemplateVariant` type lines 10-18 + the badge render at lines 35-42)

**Approach:** Surface, per push variant, how many non-English translations exist ("EN only" / "EN + 3 languages"). The count math is a pure formatter (unit-tested); the badge is a thin presentational component; the data is one extra relation `select` on the existing library query.

- [ ] **Step 1: Write the failing formatter test**

Create `tests/unit/push-coverage.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { countCoverageLanguages, formatLanguageCoverage } from "@/lib/push-coverage";

describe("countCoverageLanguages", () => {
  it("counts distinct non-English languages", () => {
    expect(countCoverageLanguages(["es", "pt", "fr"])).toBe(3);
  });
  it("ignores en/EN and blanks, and dedupes", () => {
    expect(countCoverageLanguages(["es", "es", "en", "EN", "  "])).toBe(1);
  });
  it("returns 0 for an empty list", () => {
    expect(countCoverageLanguages([])).toBe(0);
  });
});

describe("formatLanguageCoverage", () => {
  it("reports EN only when there are no translations", () => {
    expect(formatLanguageCoverage([])).toBe("EN only");
    expect(formatLanguageCoverage(["en"])).toBe("EN only");
  });
  it("uses the singular for exactly one language", () => {
    expect(formatLanguageCoverage(["es"])).toBe("EN + 1 language");
  });
  it("uses the plural for many languages", () => {
    expect(formatLanguageCoverage(["es", "pt", "zh_TW"])).toBe("EN + 3 languages");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/push-coverage.test.ts`
Expected: FAIL — `Cannot find module '@/lib/push-coverage'`.

- [ ] **Step 3: Write the formatter**

Create `src/lib/push-coverage.ts`:

```ts
// Pure summary of a push variant's localization coverage. English always lives on
// the MessageVariant itself (there is no "en" translation row), so "coverage" counts
// the distinct non-English translation languages. No I/O.

export function countCoverageLanguages(languages: string[]): number {
  const distinct = new Set<string>();
  for (const raw of languages) {
    const lang = raw.trim();
    if (lang && lang.toLowerCase() !== "en") distinct.add(lang);
  }
  return distinct.size;
}

export function formatLanguageCoverage(languages: string[]): string {
  const n = countCoverageLanguages(languages);
  if (n === 0) return "EN only";
  if (n === 1) return "EN + 1 language";
  return `EN + ${n} languages`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/push-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the badge component**

Create `src/components/push-library/language-coverage-badge.tsx`:

```tsx
import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { countCoverageLanguages, formatLanguageCoverage } from "@/lib/push-coverage";

export function LanguageCoverageBadge({ languages }: { languages: string[] }) {
  const localized = countCoverageLanguages(languages) > 0;
  return (
    <Badge variant={localized ? "secondary" : "outline"} className="shrink-0 gap-1 text-xs">
      <Globe className="h-3 w-3" />
      {formatLanguageCoverage(languages)}
    </Badge>
  );
}
```

- [ ] **Step 6: Add `languages` to the shared `TemplateVariant` type**

In `src/components/push-library/push-library-client.tsx`, add a `languages` field to the exported `TemplateVariant` type (after `subcategory` on line 21):

```ts
export type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  languages: string[]; // canonical non-English translation codes present for this variant
};
```

- [ ] **Step 7: Mirror the field on the card's duplicate type**

In `src/components/push-library/template-card.tsx`, add the same field to the local `TemplateVariant` type (after `subcategory` on line 18):

```ts
type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  languages: string[];
};
```

- [ ] **Step 8: Render the badge in the card header**

In `src/components/push-library/template-card.tsx`, import the badge near the other imports (after line 8):

```tsx
import { LanguageCoverageBadge } from "@/components/push-library/language-coverage-badge";
```

Then replace the header block (lines 35-42) so the coverage badge sits beside the existing subcategory badge:

```tsx
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{variant.name}</p>
          <div className="flex shrink-0 items-center gap-1">
            <LanguageCoverageBadge languages={variant.languages} />
            {variant.subcategory && (
              <Badge variant="outline" className="shrink-0 text-xs">
                {variant.subcategory}
              </Badge>
            )}
          </div>
        </div>
```

- [ ] **Step 9: Feed `languages` from the library query**

In `src/app/messages/page.tsx`, add the translations relation to the `getGroups` `findMany` `select` (after `subcategory: true,` on line 31):

```ts
        subcategory: true,
        translations: { select: { language: true } },
```

Then, in the grouping loop (lines 37-44), map the row's `translations` into the flat `languages: string[]` the `TemplateVariant` type now expects. Replace:

```ts
    for (const v of variants) {
      const cat = v.category ?? "uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, new Map());
      const subMap = grouped.get(cat)!;
      const sub = v.subcategory ?? null;
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub)!.push(v);
    }
```

with:

```ts
    for (const v of variants) {
      const cat = v.category ?? "uncategorized";
      if (!grouped.has(cat)) grouped.set(cat, new Map());
      const subMap = grouped.get(cat)!;
      const sub = v.subcategory ?? null;
      if (!subMap.has(sub)) subMap.set(sub, []);
      const { translations, ...rest } = v;
      subMap.get(sub)!.push({ ...rest, languages: translations.map((t) => t.language) });
    }
```

- [ ] **Step 10: Typecheck, lint, and a manual browser check**

Run: `bun run check:quick`
Expected: PASS (the unit test from Step 1 included, typecheck clean now that both `TemplateVariant` copies carry `languages`).
Then `bun run dev`, open the push library page (`/messages`), and confirm each card shows a coverage badge: "EN only" for untranslated pushes, "EN + N languages" once Task 12 (or the upload UI) has populated translations. If you cannot run the browser, say so explicitly.

- [ ] **Step 11: Commit**

```bash
git add src/lib/push-coverage.ts tests/unit/push-coverage.test.ts \
  src/components/push-library/language-coverage-badge.tsx \
  src/components/push-library/template-card.tsx \
  src/components/push-library/push-library-client.tsx \
  src/app/messages/page.tsx
git commit -m "feat(push-library): per-variant language-coverage badge

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Backfill script — import the Dropbox campaigns corpus

**Files:**
- Create: `scripts/import-push-translations.ts`

**Approach:** A one-off (re-runnable) operator script that walks the Dropbox `Campaigns/{2025,2026}/` tree, collects every `<stem>-<lang>.{json,yml,yaml}` file, and runs them through the already-tested pure pipeline (`groupImportFiles` → `buildImportPlan`) before optionally committing (`commitImportPlan`). It has **no standalone test**: every decision it makes lives in unit-tested pure functions (Tasks 3-5) and the unit-/integration-tested commit (Tasks 6, 9); this script only adds filesystem walking + arg parsing. **Safety:** dry-run by default (writes nothing, prints the full plan for human review); `--commit` applies; `--refresh-english` additionally overwrites diverging English bodies. `prisma` here targets `.env.local` (production) per CLAUDE.md — the dry-run default is the guardrail, and the actual `--commit` run is an operator action after reviewing the dry-run, not part of this automated plan.

- [ ] **Step 1: Write the script**

Create `scripts/import-push-translations.ts`:

```ts
// Backfill push translations from the Dropbox campaigns corpus into
// MessageVariantTranslation rows. Walks Campaigns/{2025,2026}/ recursively, matches
// each <stem>-<lang>.{json,yml,yaml} file to a push MessageVariant via
// actionFeatures.sourceFile, and upserts non-English copy.
//
// SAFETY: dry-run by default — prints the plan and writes NOTHING. Pass --commit to
// upsert; pass --refresh-english to also overwrite diverging English bodies.
// Idempotent (unique key); never deletes. prisma here targets the .env.local DB
// (production) per CLAUDE.md, so review the dry-run before passing --commit.
import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";
import {
  groupImportFiles, buildImportPlan, commitImportPlan,
  type ImportFile, type VariantSnapshot,
} from "@/lib/push-import";

const CAMPAIGN_YEARS = ["2025", "2026"];
const EXT = /\.(json|ya?ml)$/i;

function findCampaignsBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) {
    throw new Error(`CloudStorage directory not found: ${cloudBase}. Is Dropbox installed?`);
  }
  const dropboxFolder = fs.readdirSync(cloudBase).find((d) => d.toLowerCase().startsWith("dropbox"));
  if (!dropboxFolder) throw new Error(`No Dropbox folder found under ${cloudBase}`);

  // Mirrors scripts/seed-resurrection-push.ts: the shared folder under Clint has a
  // single dynamic child (its name contains a Unicode apostrophe); enumerate it
  // rather than hardcoding the character.
  const ionClintPath = path.join(cloudBase, dropboxFolder, "Ion", "Interactive", "Design", "Clint");
  if (!fs.existsSync(ionClintPath)) throw new Error(`Expected shared folder not found: ${ionClintPath}`);
  const clintSub = fs.readdirSync(ionClintPath).find((d) => !d.startsWith("."));
  if (!clintSub) throw new Error(`No entries under ${ionClintPath}`);

  return path.join(ionClintPath, clintSub, "Shared", "YouVersionTeam", "Communications", "Campaigns");
}

function walkFiles(dir: string, relRoot: string, out: ImportFile[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, relRoot, out);
    } else if (EXT.test(entry.name)) {
      out.push({ relativePath: path.relative(relRoot, full), contents: fs.readFileSync(full, "utf-8") });
    }
  }
}

async function main() {
  const doCommit = process.argv.includes("--commit");
  const refreshEnglish = process.argv.includes("--refresh-english");

  let base: string;
  try {
    base = findCampaignsBase();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  console.log(`Campaigns corpus: ${base}\n`);

  const files: ImportFile[] = [];
  for (const year of CAMPAIGN_YEARS) {
    const yearDir = path.join(base, year);
    if (!fs.existsSync(yearDir)) { console.warn(`  (skip) ${year} not found under corpus`); continue; }
    walkFiles(yearDir, base, files);
  }
  console.log(`Collected ${files.length} candidate files.\n`);

  const { groups, skipped } = groupImportFiles(files);

  const variants = await prisma.messageVariant.findMany({
    where: { message: { channel: "push" } },
    select: { id: true, name: true, body: true, actionFeatures: true, translations: { select: { language: true } } },
  });
  const snapshots: VariantSnapshot[] = variants.map((v) => {
    const af = (v.actionFeatures as Record<string, unknown> | null) ?? null;
    const sourceFile = af && typeof af.sourceFile === "string" ? af.sourceFile : null;
    return { id: v.id, name: v.name, body: v.body, sourceFile, existingLanguages: new Set(v.translations.map((t) => t.language)) };
  });

  const plan = buildImportPlan(groups, snapshots, { refreshEnglish });

  console.log(
    `Plan: ${plan.totals.matchedStems} matched · ${plan.totals.unmatchedStems} unmatched · ` +
    `${plan.totals.creates} new · ${plan.totals.updates} updates`
  );
  for (const m of plan.matched) {
    const langs = m.languages.map((l) => `${l.language}(${l.action})`).join(", ") || "—";
    const div = m.englishDivergence ? "  ⚠ EN diverges" : "";
    console.log(`  ✓ ${m.variantName} [${m.stem}]: ${langs}${div}`);
  }
  if (plan.unmatched.length > 0) {
    console.log(`\nUnmatched stems (no push variant with a matching sourceFile):`);
    for (const u of plan.unmatched) console.log(`  ✗ ${u.stem} — ${u.languages.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped files (${skipped.length}):`);
    for (const s of skipped.slice(0, 50)) console.log(`  - ${s.relativePath}: ${s.reason}`);
    if (skipped.length > 50) console.log(`  …and ${skipped.length - 50} more`);
  }

  if (!doCommit) {
    console.log(`\nDRY RUN — nothing written. Re-run with --commit to apply${refreshEnglish ? " (English refresh ON)" : ""}.`);
    return;
  }

  const committed = await commitImportPlan(plan, prisma, { source: "import:dropbox", refreshEnglish });
  console.log(`\nCommitted: ${committed.created} created, ${committed.updated} updated, ${committed.englishRefreshed} English refreshed.`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: PASS (the script consumes the Task 6 barrel exports; all types resolve).

- [ ] **Step 3: Dry-run against the live corpus (read-only)**

Run: `bun run scripts/import-push-translations.ts`
Expected: prints the corpus path, a collected-file count, and the matched/unmatched/skipped plan. **Writes nothing.** If the Dropbox folder is not synced locally, it prints the "CloudStorage directory not found" / "No Dropbox folder" message and exits 1 — note that and skip to Step 4 (the script is still correct; the corpus just isn't mounted in this environment).

- [ ] **Step 4: Commit the script (not any data)**

```bash
git add scripts/import-push-translations.ts
git commit -m "feat(scripts): dry-run-default backfill of push translations from Dropbox

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

> **Operator note (not an automated step):** to actually populate production, a human reviews the Step 3 dry-run output, then runs `bun run scripts/import-push-translations.ts --commit` (optionally `--refresh-english`). It is idempotent and safe to re-run.

---

## Task 13: Final verification + merge request

**Files:** none (verification + delivery only).

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: typecheck + lint + full integration + regression suite all PASS. If a failure looks like the known truncation-race / orphaned-row signature (FK violation on a *different* test each run), re-run a **solo** `bun run check` with no other test process touching the test DB before treating it as real.

- [ ] **Step 2: Push the branch and open a GitLab MR (do NOT merge)**

```bash
git push -u origin feat/push-localization
glab mr create --title "feat: push localization (per-variant translations + locale-aware cron)" \
  --description "$(cat <<'EOF'
## Summary
- New `MessageVariantTranslation` table + `Agent.localizePush` opt-in flag.
- Pure language resolver (`push-locale`) with English fallback; zh scripts kept distinct.
- Pure importer pipeline (`push-import`: parse → group → plan → commit) feeding both a folder-upload UI and a Dropbox backfill script.
- Cron `select-and-send` localizes copy per recipient `language_tag` at batch-grouping time; EN-only behavior unchanged when `localizePush` is off.
- Push library shows per-variant language-coverage badges.

## Test plan
- [ ] `bun run check` green (unit + integration + regression)
- [ ] New unit tests: push-locale, push-import-parse, push-import-group, push-import-plan, push-coverage
- [ ] Integration: push-translations/import dry-run + commit (idempotent)
- [ ] Regression: cron-push-localization (EN-only unchanged; per-language groups + EN fallback)
- [ ] Manual: upload a push folder via the library UI → preview plan → commit; confirm coverage badges update

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: MR created. **Stop here — do not merge.** The user wants to review the MR before it lands.

---
