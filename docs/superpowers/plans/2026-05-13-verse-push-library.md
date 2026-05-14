# Verse Push Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import 2026 Resurrection Push verse-specific push content from Dropbox into a dedicated `CampaignContent` table, and build a `/push-library` page with language tabs, USFM-keyed table view, gap detection, and authenticated add/edit UI.

**Architecture:** New `CampaignContent` Prisma model (flat table, `campaign` string discriminator) populated by a one-time seed script. Four CRUD API routes handle reads and mutations. The `/push-library` Server Component computes language summaries, verse rows, and gap analysis server-side; a Client Component handles tab switching, edit modal, and add-language drawer.

**Tech Stack:** Next.js 16 App Router, Prisma v7 + Neon PostgreSQL, TypeScript, bun:test, shadcn/ui (Dialog, Sheet, Textarea), js-yaml for YAML parsing in seed script.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add `CampaignContent` model |
| `tests/helpers/db.ts` | Modify | Add `campaignContent.deleteMany()` to `truncateAll` |
| `src/types/campaign-content.ts` | Create | Shared TS types: `CampaignContentRow`, `VerseRow`, `LangSummary`, `GapItem`, `ContentEntry` |
| `src/lib/usfm.ts` | Create | `usfmToHuman()`, `usfmSortKey()`, `BOOK_ORDER` — pure utility, no deps |
| `tests/unit/usfm.test.ts` | Create | Unit tests for all USFM utility exports |
| `scripts/seed-resurrection-push.ts` | Create | Enumerate Dropbox dirs, parse YAML, upsert rows via Prisma |
| `src/app/api/campaign-content/route.ts` | Create | `GET` + `POST` handlers |
| `src/app/api/campaign-content/[id]/route.ts` | Create | `PATCH` + `DELETE` handlers |
| `tests/helpers/builders.ts` | Modify | Add `createCampaignContent()` builder |
| `tests/integration/campaign-content.test.ts` | Create | Integration tests for all 4 API routes |
| `src/app/push-library/page.tsx` | Replace | Server Component: query DB, compute VerseRows + LangSummaries + GapItems, pass to client |
| `src/components/push-library/verse-library-client.tsx` | Create | Language tabs, table, gap panel, modal/drawer state |
| `src/components/push-library/edit-content-modal.tsx` | Create | 3-field edit/add modal; upserts via PATCH or POST |
| `src/components/push-library/add-language-drawer.tsx` | Create | Two-step Sheet: ISO code input → 90-row translation table |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `tests/helpers/db.ts`

- [ ] **Step 1: Add the CampaignContent model to schema.prisma**

Append this block at the end of `prisma/schema.prisma` (before the final blank line):

```prisma
model CampaignContent {
  id            String   @id @default(cuid())
  campaign      String
  contentType   String
  language      String
  usfmReference String
  usfmHuman     String?
  title         String?
  body          String?
  status        String   @default("active")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([campaign, contentType, language, usfmReference])
  @@index([campaign, language, contentType])
}
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name add-campaign-content
```

Expected: migration created in `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 3: Add campaignContent.deleteMany() to truncateAll in tests/helpers/db.ts**

The `steps` array in `truncateAll()` is FK-safe ordered. `CampaignContent` has no foreign keys, so append it anywhere. Add it after the `appSetting` line:

Current last two lines in the `steps` array:
```typescript
    () => prisma.planSetMember.deleteMany(),
    () => prisma.planSet.deleteMany(),
    () => prisma.appSetting.deleteMany(),
```

Replace with:
```typescript
    () => prisma.planSetMember.deleteMany(),
    () => prisma.planSet.deleteMany(),
    () => prisma.appSetting.deleteMany(),
    () => prisma.campaignContent.deleteMany(),
```

- [ ] **Step 4: Verify the test helper compiles**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/prisma/ tests/helpers/db.ts
git commit -m "feat: add CampaignContent prisma model + migration"
```

---

### Task 2: USFM Utility + Shared Types + Unit Tests

**Files:**
- Create: `src/types/campaign-content.ts`
- Create: `src/lib/usfm.ts`
- Create: `tests/unit/usfm.test.ts`

- [ ] **Step 1: Write the failing USFM unit tests**

Create `tests/unit/usfm.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { usfmToHuman, usfmSortKey, BOOK_ORDER } from "@/lib/usfm";

describe("usfmToHuman", () => {
  it("single verse: GEN.1.1", () => {
    expect(usfmToHuman("GEN.1.1")).toBe("Genesis 1:1");
  });

  it("single verse: 2CO.4.16", () => {
    expect(usfmToHuman("2CO.4.16")).toBe("2 Corinthians 4:16");
  });

  it("multi-verse same chapter: ISA.43.18+ISA.43.19", () => {
    expect(usfmToHuman("ISA.43.18+ISA.43.19")).toBe("Isaiah 43:18–19");
  });

  it("multi-verse same chapter: PSA.8.3+PSA.8.4", () => {
    expect(usfmToHuman("PSA.8.3+PSA.8.4")).toBe("Psalm 8:3–4");
  });

  it("cross-chapter: MAT.5.3+MAT.6.1", () => {
    expect(usfmToHuman("MAT.5.3+MAT.6.1")).toBe("Matthew 5:3–6:1");
  });

  it("Psalm alias: PSA.134.1", () => {
    expect(usfmToHuman("PSA.134.1")).toBe("Psalm 134:1");
  });

  it("Song of Songs alias: SNG.1.2", () => {
    expect(usfmToHuman("SNG.1.2")).toBe("Song of Songs 1:2");
  });

  it("Philemon: PHM.1.6", () => {
    expect(usfmToHuman("PHM.1.6")).toBe("Philemon 1:6");
  });

  it("PHP (Philippians): PHP.1.6", () => {
    expect(usfmToHuman("PHP.1.6")).toBe("Philippians 1:6");
  });

  it("REV (last book): REV.22.21", () => {
    expect(usfmToHuman("REV.22.21")).toBe("Revelation 22:21");
  });

  it("unknown book code: returns raw string", () => {
    expect(usfmToHuman("ZZZ.1.1")).toBe("ZZZ.1.1");
  });
});

describe("usfmSortKey", () => {
  it("GEN.1.1 < GEN.1.2", () => {
    expect(usfmSortKey("GEN.1.1")).toBeLessThan(usfmSortKey("GEN.1.2"));
  });

  it("GEN.1.1 < GEN.2.1", () => {
    expect(usfmSortKey("GEN.1.1")).toBeLessThan(usfmSortKey("GEN.2.1"));
  });

  it("GEN < EXO (canonical order)", () => {
    expect(usfmSortKey("GEN.50.26")).toBeLessThan(usfmSortKey("EXO.1.1"));
  });

  it("REV is the last book", () => {
    expect(usfmSortKey("JUD.25.1")).toBeLessThan(usfmSortKey("REV.1.1"));
  });

  it("multi-verse: uses first verse for sort", () => {
    expect(usfmSortKey("ISA.43.18+ISA.43.19")).toBe(usfmSortKey("ISA.43.18"));
  });
});

describe("BOOK_ORDER", () => {
  it("GEN is book 1", () => {
    expect(BOOK_ORDER["GEN"]).toBe(1);
  });

  it("REV is book 66", () => {
    expect(BOOK_ORDER["REV"]).toBe(66);
  });

  it("PSA is book 19", () => {
    expect(BOOK_ORDER["PSA"]).toBe(19);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
bun run test:quick 2>&1 | grep -E "usfm|FAIL|error"
```

Expected: failures like `Cannot find module '@/lib/usfm'`.

- [ ] **Step 3: Create src/types/campaign-content.ts**

```typescript
export type CampaignContentRow = {
  id: string;
  campaign: string;
  contentType: string;
  language: string;
  usfmReference: string;
  usfmHuman: string | null;
  title: string | null;
  body: string | null;
  status: string;
};

export type ContentEntry = { id: string; text: string };

export type VerseRow = {
  usfmReference: string;
  usfmHuman: string;
  sortKey: number;
  aTitle: ContentEntry | null;
  bTitle: ContentEntry | null;
  verseText: ContentEntry | null;
};

export type LangSummary = {
  language: string;
  total: number;
  expected: number;
  hasGaps: boolean;
};

export type GapItem = {
  usfmReference: string;
  usfmHuman: string;
  contentType: "a-title" | "b-title" | "verse-text";
  englishText: string | null;
};
```

- [ ] **Step 4: Create src/lib/usfm.ts**

```typescript
const BOOK_NAMES: Record<string, string> = {
  GEN: "Genesis",       EXO: "Exodus",        LEV: "Leviticus",
  NUM: "Numbers",       DEU: "Deuteronomy",   JOS: "Joshua",
  JDG: "Judges",        RUT: "Ruth",          "1SA": "1 Samuel",
  "2SA": "2 Samuel",    "1KI": "1 Kings",     "2KI": "2 Kings",
  "1CH": "1 Chronicles","2CH": "2 Chronicles", EZR: "Ezra",
  NEH: "Nehemiah",      EST: "Esther",        JOB: "Job",
  PSA: "Psalm",         PRO: "Proverbs",      ECC: "Ecclesiastes",
  SNG: "Song of Songs", SOS: "Song of Songs", ISA: "Isaiah",
  JER: "Jeremiah",      LAM: "Lamentations",  EZK: "Ezekiel",
  DAN: "Daniel",        HOS: "Hosea",         JOL: "Joel",
  AMO: "Amos",          OBA: "Obadiah",       JON: "Jonah",
  MIC: "Micah",         NAM: "Nahum",         HAB: "Habakkuk",
  ZEP: "Zephaniah",     HAG: "Haggai",        ZEC: "Zechariah",
  MAL: "Malachi",       MAT: "Matthew",       MRK: "Mark",
  LUK: "Luke",          JHN: "John",          ACT: "Acts",
  ROM: "Romans",        "1CO": "1 Corinthians","2CO": "2 Corinthians",
  GAL: "Galatians",     EPH: "Ephesians",     PHP: "Philippians",
  COL: "Colossians",    "1TH": "1 Thessalonians","2TH": "2 Thessalonians",
  "1TI": "1 Timothy",   "2TI": "2 Timothy",   TIT: "Titus",
  PHM: "Philemon",      HEB: "Hebrews",       JAS: "James",
  "1PE": "1 Peter",     "2PE": "2 Peter",     "1JN": "1 John",
  "2JN": "2 John",      "3JN": "3 John",      JUD: "Jude",
  REV: "Revelation",
};

export const BOOK_ORDER: Record<string, number> = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8,
  "1SA": 9, "2SA": 10, "1KI": 11, "2KI": 12, "1CH": 13, "2CH": 14,
  EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, PRO: 20, ECC: 21,
  SNG: 22, SOS: 22, ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27,
  HOS: 28, JOL: 29, AMO: 30, OBA: 31, JON: 32, MIC: 33, NAM: 34,
  HAB: 35, ZEP: 36, HAG: 37, ZEC: 38, MAL: 39, MAT: 40, MRK: 41,
  LUK: 42, JHN: 43, ACT: 44, ROM: 45, "1CO": 46, "2CO": 47, GAL: 48,
  EPH: 49, PHP: 50, COL: 51, "1TH": 52, "2TH": 53, "1TI": 54, "2TI": 55,
  TIT: 56, PHM: 57, HEB: 58, JAS: 59, "1PE": 60, "2PE": 61, "1JN": 62,
  "2JN": 63, "3JN": 64, JUD: 65, REV: 66,
};

type VersePart = { book: string; chapter: number; verse: number };

function parsePart(part: string): VersePart | null {
  const segments = part.split(".");
  if (segments.length < 3) return null;
  const verse = segments.length === 3
    ? parseInt(segments[2], 10)
    : parseInt(segments[segments.length - 1], 10);
  const chapter = parseInt(segments[segments.length - 2], 10);
  const book = segments.slice(0, segments.length - 2).join(".");
  if (!BOOK_NAMES[book] || isNaN(chapter) || isNaN(verse)) return null;
  return { book, chapter, verse };
}

export function usfmToHuman(usfm: string): string {
  const rawParts = usfm.split("+");
  const parts = rawParts.map(parsePart);
  if (parts.some((p) => p === null)) return usfm;

  const typed = parts as VersePart[];
  const firstName = BOOK_NAMES[typed[0].book];

  if (typed.length === 1) {
    return `${firstName} ${typed[0].chapter}:${typed[0].verse}`;
  }

  const allSameBook = typed.every((p) => p.book === typed[0].book);
  const allSameChapter = allSameBook && typed.every((p) => p.chapter === typed[0].chapter);

  if (allSameChapter) {
    const verses = typed.map((p) => p.verse);
    return `${firstName} ${typed[0].chapter}:${verses[0]}–${verses[verses.length - 1]}`;
  }

  if (allSameBook) {
    const first = typed[0];
    const last = typed[typed.length - 1];
    return `${firstName} ${first.chapter}:${first.verse}–${last.chapter}:${last.verse}`;
  }

  // Cross-book (very rare): expand each part
  return typed.map((p) => `${BOOK_NAMES[p.book]} ${p.chapter}:${p.verse}`).join(", ");
}

export function usfmSortKey(usfm: string): number {
  const firstPart = usfm.split("+")[0];
  const parsed = parsePart(firstPart);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  const order = BOOK_ORDER[parsed.book] ?? 999;
  return order * 1_000_000 + parsed.chapter * 1_000 + parsed.verse;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bun run test:quick 2>&1 | grep -E "usfm|pass|fail" -i
```

Expected: all usfm tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/types/campaign-content.ts src/lib/usfm.ts tests/unit/usfm.test.ts
git commit -m "feat: add USFM utility, shared CampaignContent types, and unit tests"
```

---

### Task 3: Seed Script

**Files:**
- Create: `scripts/seed-resurrection-push.ts`

- [ ] **Step 1: Install js-yaml**

```bash
bun add -D js-yaml @types/js-yaml
```

Expected: `js-yaml` added to `devDependencies` in `package.json`.

- [ ] **Step 2: Create scripts/seed-resurrection-push.ts**

```typescript
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { PrismaClient } from "../src/generated/prisma";
import { usfmToHuman } from "../src/lib/usfm";

const prisma = new PrismaClient();
const CAMPAIGN = "resurrection-push";

function findDropboxBase(): string {
  const cloudBase = path.join(process.env.HOME!, "Library", "CloudStorage");
  if (!fs.existsSync(cloudBase)) {
    throw new Error(`CloudStorage directory not found at ${cloudBase}. Is Dropbox installed?`);
  }

  const dropboxFolder = fs.readdirSync(cloudBase).find((d) =>
    d.toLowerCase().startsWith("dropbox")
  );
  if (!dropboxFolder) {
    throw new Error(`No Dropbox folder found under ${cloudBase}`);
  }

  const accountBase = path.join(cloudBase, dropboxFolder);
  const accountEntries = fs.readdirSync(accountBase);
  if (accountEntries.length === 0) {
    throw new Error(`No entries found under ${accountBase}`);
  }

  // The account folder has a Unicode apostrophe (U+2019) in the name — enumerate rather than hardcode
  return path.join(accountBase, accountEntries[0]);
}

const SOURCES: Array<{ dir: string; contentType: "a-title" | "b-title" | "verse-text" }> = [
  { dir: "sourceA", contentType: "a-title" },
  { dir: "sourceB", contentType: "verse-text" },
  { dir: "sourceC", contentType: "b-title" },
];

async function importSource(
  pushBase: string,
  sourceDir: string,
  contentType: "a-title" | "b-title" | "verse-text"
): Promise<Record<string, number>> {
  const dirPath = path.join(pushBase, sourceDir);
  if (!fs.existsSync(dirPath)) {
    console.warn(`  Warning: ${dirPath} not found — skipping ${contentType}`);
    return {};
  }

  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const langCounts: Record<string, number> = {};
  let totalImported = 0;

  for (const file of files) {
    // Language code is the last dash-separated token before .yml
    // e.g. "2026-Q1-resurrection-Atitle-de.yml" → "de"
    // e.g. "2026-Q1-resurrection-Atitle-zh_CN.yml" → "zh_CN"
    const langMatch = file.match(/-([a-zA-Z_\-]+)\.ya?ml$/);
    if (!langMatch) {
      console.warn(`  Skipping unrecognized filename: ${file}`);
      continue;
    }
    const language = langMatch[1];

    const raw = fs.readFileSync(path.join(dirPath, file), "utf-8");
    const parsed = yaml.load(raw) as Record<string, string> | null;
    if (!parsed || typeof parsed !== "object") {
      console.warn(`  Skipping empty/invalid YAML: ${file}`);
      continue;
    }

    const rows = Object.entries(parsed).map(([usfmReference, text]) => ({
      campaign: CAMPAIGN,
      contentType,
      language,
      usfmReference,
      usfmHuman: usfmToHuman(usfmReference),
      title: contentType !== "verse-text" ? String(text) : null,
      body: contentType === "verse-text" ? String(text) : null,
    }));

    const result = await prisma.campaignContent.createMany({ data: rows, skipDuplicates: true });
    langCounts[language] = (langCounts[language] ?? 0) + result.count;
    totalImported += result.count;
  }

  console.log(
    `  ${contentType}: imported ${totalImported} new rows across ${Object.keys(langCounts).length} languages`
  );
  return langCounts;
}

async function main() {
  console.log("Seeding 2026 Resurrection Push content...\n");

  let dropboxBase: string;
  try {
    dropboxBase = findDropboxBase();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const pushBase = path.join(dropboxBase, "2026 Resurrection Push", "push", "Syntax Fixed");
  if (!fs.existsSync(pushBase)) {
    console.error(`Source not found: ${pushBase}`);
    console.error("Check that the Dropbox folder is synced and the path is correct.");
    process.exit(1);
  }
  console.log(`Source: ${pushBase}\n`);

  const allLangCounts: Record<string, number> = {};
  for (const { dir, contentType } of SOURCES) {
    const counts = await importSource(pushBase, dir, contentType);
    for (const [lang, count] of Object.entries(counts)) {
      allLangCounts[lang] = (allLangCounts[lang] ?? 0) + count;
    }
  }

  // Expected = max count per language (the language with the most rows is "complete")
  const maxCount = Math.max(0, ...Object.values(allLangCounts));
  console.log("\nGap summary (per language):");
  const sorted = Object.entries(allLangCounts).sort(([a], [b]) => a.localeCompare(b));
  for (const [lang, count] of sorted) {
    const gap = maxCount - count;
    const icon = gap > 0 ? "⚠" : "✓";
    const gapStr = gap > 0 ? ` (${gap} missing)` : "";
    console.log(`  ${icon} ${lang.padEnd(6)} ${count} rows${gapStr}`);
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Typecheck the script**

```bash
bun run typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-resurrection-push.ts package.json bun.lock
git commit -m "feat: add resurrection push seed script"
```

Note: Run `bun scripts/seed-resurrection-push.ts` manually after Dropbox is confirmed synced. The script is re-runnable — the `@@unique` constraint prevents duplicates.

---

### Task 4: API Routes

**Files:**
- Create: `src/app/api/campaign-content/route.ts`
- Create: `src/app/api/campaign-content/[id]/route.ts`

- [ ] **Step 1: Create src/app/api/campaign-content/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";

const VALID_CONTENT_TYPES = new Set(["a-title", "b-title", "verse-text"]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const campaign = searchParams.get("campaign");
  const language = searchParams.get("language");

  if (!campaign) {
    return NextResponse.json({ error: "campaign is required" }, { status: 400 });
  }

  try {
    const rows = await prisma.campaignContent.findMany({
      where: {
        campaign,
        status: "active",
        ...(language ? { language } : {}),
      },
      orderBy: [{ language: "asc" }, { usfmReference: "asc" }, { contentType: "asc" }],
    });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("GET /api/campaign-content error:", error);
    return NextResponse.json({ error: "Failed to fetch content" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { campaign, contentType, language, usfmReference, usfmHuman, title, body: msgBody } =
    body as Record<string, unknown>;

  if (typeof campaign !== "string" || !campaign.trim()) {
    return NextResponse.json({ error: "campaign is required" }, { status: 400 });
  }
  if (typeof contentType !== "string" || !VALID_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: "contentType must be a-title, b-title, or verse-text" },
      { status: 400 }
    );
  }
  if (typeof language !== "string" || !language.trim()) {
    return NextResponse.json({ error: "language is required" }, { status: 400 });
  }
  if (typeof usfmReference !== "string" || !usfmReference.trim()) {
    return NextResponse.json({ error: "usfmReference is required" }, { status: 400 });
  }

  const isTitle = contentType !== "verse-text";
  if (isTitle && (typeof title !== "string" || !title.trim())) {
    return NextResponse.json({ error: "title is required for a-title and b-title" }, { status: 400 });
  }
  if (!isTitle && (typeof msgBody !== "string" || !(msgBody as string).trim())) {
    return NextResponse.json({ error: "body is required for verse-text" }, { status: 400 });
  }

  try {
    const row = await prisma.campaignContent.create({
      data: {
        campaign: campaign.trim(),
        contentType,
        language: language.trim(),
        usfmReference: usfmReference.trim(),
        usfmHuman: typeof usfmHuman === "string" ? usfmHuman.trim() || null : null,
        title: isTitle ? (title as string).trim() : null,
        body: !isTitle ? (msgBody as string).trim() : null,
      },
    });
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Content already exists for this campaign/contentType/language/usfmReference combination" },
        { status: 409 }
      );
    }
    console.error("POST /api/campaign-content error:", error);
    return NextResponse.json({ error: "Failed to create content" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create src/app/api/campaign-content/[id]/route.ts**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, body: msgBody, usfmHuman, status } = body as Record<string, unknown>;
  const data: Record<string, string | null> = {};
  if (typeof title === "string") data.title = title.trim() || null;
  if (typeof msgBody === "string") data.body = (msgBody as string).trim() || null;
  if (typeof usfmHuman === "string") data.usfmHuman = usfmHuman.trim() || null;
  if (typeof status === "string") data.status = status;

  try {
    const row = await prisma.campaignContent.update({ where: { id }, data });
    return NextResponse.json({ data: row });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("PATCH /api/campaign-content/[id] error:", error);
    return NextResponse.json({ error: "Failed to update content" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const row = await prisma.campaignContent.update({
      where: { id },
      data: { status: "archived" },
    });
    return NextResponse.json({ data: { id: row.id } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/campaign-content/[id] error:", error);
    return NextResponse.json({ error: "Failed to archive content" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
bun run typecheck
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/campaign-content/
git commit -m "feat: add campaign-content CRUD API routes (GET, POST, PATCH, DELETE)"
```

---

### Task 5: API Integration Tests

**Files:**
- Modify: `tests/helpers/builders.ts`
- Create: `tests/integration/campaign-content.test.ts`

- [ ] **Step 1: Add createCampaignContent builder to tests/helpers/builders.ts**

Append to the end of `tests/helpers/builders.ts`:

```typescript
export async function createCampaignContent(overrides: {
  campaign?: string;
  contentType?: string;
  language?: string;
  usfmReference?: string;
  usfmHuman?: string | null;
  title?: string | null;
  body?: string | null;
  status?: string;
} = {}) {
  const contentType = overrides.contentType ?? "a-title";
  const isTitle = contentType !== "verse-text";
  return prisma.campaignContent.create({
    data: {
      campaign: "resurrection-push",
      contentType,
      language: "en",
      usfmReference: "ISA.43.18",
      usfmHuman: "Isaiah 43:18",
      title: isTitle ? "Test A-Title" : null,
      body: !isTitle ? "Test verse body" : null,
      status: "active",
      ...overrides,
    },
  });
}
```

- [ ] **Step 2: Write the failing integration tests**

Create `tests/integration/campaign-content.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mock } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll, prisma } from "../helpers/db";
import { createCampaignContent } from "../helpers/builders";
import { buildRequest } from "../helpers/request";

// Mutable auth state — null user = unauthenticated
const mockAuth: {
  user: { id: string; email: string; firstName: null; lastName: null } | null;
} = {
  user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
};

mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: mockAuth.user,
      roles: [],
      sessionId: "sess1",
      accessToken: "tok1",
    }),
  signOut: async () => {},
}));

// Import AFTER mock.module so the mock takes effect
const { GET, POST } = await import("@/app/api/campaign-content/route");
const { PATCH, DELETE } = await import("@/app/api/campaign-content/[id]/route");

beforeEach(async () => {
  await truncateAll();
  mockAuth.user = { id: "u1", email: "test@youversion.com", firstName: null, lastName: null };
});
afterEach(async () => {
  await truncateAll();
});

describe("GET /api/campaign-content", () => {
  it("requires campaign param", async () => {
    const req = new Request("http://localhost/api/campaign-content") as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns active rows for campaign", async () => {
    await createCampaignContent({ campaign: "resurrection-push", language: "en", usfmReference: "GEN.1.1", contentType: "a-title", title: "In the beginning…" });
    await createCampaignContent({ campaign: "resurrection-push", language: "en", usfmReference: "GEN.1.2", contentType: "b-title", title: "Genesis 1:2" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
  });

  it("filters by language when provided", async () => {
    await createCampaignContent({ language: "en", usfmReference: "GEN.1.1", contentType: "a-title", title: "EN title" });
    await createCampaignContent({ language: "de", usfmReference: "GEN.1.1", contentType: "a-title", title: "DE title" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push&language=de") as NextRequest;
    const res = await GET(req);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].language).toBe("de");
  });

  it("excludes archived rows", async () => {
    await createCampaignContent({ usfmReference: "GEN.1.1", status: "active", contentType: "a-title", title: "Active" });
    await createCampaignContent({ usfmReference: "GEN.1.2", status: "archived", contentType: "a-title", title: "Archived" });

    const req = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const res = await GET(req);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Active");
  });
});

describe("POST /api/campaign-content", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "GEN.1.1",
      title: "Test",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid contentType", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "invalid-type",
      language: "de",
      usfmReference: "GEN.1.1",
      title: "Test",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/contentType/);
  });

  it("creates a-title row and returns 201", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "ISA.43.18",
      usfmHuman: "Isaiah 43:18",
      title: "🌱 Gott wird etwas Neues tun…",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.contentType).toBe("a-title");
    expect(body.data.language).toBe("de");
    expect(body.data.title).toBe("🌱 Gott wird etwas Neues tun…");
  });

  it("returns 409 on duplicate", async () => {
    await createCampaignContent({ usfmReference: "ISA.43.18", contentType: "a-title", language: "de", title: "Existing" });

    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "a-title",
      language: "de",
      usfmReference: "ISA.43.18",
      title: "Duplicate",
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it("requires body for verse-text contentType", async () => {
    const req = buildRequest("POST", {
      campaign: "resurrection-push",
      contentType: "verse-text",
      language: "en",
      usfmReference: "ISA.43.18",
      // body omitted intentionally
    }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/body/);
  });
});

describe("PATCH /api/campaign-content/[id]", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    const row = await createCampaignContent({ usfmReference: "GEN.1.1", contentType: "a-title", title: "Original" });
    const req = buildRequest("PATCH", { title: "Updated" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const req = buildRequest("PATCH", { title: "Updated" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("updates title and returns the row", async () => {
    const row = await createCampaignContent({ usfmReference: "GEN.1.1", contentType: "a-title", title: "Original" });
    const req = buildRequest("PATCH", { title: "Updated title" }) as NextRequest;
    const res = await PATCH(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Updated title");

    const inDb = await prisma.campaignContent.findUnique({ where: { id: row.id } });
    expect(inDb!.title).toBe("Updated title");
  });
});

describe("DELETE /api/campaign-content/[id]", () => {
  it("returns 403 when unauthenticated", async () => {
    mockAuth.user = null;
    const row = await createCampaignContent({ usfmReference: "GEN.1.1" });
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
  });

  it("soft-deletes by setting status=archived and returns id", async () => {
    const row = await createCampaignContent({ usfmReference: "GEN.1.1" });
    const req = buildRequest("DELETE") as NextRequest;
    const res = await DELETE(req, { params: Promise.resolve({ id: row.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(row.id);

    const inDb = await prisma.campaignContent.findUnique({ where: { id: row.id } });
    expect(inDb!.status).toBe("archived");

    // Verify excluded from GET
    const getReq = new Request("http://localhost/api/campaign-content?campaign=resurrection-push") as NextRequest;
    const getRes = await GET(getReq);
    const getBody = await getRes.json();
    expect(getBody.data.map((r: { id: string }) => r.id)).not.toContain(row.id);
  });
});
```

- [ ] **Step 3: Run integration tests**

```bash
bun run test:int 2>&1 | grep -E "campaign-content|pass|fail" -i
```

Expected: all campaign-content integration tests pass.

- [ ] **Step 4: Run full quick check**

```bash
bun run check:quick
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/helpers/builders.ts tests/integration/campaign-content.test.ts
git commit -m "test: add campaign-content builder + API integration tests"
```

---

### Task 6: Push Library Server Page

**Files:**
- Replace: `src/app/push-library/page.tsx`

- [ ] **Step 1: Replace src/app/push-library/page.tsx**

```typescript
export const revalidate = 0;

import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { usfmToHuman, usfmSortKey } from "@/lib/usfm";
import { VerseLibraryClient } from "@/components/push-library/verse-library-client";
import type { VerseRow, LangSummary, GapItem } from "@/types/campaign-content";

const CAMPAIGN = "resurrection-push";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

export default async function PushLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ language?: string }>;
}) {
  const { language: langParam } = await searchParams;
  const activeLanguage = langParam ?? "en";
  const { user } = await getAuth();

  const allRows = await prisma.campaignContent.findMany({
    where: { campaign: CAMPAIGN, status: "active" },
    select: {
      id: true,
      contentType: true,
      language: true,
      usfmReference: true,
      usfmHuman: true,
      title: true,
      body: true,
    },
    orderBy: [{ language: "asc" }, { usfmReference: "asc" }],
  });

  // Compute language summaries using en as canonical
  const enRows = allRows.filter((r) => r.language === "en");
  const expectedCount = enRows.length; // 270 = 90 refs × 3 types

  const langCounts = new Map<string, number>();
  for (const r of allRows) {
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }

  const langSummaries: LangSummary[] = Array.from(langCounts.entries())
    .map(([language, total]) => ({
      language,
      total,
      expected: expectedCount,
      hasGaps: total < expectedCount,
    }))
    .sort((a, b) => {
      if (a.language === "en") return -1;
      if (b.language === "en") return 1;
      return a.language.localeCompare(b.language);
    });

  // Build en reference map: usfmRef:contentType → text
  const enRefMap = new Map(enRows.map((r) => [`${r.usfmReference}:${r.contentType}`, r]));

  // All USFM refs present in en (canonical set)
  const allRefs = Array.from(new Set(enRows.map((r) => r.usfmReference)));

  // Build verse rows for the active language
  const langRows = allRows.filter((r) => r.language === activeLanguage);
  const langByKey = new Map(langRows.map((r) => [`${r.usfmReference}:${r.contentType}`, r]));

  const verseRows: VerseRow[] = allRefs
    .map((usfmReference) => {
      const human = enRefMap.get(`${usfmReference}:a-title`)
        ? usfmToHuman(usfmReference)
        : usfmToHuman(usfmReference);

      const aTitleRow = langByKey.get(`${usfmReference}:a-title`);
      const bTitleRow = langByKey.get(`${usfmReference}:b-title`);
      const verseTextRow = langByKey.get(`${usfmReference}:verse-text`);

      return {
        usfmReference,
        usfmHuman: human,
        sortKey: usfmSortKey(usfmReference),
        aTitle: aTitleRow ? { id: aTitleRow.id, text: aTitleRow.title ?? "" } : null,
        bTitle: bTitleRow ? { id: bTitleRow.id, text: bTitleRow.title ?? "" } : null,
        verseText: verseTextRow ? { id: verseTextRow.id, text: verseTextRow.body ?? "" } : null,
      };
    })
    .sort((a, b) => a.sortKey - b.sortKey);

  // Compute gaps for active language
  const gaps: GapItem[] = [];
  for (const row of verseRows) {
    if (!row.aTitle) {
      const en = enRefMap.get(`${row.usfmReference}:a-title`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "a-title", englishText: en?.title ?? null });
    }
    if (!row.bTitle) {
      const en = enRefMap.get(`${row.usfmReference}:b-title`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "b-title", englishText: en?.title ?? null });
    }
    if (!row.verseText) {
      const en = enRefMap.get(`${row.usfmReference}:verse-text`);
      gaps.push({ usfmReference: row.usfmReference, usfmHuman: row.usfmHuman, contentType: "verse-text", englishText: en?.body ?? null });
    }
  }

  // English reference data for edit modal (each ref → {aTitle, bTitle, verseText})
  const enByRef: Record<string, { aTitle?: string; bTitle?: string; verseText?: string }> = {};
  for (const r of enRows) {
    if (!enByRef[r.usfmReference]) enByRef[r.usfmReference] = {};
    const text = r.title ?? r.body ?? "";
    if (r.contentType === "a-title") enByRef[r.usfmReference].aTitle = text;
    else if (r.contentType === "b-title") enByRef[r.usfmReference].bTitle = text;
    else if (r.contentType === "verse-text") enByRef[r.usfmReference].verseText = text;
  }

  // All unique en refs for add-language drawer (90 refs with their English text)
  const enVerseRefs: EnVerseRef[] = allRefs
    .map((usfmReference) => ({
      usfmReference,
      usfmHuman: usfmToHuman(usfmReference),
      enATitle: enByRef[usfmReference]?.aTitle,
      enBTitle: enByRef[usfmReference]?.bTitle,
      enVerseText: enByRef[usfmReference]?.verseText,
    }))
    .sort((a, b) => usfmSortKey(a.usfmReference) - usfmSortKey(b.usfmReference));

  return (
    <VerseLibraryClient
      campaign={CAMPAIGN}
      activeLanguage={activeLanguage}
      langSummaries={langSummaries}
      verseRows={verseRows}
      gaps={gaps}
      enByRef={enByRef}
      enVerseRefs={enVerseRefs}
      isAuthenticated={!!user}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: errors about missing `VerseLibraryClient` component — that's fine, it'll be created in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/app/push-library/page.tsx
git commit -m "feat: replace push-library redirect with real server component"
```

---

### Task 7: VerseLibraryClient

**Files:**
- Create: `src/components/push-library/verse-library-client.tsx`

- [ ] **Step 1: Create src/components/push-library/verse-library-client.tsx**

```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VerseRow, LangSummary, GapItem } from "@/types/campaign-content";
import { EditContentModal } from "./edit-content-modal";
import { AddLanguageDrawer } from "./add-language-drawer";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

type Props = {
  campaign: string;
  activeLanguage: string;
  langSummaries: LangSummary[];
  verseRows: VerseRow[];
  gaps: GapItem[];
  enByRef: Record<string, { aTitle?: string; bTitle?: string; verseText?: string }>;
  enVerseRefs: EnVerseRef[];
  isAuthenticated: boolean;
};

type EditTarget = {
  usfmReference: string;
  usfmHuman: string;
  prefillContentType?: "a-title" | "b-title" | "verse-text";
  aTitleId?: string;
  bTitleId?: string;
  verseTextId?: string;
};

export function VerseLibraryClient({
  campaign,
  activeLanguage,
  langSummaries,
  verseRows,
  gaps,
  enByRef,
  enVerseRefs,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openEdit(row: VerseRow, prefillContentType?: "a-title" | "b-title" | "verse-text") {
    setEditTarget({
      usfmReference: row.usfmReference,
      usfmHuman: row.usfmHuman,
      prefillContentType,
      aTitleId: row.aTitle?.id,
      bTitleId: row.bTitle?.id,
      verseTextId: row.verseText?.id,
    });
  }

  function openGap(gap: GapItem) {
    const row = verseRows.find((r) => r.usfmReference === gap.usfmReference);
    if (row) openEdit(row, gap.contentType);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Verse Push Library</h1>
        <span className="text-sm text-muted-foreground capitalize">
          {campaign.replace(/-/g, " ")}
        </span>
      </div>

      {/* Language tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {langSummaries.map((ls) => (
          <button
            key={ls.language}
            onClick={() => router.push(`/push-library?language=${ls.language}`)}
            className={[
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
              ls.language === activeLanguage
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80",
            ].join(" ")}
          >
            {ls.language}{" "}
            <span className={ls.hasGaps ? "text-amber-500" : "text-green-600"}>
              {ls.hasGaps ? `⚠ ${Math.floor(ls.total / 3)}` : `✓ ${Math.floor(ls.total / 3)}`}
            </span>
          </button>
        ))}
        {isAuthenticated && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
          >
            + Add Language
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/50">
            <tr className="border-b text-left">
              <th className="py-2 px-3 font-medium text-muted-foreground w-36">USFM Ref</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">A-Title</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">B-Title</th>
              <th className="py-2 px-3 font-medium text-muted-foreground">Verse Text</th>
              {isAuthenticated && (
                <th className="py-2 px-3 font-medium text-muted-foreground w-16">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {verseRows.map((row) => (
              <tr key={row.usfmReference} className="border-b hover:bg-muted/20">
                <td className="py-2 px-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {row.usfmHuman}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.aTitle ? (
                    <span className="line-clamp-1">{row.aTitle.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.bTitle ? (
                    <span className="line-clamp-1">{row.bTitle.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                <td className="py-2 px-3 max-w-xs">
                  {row.verseText ? (
                    <span className="line-clamp-1">{row.verseText.text}</span>
                  ) : (
                    <span className="text-amber-500 text-xs">missing</span>
                  )}
                </td>
                {isAuthenticated && (
                  <td className="py-2 px-3">
                    <button
                      onClick={() => openEdit(row)}
                      className="text-xs text-primary hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {verseRows.length === 0 && (
              <tr>
                <td
                  colSpan={isAuthenticated ? 5 : 4}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No content for language "{activeLanguage}" yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Gap panel */}
      {gaps.length > 0 && (
        <details open className="border rounded-lg p-4">
          <summary className="font-medium text-sm cursor-pointer select-none">
            ⚠ {gaps.length} missing entr{gaps.length === 1 ? "y" : "ies"} for &quot;{activeLanguage}&quot;
          </summary>
          <div className="mt-3 space-y-1">
            {gaps.map((gap, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-sm py-1.5 border-b last:border-0"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-mono text-xs text-muted-foreground w-28 shrink-0">
                    {gap.usfmHuman}
                  </span>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                    {gap.contentType}
                  </span>
                  {gap.englishText && (
                    <span className="text-xs text-muted-foreground truncate">
                      {gap.englishText}
                    </span>
                  )}
                </div>
                {isAuthenticated && (
                  <button
                    onClick={() => openGap(gap)}
                    className="text-xs text-primary hover:underline ml-2 shrink-0"
                  >
                    Add
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Edit modal */}
      {editTarget && (
        <EditContentModal
          campaign={campaign}
          language={activeLanguage}
          usfmReference={editTarget.usfmReference}
          usfmHuman={editTarget.usfmHuman}
          prefillContentType={editTarget.prefillContentType}
          aTitleId={editTarget.aTitleId}
          bTitleId={editTarget.bTitleId}
          verseTextId={editTarget.verseTextId}
          enRef={enByRef[editTarget.usfmReference] ?? {}}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}

      {/* Add language drawer */}
      {drawerOpen && (
        <AddLanguageDrawer
          campaign={campaign}
          verseRefs={enVerseRefs}
          onClose={() => setDrawerOpen(false)}
          onSaved={() => {
            setDrawerOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: errors about missing `EditContentModal` and `AddLanguageDrawer` — those are created in Tasks 8 and 9.

- [ ] **Step 3: Commit**

```bash
git add src/components/push-library/verse-library-client.tsx
git commit -m "feat: add VerseLibraryClient with language tabs, table, and gap panel"
```

---

### Task 8: Edit Content Modal

**Files:**
- Create: `src/components/push-library/edit-content-modal.tsx`

- [ ] **Step 1: Create src/components/push-library/edit-content-modal.tsx**

```typescript
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Props = {
  campaign: string;
  language: string;
  usfmReference: string;
  usfmHuman: string;
  prefillContentType?: "a-title" | "b-title" | "verse-text";
  aTitleId?: string;
  bTitleId?: string;
  verseTextId?: string;
  enRef: { aTitle?: string; bTitle?: string; verseText?: string };
  onClose: () => void;
  onSaved: () => void;
};

async function upsertRow(
  id: string | undefined,
  params: {
    campaign: string;
    language: string;
    usfmReference: string;
    contentType: string;
    text: string;
  }
): Promise<void> {
  const isTitle = params.contentType !== "verse-text";
  const payload = isTitle
    ? { title: params.text }
    : { body: params.text };

  if (id) {
    await fetch(`/api/campaign-content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await fetch("/api/campaign-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign: params.campaign,
        language: params.language,
        usfmReference: params.usfmReference,
        contentType: params.contentType,
        ...payload,
      }),
    });
  }
}

export function EditContentModal({
  campaign,
  language,
  usfmReference,
  usfmHuman,
  aTitleId,
  bTitleId,
  verseTextId,
  enRef,
  onClose,
  onSaved,
}: Props) {
  const [aTitle, setATitle] = useState("");
  const [bTitle, setBTitle] = useState("");
  const [verseText, setVerseText] = useState("");
  const [saving, setSaving] = useState(false);

  const hasChanges = aTitle.trim() || bTitle.trim() || verseText.trim();

  async function handleSave() {
    setSaving(true);
    const tasks: Promise<void>[] = [];

    if (aTitle.trim()) {
      tasks.push(
        upsertRow(aTitleId, { campaign, language, usfmReference, contentType: "a-title", text: aTitle.trim() })
      );
    }
    if (bTitle.trim()) {
      tasks.push(
        upsertRow(bTitleId, { campaign, language, usfmReference, contentType: "b-title", text: bTitle.trim() })
      );
    }
    if (verseText.trim()) {
      tasks.push(
        upsertRow(verseTextId, { campaign, language, usfmReference, contentType: "verse-text", text: verseText.trim() })
      );
    }

    await Promise.all(tasks);
    setSaving(false);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit — {usfmHuman}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>A-Title <span className="text-xs text-muted-foreground font-normal">(clickbait)</span></Label>
            <Textarea
              value={aTitle}
              onChange={(e) => setATitle(e.target.value)}
              placeholder="e.g. 🌱 God is about to do something new…"
              rows={2}
            />
            {enRef.aTitle && (
              <p className="text-xs text-muted-foreground">EN: {enRef.aTitle}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>B-Title <span className="text-xs text-muted-foreground font-normal">(verse reference)</span></Label>
            <Textarea
              value={bTitle}
              onChange={(e) => setBTitle(e.target.value)}
              placeholder="e.g. Reflect on Isaiah 43:18-19 today."
              rows={2}
            />
            {enRef.bTitle && (
              <p className="text-xs text-muted-foreground">EN: {enRef.bTitle}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Verse Text</Label>
            <Textarea
              value={verseText}
              onChange={(e) => setVerseText(e.target.value)}
              placeholder="Enter the verse text…"
              rows={4}
            />
            {enRef.verseText && (
              <p className="text-xs text-muted-foreground">EN: {enRef.verseText}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: only the AddLanguageDrawer error remains (from Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/components/push-library/edit-content-modal.tsx
git commit -m "feat: add EditContentModal for adding/editing verse push content"
```

---

### Task 9: Add Language Drawer

**Files:**
- Create: `src/components/push-library/add-language-drawer.tsx`

- [ ] **Step 1: Create src/components/push-library/add-language-drawer.tsx**

```typescript
"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

type Props = {
  campaign: string;
  verseRefs: EnVerseRef[];
  onClose: () => void;
  onSaved: () => void;
};

type Translations = Record<string, { aTitle: string; bTitle: string; verseText: string }>;

export function AddLanguageDrawer({ campaign, verseRefs, onClose, onSaved }: Props) {
  const [step, setStep] = useState<"code" | "translate">("code");
  const [langCode, setLangCode] = useState("");
  const [translations, setTranslations] = useState<Translations>({});
  const [saving, setSaving] = useState(false);

  function setField(ref: string, field: "aTitle" | "bTitle" | "verseText", value: string) {
    setTranslations((prev) => ({
      ...prev,
      [ref]: {
        aTitle: "",
        bTitle: "",
        verseText: "",
        ...prev[ref],
        [field]: value,
      },
    }));
  }

  async function handleSave() {
    setSaving(true);
    const tasks: Promise<Response>[] = [];

    for (const [usfmReference, vals] of Object.entries(translations)) {
      if (vals.aTitle.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "a-title",
              title: vals.aTitle.trim(),
            }),
          })
        );
      }
      if (vals.bTitle.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "b-title",
              title: vals.bTitle.trim(),
            }),
          })
        );
      }
      if (vals.verseText.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "verse-text",
              body: vals.verseText.trim(),
            }),
          })
        );
      }
    }

    await Promise.all(tasks);
    setSaving(false);
    onSaved();
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[640px] sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Language</SheetTitle>
        </SheetHeader>

        {step === "code" ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>ISO Language Code</Label>
              <Input
                value={langCode}
                onChange={(e) => setLangCode(e.target.value.trim())}
                placeholder="e.g. pt-BR, de, zh_CN, fr"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This must match the language code used in your YAML files.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!langCode} onClick={() => setStep("translate")}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Language: <strong>{langCode}</strong> — fill in translations. Partial saves are fine.
              </p>
              <button
                className="text-xs text-muted-foreground hover:underline"
                onClick={() => setStep("code")}
              >
                Change code
              </button>
            </div>

            <div className="space-y-6 pb-24">
              {verseRefs.map((ref) => (
                <div key={ref.usfmReference} className="border rounded-lg p-3 space-y-3">
                  <p className="text-sm font-medium">{ref.usfmHuman}</p>
                  <div className="space-y-1">
                    <Label className="text-xs">A-Title</Label>
                    <Input
                      value={translations[ref.usfmReference]?.aTitle ?? ""}
                      onChange={(e) => setField(ref.usfmReference, "aTitle", e.target.value)}
                      placeholder={ref.enATitle ?? ""}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">B-Title</Label>
                    <Input
                      value={translations[ref.usfmReference]?.bTitle ?? ""}
                      onChange={(e) => setField(ref.usfmReference, "bTitle", e.target.value)}
                      placeholder={ref.enBTitle ?? ""}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Verse Text</Label>
                    <Input
                      value={translations[ref.usfmReference]?.verseText ?? ""}
                      onChange={(e) => setField(ref.usfmReference, "verseText", e.target.value)}
                      placeholder={ref.enVerseText ?? ""}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="fixed bottom-0 right-0 w-[640px] flex justify-end gap-2 bg-background border-t px-6 py-3">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Translations"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Run full typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 3: Run full quick check**

```bash
bun run check:quick
```

Expected: all tests pass, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/push-library/add-language-drawer.tsx
git commit -m "feat: add AddLanguageDrawer for bulk-adding a new translation language"
```

---

### Task 10: Run Seed + Smoke Test + Final Check

**Files:** No new files.

- [ ] **Step 1: Start dev server and verify the page compiles**

```bash
bun run dev
```

Open http://localhost:3000/push-library in a browser. You should see the Verse Push Library UI (empty — no data yet).

- [ ] **Step 2: Run seed script to import Dropbox content**

Ensure Dropbox is fully synced first. Then:

```bash
bun scripts/seed-resurrection-push.ts
```

Expected output (approximate):
```
Seeding 2026 Resurrection Push content...
Source: /Users/.../2026 Resurrection Push/push/Syntax Fixed

  a-title: imported NNNN new rows across 20 languages
  verse-text: imported NNNN new rows across 20 languages
  b-title: imported NNNN new rows across 20 languages

Gap summary (per language):
  ✓ de     270 rows
  ✓ en     270 rows
  ...

Done.
```

- [ ] **Step 3: Verify the page shows data**

Reload http://localhost:3000/push-library. You should see:
- Language tabs with ✓90 for complete languages or ⚠N for incomplete ones
- Table with USFM refs in canonical Bible order (Genesis → Revelation)
- Missing cells shown in amber "missing"
- Gap panel (if any gaps exist)

- [ ] **Step 4: Test authenticated flow**

Log in and verify:
- "Edit" buttons appear on each row
- Clicking "Edit" opens the modal with 3 text areas and English reference text
- "+ Add Language" button appears in the tab row

- [ ] **Step 5: Run the full check**

```bash
bun run check
```

Expected: all tests pass, no lint errors, no type errors.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: verse push library — complete implementation"
```

---

## Self-Review

### 1. Spec Coverage Check

| Spec requirement | Task |
|---|---|
| New `CampaignContent` model (all fields, `@@unique`, `@@index`) | Task 1 |
| `usfmToHuman()` with book codes, multi-verse collapse, cross-chapter | Task 2 |
| `BOOK_ORDER` for canonical sort | Task 2 |
| Seed script from `sourceA/B/C` with js-yaml | Task 3 |
| Re-runnable via `skipDuplicates: true` | Task 3 |
| `GET /api/campaign-content` with campaign/language params | Task 4 |
| `POST /api/campaign-content` with auth guard + validation | Task 4 |
| `PATCH /api/campaign-content/[id]` partial update | Task 4 |
| `DELETE /api/campaign-content/[id]` soft delete | Task 4 |
| All 4 routes integration-tested | Task 5 |
| Language tabs with ✓/⚠ badges | Task 6 + 7 |
| Table with USFM Ref, A-Title, B-Title, Verse Text | Task 7 |
| Gap panel (collapsible `<details>`) | Task 7 |
| Edit modal with 3 text areas + English reference | Task 8 |
| Add Language drawer (2-step) | Task 9 |
| Auth guards: mutations require auth, GET is public | Tasks 4, 7 |
| Seed gap summary log | Task 3 |
| Unit tests for USFM utility | Task 2 |

All spec requirements covered.

### 2. Placeholder Scan

No "TBD", "TODO", or incomplete steps found.

### 3. Type Consistency

- `ContentEntry`, `VerseRow`, `LangSummary`, `GapItem` defined in Task 2 (`src/types/campaign-content.ts`), used in Tasks 6, 7, 8
- `EnVerseRef` type is defined locally in `verse-library-client.tsx` and `add-language-drawer.tsx` (same shape in both — duplicated intentionally since it's small and the components are standalone)
- `EditTarget` type defined in `verse-library-client.tsx`, used only there
- `usfmToHuman`, `usfmSortKey`, `BOOK_ORDER` defined in Task 2, used in Tasks 3 and 6
- `getAuth()` returns `{ user, isAdmin }` — routes use `user` for auth guard (not `isAdmin`), consistent with spec ("Authenticated users can add/edit")
