# Dynamic Daily Guided Scripture / Guided Prayer Pushes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push library variants whose copy is liquid-style tags (`{{votd_reference}}` etc.) resolved at send time to today's localized Verse of the Day, per user-local date and language, with an optional per-variant verse image.

**Architecture:** A `VotdDailyContent` cache table (immutable rows, `@@unique([date, languageTag])`) is lazily filled from three YouVersion APIs. The cron route pre-fetches all needed `(date, language)` rows (`prepareVotdContent`) because `groupDecisionsByVariant` is **pure** (no DB/network); the pure grouping code substitutes tags per user via a shared resolution helper (`resolveVotdUserKey`). The image option rides on `iconImageUrl = VERSE_IMAGE_SENTINEL` (NOT a subcategory — `sanitizeVariant` drops subcategory when cloning library templates but keeps `iconImageUrl`).

**Tech Stack:** Next.js App Router route handlers, Prisma v7 (additive DDL only — never `prisma migrate dev`), bun:test, YouVersion moments/bible/images APIs.

**Spec:** `docs/superpowers/specs/2026-06-11-dynamic-daily-guided-pushes-design.md` (commit d8356f9). Two approved deviations: (1) image flag uses `iconImageUrl` sentinel instead of `votd-dynamic-image` subcategory; (2) verse text uses `verses.json?references[]=…&id=…&format=text` (plural, plain text) instead of `verse.json`.

**Worktree note:** Work happens directly in `/Users/danluk/repos/nexus` on a feature branch (solo repo; established workflow). Direct pushes to `main` are hook-blocked — ship via `glab mr create` + `glab mr merge`.

---

## Task 0: Feature branch + recover spec commit

The spec commit `d8356f9` accidentally landed on the already-merged leftover branch `fix/personas-prerender-and-agent-card-crush`. Cherry-pick it onto a fresh branch.

**Files:** none (git only)

- [ ] **Step 0.1: Create branch from fresh main and cherry-pick the spec**

```bash
git checkout main && git pull && git checkout -b feat/votd-dynamic-guided-pushes && git cherry-pick d8356f9
```

Expected: cherry-pick applies cleanly; `docs/superpowers/specs/2026-06-11-dynamic-daily-guided-pushes-design.md` exists on the new branch.

- [ ] **Step 0.2: Verify**

```bash
ls docs/superpowers/specs/2026-06-11-dynamic-daily-guided-pushes-design.md && git log --oneline -2
```

Note: `docs/json/new_conversion_logic.md` is an untracked file owned by the user — **never stage it**.

---

## Task 1: `VotdDailyContent` model + additive DDL

**Files:**
- Modify: `prisma/schema.prisma` (append model)
- DDL applied to prod (via `prisma db execute`) and to local `nexus_test` (via psql)

<EXTREMELY-IMPORTANT>
NEVER run `npx prisma migrate dev` or `npx prisma db push`. `prisma.config.ts` loads `.env.local` = the **production** DB, and drift forces a full-reset prompt — never accept. Additive DDL via `npx prisma db execute --stdin` only.
</EXTREMELY-IMPORTANT>

- [ ] **Step 1.1: Append the model to `prisma/schema.prisma`**

```prisma
/// Immutable per-day, per-language VOTD cache. A given day's VOTD never changes.
model VotdDailyContent {
  id              String   @id @default(cuid())
  date            String   // "YYYY-MM-DD" — user-local calendar date
  languageTag     String   // normalized content language, e.g. "en", "es", "zh_CN"
  usfm            String   // e.g. "JHN.3.16" (multi-verse joined with "+")
  reference       String   // localized human reference, e.g. "Juan 3:16"
  verseText       String
  versionId       Int      // Bible version id used for this language
  imageUrlIos     String?  // rendered 320x320
  imageUrlAndroid String?  // rendered 1024x512
  createdAt       DateTime @default(now())

  @@unique([date, languageTag])
}
```

- [ ] **Step 1.2: Apply DDL to production (additive, idempotent)**

```bash
cat <<'SQL' | npx prisma db execute --stdin
CREATE TABLE IF NOT EXISTS "VotdDailyContent" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL,
  "languageTag" TEXT NOT NULL,
  "usfm" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "verseText" TEXT NOT NULL,
  "versionId" INTEGER NOT NULL,
  "imageUrlIos" TEXT,
  "imageUrlAndroid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "VotdDailyContent_date_languageTag_key"
  ON "VotdDailyContent"("date", "languageTag");
SQL
```

Expected: `Script executed successfully.` (May need `dangerouslyDisableSandbox: true` for network access.)

- [ ] **Step 1.3: Apply the same DDL to the local test DB**

```bash
psql -v ON_ERROR_STOP=1 "postgresql://localhost:5432/nexus_test" <<'SQL'
CREATE TABLE IF NOT EXISTS "VotdDailyContent" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL,
  "languageTag" TEXT NOT NULL,
  "usfm" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "verseText" TEXT NOT NULL,
  "versionId" INTEGER NOT NULL,
  "imageUrlIos" TEXT,
  "imageUrlAndroid" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "VotdDailyContent_date_languageTag_key"
  ON "VotdDailyContent"("date", "languageTag");
SQL
```

Expected: `CREATE TABLE` / `CREATE INDEX`.

- [ ] **Step 1.4: Regenerate the Prisma client (both generators)**

```bash
npx prisma generate
```

Expected: generates to `src/generated/prisma` AND `apps/api/src/generated/prisma`.

- [ ] **Step 1.5: Typecheck + commit**

```bash
bun run typecheck && git add prisma/schema.prisma src/generated/prisma apps/api/src/generated/prisma && git commit -m "feat(votd): add VotdDailyContent cache table (additive DDL applied)"
```

(If generated dirs are gitignored, `git add` will skip them — commit whatever is tracked; do not force-add.)

---

## Task 2: `src/lib/votd/version-map.ts` — language → Bible version

Ported from alfred `votd/braze_connected_content/03_get_verse_text.yml` lines 42–182.

**Files:**
- Create: `src/lib/votd/version-map.ts`
- Test: `tests/unit/votd-version-map.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// tests/unit/votd-version-map.test.ts
import { describe, it, expect } from "bun:test";
import { VERSION_MAP, DEFAULT_VERSION_ID, contentLanguageFor, versionForLanguage } from "@/lib/votd/version-map";

describe("contentLanguageFor", () => {
  it("resolves a full regional tag present in the map", () => {
    expect(contentLanguageFor("en-GB")).toBe("en_GB");
    expect(contentLanguageFor("zh-tw")).toBe("zh_TW");
  });
  it("falls back to the primary subtag when the full tag is unmapped", () => {
    expect(contentLanguageFor("es-ES")).toBe("es");
    expect(contentLanguageFor("pt-BR")).toBe("pt");
  });
  it("falls back to en for unknown, blank, and null tags", () => {
    expect(contentLanguageFor("zz")).toBe("en");
    expect(contentLanguageFor("")).toBe("en");
    expect(contentLanguageFor(null)).toBe("en");
    expect(contentLanguageFor(undefined)).toBe("en");
    expect(contentLanguageFor("zh")).toBe("en"); // bare zh is not in the map
  });
});

describe("versionForLanguage", () => {
  it("returns the mapped version id", () => {
    expect(versionForLanguage("es")).toBe(149);
    expect(versionForLanguage("zh_CN")).toBe(48);
    expect(versionForLanguage("en")).toBe(111);
  });
  it("defaults to NIV (111) for unmapped tags", () => {
    expect(versionForLanguage("zz")).toBe(DEFAULT_VERSION_ID);
    expect(DEFAULT_VERSION_ID).toBe(111);
  });
  it("map has ~70 entries", () => {
    expect(Object.keys(VERSION_MAP).length).toBeGreaterThanOrEqual(68);
  });
});
```

- [ ] **Step 2.2: Run it — expect FAIL (module not found)**

```bash
bun test tests/unit/votd-version-map.test.ts
```

- [ ] **Step 2.3: Implement**

```typescript
// src/lib/votd/version-map.ts
import { normalizePushLocaleTag } from "@/lib/push-locale";

export const DEFAULT_VERSION_ID = 111; // NIV

/** Language tag → YouVersion Bible version id. Ported from alfred
 *  votd/braze_connected_content/03_get_verse_text.yml. Keys use the
 *  normalized push-locale form (underscore + uppercase region). */
export const VERSION_MAP: Record<string, number> = {
  af: 6, am: 1260, ar: 101, be: 1723, ca: 335, cy: 394, da: 20, de: 73,
  el: 173, en: 111, en_GB: 113, es: 149, et: 309, fa: 118, fr: 133, gu: 1911,
  he: 380, hi: 819, hr: 39, ht: 1957, hu: 84, hy: 1987, id: 306, ig: 1624,
  is: 2359, it: 123, ja: 81, ka: 2202, km: 85, kn: 1692, ko: 88, ku_IQ: 503,
  ln: 1964, lt: 321, lv: 318, mg: 396, mn: 369, mr: 1686, ms: 402, my: 386,
  ne: 1483, nl: 75, no: 102, pa: 2013, pl: 132, pt: 211, ro: 191, ru: 400,
  sl: 376, sn: 32, sq: 292, sr: 202, sr_cyrillic: 1969, sw: 74, ta: 339,
  te: 1787, th: 174, tl: 399, tr: 170, uk: 186, ur: 187, uz: 1939, ve: 280,
  vi: 151, xh: 282, yo: 911, zh_CN: 48, zh_TW: 46, zu: 286,
};

/** Resolve a raw user language_tag to a VERSION_MAP key: exact (normalized
 *  full tag) → primary subtag → "en". */
export function contentLanguageFor(raw: string | null | undefined): string {
  const norm = normalizePushLocaleTag(raw ?? "");
  if (!norm) return "en";
  if (VERSION_MAP[norm.full] !== undefined) return norm.full;
  if (VERSION_MAP[norm.primary] !== undefined) return norm.primary;
  return "en";
}

export function versionForLanguage(tag: string): number {
  return VERSION_MAP[tag] ?? DEFAULT_VERSION_ID;
}
```

- [ ] **Step 2.4: Run test — expect PASS**

```bash
bun test tests/unit/votd-version-map.test.ts
```

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/votd/version-map.ts tests/unit/votd-version-map.test.ts && git commit -m "feat(votd): language→Bible-version map ported from alfred"
```

---

## Task 3: `src/lib/votd/labels.ts` — localized label strings

**Files:**
- Create: `src/lib/votd/labels.ts`
- Test: `tests/unit/votd-labels.test.ts`

- [ ] **Step 3.1: Write the failing test**

```typescript
// tests/unit/votd-labels.test.ts
import { describe, it, expect } from "bun:test";
import { guidedLabels } from "@/lib/votd/labels";
import { VERSION_MAP } from "@/lib/votd/version-map";

describe("guidedLabels", () => {
  it("returns English labels for en", () => {
    expect(guidedLabels("en")).toEqual({
      guidedScripture: "Today's Guided Scripture",
      guidedPrayer: "Today's Guided Prayer",
    });
  });
  it("returns localized labels for es", () => {
    expect(guidedLabels("es").guidedScripture).toBe("La Escritura guiada de hoy");
    expect(guidedLabels("es").guidedPrayer).toBe("La oración guiada de hoy");
  });
  it("falls back regional → primary subtag (en_GB → en)", () => {
    expect(guidedLabels("en_GB")).toEqual(guidedLabels("en"));
  });
  it("falls back unknown → en", () => {
    expect(guidedLabels("zz")).toEqual(guidedLabels("en"));
  });
  it("covers every VERSION_MAP language with non-empty labels", () => {
    for (const tag of Object.keys(VERSION_MAP)) {
      const l = guidedLabels(tag);
      expect(l.guidedScripture.length).toBeGreaterThan(0);
      expect(l.guidedPrayer.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3.2: Run it — expect FAIL**

```bash
bun test tests/unit/votd-labels.test.ts
```

- [ ] **Step 3.3: Implement (full translation table — copy verbatim)**

```typescript
// src/lib/votd/labels.ts
export type GuidedLabels = { guidedScripture: string; guidedPrayer: string };

/** "Today's Guided Scripture" / "Today's Guided Prayer" per content language.
 *  Keyed by primary subtags plus the regional keys that exist in VERSION_MAP
 *  (zh_CN, zh_TW, sr_cyrillic, ku_IQ). en_GB resolves via primary "en". */
const LABELS: Record<string, GuidedLabels> = {
  af: { guidedScripture: "Vandag se Begeleide Skriflesing", guidedPrayer: "Vandag se Begeleide Gebed" },
  am: { guidedScripture: "የዛሬ የተመራ ቅዱስ ጽሑፍ", guidedPrayer: "የዛሬ የተመራ ጸሎት" },
  ar: { guidedScripture: "آيات اليوم الموجّهة", guidedPrayer: "صلاة اليوم الموجّهة" },
  be: { guidedScripture: "Сённяшняе кіраванае чытанне Пісання", guidedPrayer: "Сённяшняя кіраваная малітва" },
  ca: { guidedScripture: "L'Escriptura guiada d'avui", guidedPrayer: "La pregària guiada d'avui" },
  cy: { guidedScripture: "Ysgrythur dywysedig heddiw", guidedPrayer: "Gweddi dywysedig heddiw" },
  da: { guidedScripture: "Dagens guidede skriftlæsning", guidedPrayer: "Dagens guidede bøn" },
  de: { guidedScripture: "Heutige geführte Schriftlesung", guidedPrayer: "Heutiges geführtes Gebet" },
  el: { guidedScripture: "Η σημερινή καθοδηγούμενη Γραφή", guidedPrayer: "Η σημερινή καθοδηγούμενη προσευχή" },
  en: { guidedScripture: "Today's Guided Scripture", guidedPrayer: "Today's Guided Prayer" },
  es: { guidedScripture: "La Escritura guiada de hoy", guidedPrayer: "La oración guiada de hoy" },
  et: { guidedScripture: "Tänane juhitud pühakiri", guidedPrayer: "Tänane juhitud palve" },
  fa: { guidedScripture: "کتاب‌مقدس هدایت‌شده امروز", guidedPrayer: "دعای هدایت‌شده امروز" },
  fr: { guidedScripture: "Lecture guidée du jour", guidedPrayer: "Prière guidée du jour" },
  gu: { guidedScripture: "આજનું માર્ગદર્શિત શાસ્ત્ર", guidedPrayer: "આજની માર્ગદર્શિત પ્રાર્થના" },
  he: { guidedScripture: "כתבי הקודש המודרכים של היום", guidedPrayer: "התפילה המודרכת של היום" },
  hi: { guidedScripture: "आज का मार्गदर्शित पवित्रशास्त्र", guidedPrayer: "आज की मार्गदर्शित प्रार्थना" },
  hr: { guidedScripture: "Današnje vođeno Pismo", guidedPrayer: "Današnja vođena molitva" },
  ht: { guidedScripture: "Ekriti gide jodi a", guidedPrayer: "Lapriyè gide jodi a" },
  hu: { guidedScripture: "A mai vezetett igeolvasás", guidedPrayer: "A mai vezetett imádság" },
  hy: { guidedScripture: "Այսօրվա առաջնորդվող Սուրբ Գիրքը", guidedPrayer: "Այսօրվա առաջնորդվող աղոթքը" },
  id: { guidedScripture: "Firman Terpandu Hari Ini", guidedPrayer: "Doa Terpandu Hari Ini" },
  ig: { guidedScripture: "Akwụkwọ Nsọ nduzi nke taa", guidedPrayer: "Ekpere nduzi nke taa" },
  is: { guidedScripture: "Leiðsögð ritning dagsins", guidedPrayer: "Leiðsögð bæn dagsins" },
  it: { guidedScripture: "La Scrittura guidata di oggi", guidedPrayer: "La preghiera guidata di oggi" },
  ja: { guidedScripture: "今日のガイド付き聖書", guidedPrayer: "今日のガイド付き祈り" },
  ka: { guidedScripture: "დღევანდელი მართული წმინდა წერილი", guidedPrayer: "დღევანდელი მართული ლოცვა" },
  km: { guidedScripture: "បទគម្ពីរណែនាំថ្ងៃនេះ", guidedPrayer: "ការអធិស្ឋានណែនាំថ្ងៃនេះ" },
  kn: { guidedScripture: "ಇಂದಿನ ಮಾರ್ಗದರ್ಶಿ ಧರ್ಮಶಾಸ್ತ್ರ", guidedPrayer: "ಇಂದಿನ ಮಾರ್ಗದರ್ಶಿ ಪ್ರಾರ್ಥನೆ" },
  ko: { guidedScripture: "오늘의 가이드 성경", guidedPrayer: "오늘의 가이드 기도" },
  ku_IQ: { guidedScripture: "نووسراوی پیرۆزی ڕێنماییکراوی ئەمڕۆ", guidedPrayer: "نوێژی ڕێنماییکراوی ئەمڕۆ" },
  ln: { guidedScripture: "Likomi ya botambwisi ya lelo", guidedPrayer: "Libondeli ya botambwisi ya lelo" },
  lt: { guidedScripture: "Šios dienos vedamas Šventasis Raštas", guidedPrayer: "Šios dienos vedama malda" },
  lv: { guidedScripture: "Šodienas vadītie Raksti", guidedPrayer: "Šodienas vadītā lūgšana" },
  mg: { guidedScripture: "Soratra Masina voatari-dalana androany", guidedPrayer: "Vavaka voatari-dalana androany" },
  mn: { guidedScripture: "Өнөөдрийн удирдамжтай Бичээс", guidedPrayer: "Өнөөдрийн удирдамжтай залбирал" },
  mr: { guidedScripture: "आजचे मार्गदर्शित शास्त्र", guidedPrayer: "आजची मार्गदर्शित प्रार्थना" },
  ms: { guidedScripture: "Kitab Suci Berpandu Hari Ini", guidedPrayer: "Doa Berpandu Hari Ini" },
  my: { guidedScripture: "ယနေ့၏ လမ်းညွှန်ကျမ်းစာ", guidedPrayer: "ယနေ့၏ လမ်းညွှန်ဆုတောင်းချက်" },
  ne: { guidedScripture: "आजको निर्देशित धर्मशास्त्र", guidedPrayer: "आजको निर्देशित प्रार्थना" },
  nl: { guidedScripture: "De begeleide Bijbeltekst van vandaag", guidedPrayer: "Het begeleide gebed van vandaag" },
  no: { guidedScripture: "Dagens veiledede skriftlesning", guidedPrayer: "Dagens veiledede bønn" },
  pa: { guidedScripture: "ਅੱਜ ਦਾ ਮਾਰਗਦਰਸ਼ਿਤ ਪਵਿੱਤਰ ਗ੍ਰੰਥ", guidedPrayer: "ਅੱਜ ਦੀ ਮਾਰਗਦਰਸ਼ਿਤ ਪ੍ਰਾਰਥਨਾ" },
  pl: { guidedScripture: "Dzisiejsze Pismo z przewodnikiem", guidedPrayer: "Dzisiejsza modlitwa z przewodnikiem" },
  pt: { guidedScripture: "A Escritura guiada de hoje", guidedPrayer: "A oração guiada de hoje" },
  ro: { guidedScripture: "Scriptura ghidată de azi", guidedPrayer: "Rugăciunea ghidată de azi" },
  ru: { guidedScripture: "Сегодняшнее Писание с наставлением", guidedPrayer: "Сегодняшняя молитва с наставлением" },
  sl: { guidedScripture: "Današnje vodeno Sveto pismo", guidedPrayer: "Današnja vodena molitev" },
  sn: { guidedScripture: "Rugwaro rwakatungamirirwa rwanhasi", guidedPrayer: "Munyengetero wakatungamirirwa wanhasi" },
  sq: { guidedScripture: "Shkrimi i udhëhequr i sotëm", guidedPrayer: "Lutja e udhëhequr e sotme" },
  sr: { guidedScripture: "Današnje vođeno Pismo", guidedPrayer: "Današnja vođena molitva" },
  sr_cyrillic: { guidedScripture: "Данашње вођено Писмо", guidedPrayer: "Данашња вођена молитва" },
  sw: { guidedScripture: "Maandiko ya Kuongozwa ya Leo", guidedPrayer: "Maombi ya Kuongozwa ya Leo" },
  ta: { guidedScripture: "இன்றைய வழிகாட்டப்பட்ட வேதாகமம்", guidedPrayer: "இன்றைய வழிகாட்டப்பட்ட ஜெபம்" },
  te: { guidedScripture: "నేటి మార్గదర్శక లేఖనం", guidedPrayer: "నేటి మార్గదర్శక ప్రార్థన" },
  th: { guidedScripture: "พระคัมภีร์นำทางวันนี้", guidedPrayer: "คำอธิษฐานนำทางวันนี้" },
  tl: { guidedScripture: "Gabay na Kasulatan Ngayon", guidedPrayer: "Gabay na Panalangin Ngayon" },
  tr: { guidedScripture: "Bugünün Rehberli Kutsal Yazısı", guidedPrayer: "Bugünün Rehberli Duası" },
  uk: { guidedScripture: "Сьогоднішнє кероване читання Писання", guidedPrayer: "Сьогоднішня керована молитва" },
  ur: { guidedScripture: "آج کا رہنمائی شدہ کلامِ مقدس", guidedPrayer: "آج کی رہنمائی شدہ دعا" },
  uz: { guidedScripture: "Bugungi yo'naltirilgan Muqaddas Bitik", guidedPrayer: "Bugungi yo'naltirilgan ibodat" },
  ve: { guidedScripture: "Maṅwalo o livhiswaho a ṋamusi", guidedPrayer: "Thabelo yo livhiswaho ya ṋamusi" },
  vi: { guidedScripture: "Kinh Thánh hướng dẫn hôm nay", guidedPrayer: "Lời cầu nguyện hướng dẫn hôm nay" },
  xh: { guidedScripture: "IsiBhalo esikhokelwayo sanamhlanje", guidedPrayer: "Umthandazo okhokelwayo wanamhlanje" },
  yo: { guidedScripture: "Ìwé Mímọ́ atọ́nisọ́nà ti òní", guidedPrayer: "Àdúrà atọ́nisọ́nà ti òní" },
  zh_CN: { guidedScripture: "今日引导式读经", guidedPrayer: "今日引导式祷告" },
  zh_TW: { guidedScripture: "今日引導式讀經", guidedPrayer: "今日引導式禱告" },
  zu: { guidedScripture: "UmBhalo oholwayo wanamuhla", guidedPrayer: "Umthandazo oholwayo wanamuhla" },
};

/** exact tag → primary subtag → English. */
export function guidedLabels(tag: string): GuidedLabels {
  const exact = LABELS[tag];
  if (exact) return exact;
  const primary = LABELS[tag.split("_")[0]];
  if (primary) return primary;
  return LABELS.en;
}
```

- [ ] **Step 3.4: Run test — expect PASS**

```bash
bun test tests/unit/votd-labels.test.ts
```

- [ ] **Step 3.5: Commit**

```bash
git add src/lib/votd/labels.ts tests/unit/votd-labels.test.ts && git commit -m "feat(votd): localized guided scripture/prayer label strings (~70 languages)"
```

---

## Task 4: `src/lib/votd/local-date.ts` — user-local calendar date

**Files:**
- Create: `src/lib/votd/local-date.ts`
- Test: `tests/unit/votd-local-date.test.ts`

- [ ] **Step 4.1: Write the failing test**

```typescript
// tests/unit/votd-local-date.test.ts
import { describe, it, expect } from "bun:test";
import { userLocalDate } from "@/lib/votd/local-date";

describe("userLocalDate", () => {
  const at = new Date("2026-06-11T03:00:00Z");
  it("renders the calendar date in the user's timezone", () => {
    expect(userLocalDate("America/Chicago", at)).toBe("2026-06-10"); // 22:00 Jun 10 CDT
    expect(userLocalDate("Asia/Tokyo", at)).toBe("2026-06-11");      // 12:00 Jun 11 JST
  });
  it("falls back to America/Chicago for null/undefined/blank", () => {
    expect(userLocalDate(null, at)).toBe("2026-06-10");
    expect(userLocalDate(undefined, at)).toBe("2026-06-10");
    expect(userLocalDate("  ", at)).toBe("2026-06-10");
  });
  it("falls back to America/Chicago for an invalid timezone string", () => {
    expect(userLocalDate("Not/AZone", at)).toBe("2026-06-10");
  });
});
```

- [ ] **Step 4.2: Run it — expect FAIL**

```bash
bun test tests/unit/votd-local-date.test.ts
```

- [ ] **Step 4.3: Implement**

```typescript
// src/lib/votd/local-date.ts
const FALLBACK_TZ = "America/Chicago";

function format(timeZone: string, at: Date): string {
  // en-CA renders YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

/** The user's local calendar date ("YYYY-MM-DD") at the given instant.
 *  Missing or invalid timezones fall back to America/Chicago. */
export function userLocalDate(timezone: string | null | undefined, at: Date): string {
  const tz = timezone && timezone.trim() ? timezone.trim() : FALLBACK_TZ;
  try {
    return format(tz, at);
  } catch {
    return format(FALLBACK_TZ, at);
  }
}
```

- [ ] **Step 4.4: Run test — expect PASS**

```bash
bun test tests/unit/votd-local-date.test.ts
```

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/votd/local-date.ts tests/unit/votd-local-date.test.ts && git commit -m "feat(votd): timezone-aware user-local date with Chicago fallback"
```

---

## Task 5: `src/lib/votd/votd-tags.ts` — liquid tag detection + substitution

**Files:**
- Create: `src/lib/votd/votd-tags.ts`
- Test: `tests/unit/votd-tags.test.ts`

- [ ] **Step 5.1: Write the failing test**

```typescript
// tests/unit/votd-tags.test.ts
import { describe, it, expect } from "bun:test";
import { hasVotdTags, substituteVotdTags, type VotdSubstitutions } from "@/lib/votd/votd-tags";

const subs: VotdSubstitutions = {
  guidedScriptureLabel: "Today's Guided Scripture",
  guidedPrayerLabel: "Today's Guided Prayer",
  votdReference: "John 3:16",
  votdText: "For God so loved the world",
};

describe("hasVotdTags", () => {
  it("detects each tag in title or body", () => {
    expect(hasVotdTags("{{guided_scripture_label}}", "x")).toBe(true);
    expect(hasVotdTags("x", "{{guided_prayer_label}}")).toBe(true);
    expect(hasVotdTags(null, "{{votd_reference}}")).toBe(true);
    expect(hasVotdTags("{{votd_text}}", null)).toBe(true);
  });
  it("returns false for plain copy and null/undefined", () => {
    expect(hasVotdTags("Hello", "World")).toBe(false);
    expect(hasVotdTags(null, null)).toBe(false);
  });
});

describe("substituteVotdTags", () => {
  it("substitutes all four tags", () => {
    expect(substituteVotdTags("{{guided_scripture_label}}: {{votd_reference}}", subs))
      .toBe("Today's Guided Scripture: John 3:16");
    expect(substituteVotdTags("{{guided_prayer_label}} — {{votd_text}}", subs))
      .toBe("Today's Guided Prayer — For God so loved the world");
  });
  it("substitutes multiple occurrences", () => {
    expect(substituteVotdTags("{{votd_reference}} {{votd_reference}}", subs)).toBe("John 3:16 John 3:16");
  });
  it("leaves text without tags unchanged", () => {
    expect(substituteVotdTags("plain", subs)).toBe("plain");
  });
});
```

- [ ] **Step 5.2: Run it — expect FAIL**

```bash
bun test tests/unit/votd-tags.test.ts
```

- [ ] **Step 5.3: Implement**

```typescript
// src/lib/votd/votd-tags.ts
export const GUIDED_SCRIPTURE_LABEL_TAG = "{{guided_scripture_label}}";
export const GUIDED_PRAYER_LABEL_TAG = "{{guided_prayer_label}}";
export const VOTD_REFERENCE_TAG = "{{votd_reference}}";
export const VOTD_TEXT_TAG = "{{votd_text}}";

const ALL_TAGS = [
  GUIDED_SCRIPTURE_LABEL_TAG,
  GUIDED_PRAYER_LABEL_TAG,
  VOTD_REFERENCE_TAG,
  VOTD_TEXT_TAG,
] as const;

export function hasVotdTags(title: string | null | undefined, body: string | null | undefined): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  return ALL_TAGS.some((tag) => text.includes(tag));
}

export type VotdSubstitutions = {
  guidedScriptureLabel: string;
  guidedPrayerLabel: string;
  votdReference: string;
  votdText: string;
};

export function substituteVotdTags(text: string, subs: VotdSubstitutions): string {
  return text
    .replaceAll(GUIDED_SCRIPTURE_LABEL_TAG, subs.guidedScriptureLabel)
    .replaceAll(GUIDED_PRAYER_LABEL_TAG, subs.guidedPrayerLabel)
    .replaceAll(VOTD_REFERENCE_TAG, subs.votdReference)
    .replaceAll(VOTD_TEXT_TAG, subs.votdText);
}
```

- [ ] **Step 5.4: Run test — expect PASS**

```bash
bun test tests/unit/votd-tags.test.ts
```

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/votd/votd-tags.ts tests/unit/votd-tags.test.ts && git commit -m "feat(votd): liquid tag detection and substitution"
```

---

## Task 6: `votd-user-key.ts` + `votd-content.ts` — per-user resolution + cached content service

`resolveVotdUserKey` is the **single shared** date/lang resolver used by send-grouping (pure), `prepareVotdContent` (cron pre-fetch), and `/api/demo/send` — so resolution can never diverge.

**Files:**
- Create: `src/lib/votd/votd-user-key.ts`
- Create: `src/lib/votd/votd-content.ts`
- Test: `tests/unit/votd-user-key.test.ts`
- Test: `tests/unit/votd-content-helpers.test.ts`
- Test: `tests/integration/votd-content.test.ts`

- [ ] **Step 6.1: Write the failing unit tests**

```typescript
// tests/unit/votd-user-key.test.ts
import { describe, it, expect } from "bun:test";
import { resolveVotdUserKey, votdContentKey } from "@/lib/votd/votd-user-key";

const at = new Date("2026-06-11T15:00:00Z"); // 10:00 CDT — same calendar day in Chicago

describe("resolveVotdUserKey", () => {
  it("reads timezone + language_tag from an attributes object", () => {
    expect(resolveVotdUserKey({ timezone: "Asia/Tokyo", language_tag: "es" }, at))
      .toEqual({ date: "2026-06-12", languageTag: "es" }); // 00:00 Jun 12 JST
  });
  it("parses attributes passed as a JSON string", () => {
    expect(resolveVotdUserKey('{"timezone":"Asia/Tokyo","language_tag":"pt-BR"}', at))
      .toEqual({ date: "2026-06-12", languageTag: "pt" });
  });
  it("defaults to Chicago + en for null/garbage attributes", () => {
    expect(resolveVotdUserKey(null, at)).toEqual({ date: "2026-06-11", languageTag: "en" });
    expect(resolveVotdUserKey("not json", at)).toEqual({ date: "2026-06-11", languageTag: "en" });
    expect(resolveVotdUserKey([1, 2], at)).toEqual({ date: "2026-06-11", languageTag: "en" });
  });
});

describe("votdContentKey", () => {
  it("joins date and language with a space separator", () => {
    expect(votdContentKey("2026-06-11", "en")).toBe("2026-06-11 en");
  });
});
```

```typescript
// tests/unit/votd-content-helpers.test.ts
import { describe, it, expect } from "bun:test";
import { dayOfYear, renderImageUrl } from "@/lib/votd/votd-content";

describe("dayOfYear", () => {
  it("computes day of year in UTC", () => {
    expect(dayOfYear("2026-01-01")).toBe(1);
    expect(dayOfYear("2026-06-11")).toBe(162);
    expect(dayOfYear("2026-12-31")).toBe(365);
  });
  it("handles leap years", () => {
    expect(dayOfYear("2024-03-01")).toBe(61);
    expect(dayOfYear("2024-12-31")).toBe(366);
  });
});

describe("renderImageUrl", () => {
  it("replaces {w}/{h} placeholders", () => {
    expect(renderImageUrl("https://x/{w}x{h}/a.jpg", 320, 320)).toBe("https://x/320x320/a.jpg");
  });
  it("replaces {width}/{height} placeholders", () => {
    expect(renderImageUrl("https://x/{width}x{height}/a.jpg", 1024, 512)).toBe("https://x/1024x512/a.jpg");
  });
  it("prefixes https: on protocol-relative URLs", () => {
    expect(renderImageUrl("//imgs.youversion.com/{w}x{h}/a.jpg", 320, 320))
      .toBe("https://imgs.youversion.com/320x320/a.jpg");
  });
});
```

- [ ] **Step 6.2: Run them — expect FAIL**

```bash
bun test tests/unit/votd-user-key.test.ts tests/unit/votd-content-helpers.test.ts
```

- [ ] **Step 6.3: Implement `votd-user-key.ts`**

```typescript
// src/lib/votd/votd-user-key.ts
import { userLocalDate } from "./local-date";
import { contentLanguageFor } from "./version-map";

export type VotdUserKey = { date: string; languageTag: string };

/** Map key for a (date, language) content row. Neither part can contain a space. */
export function votdContentKey(date: string, languageTag: string): string {
  return `${date} ${languageTag}`;
}

function parseAttributes(attributes: unknown): Record<string, unknown> {
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    return attributes as Record<string, unknown>;
  }
  if (typeof attributes === "string") {
    try {
      const parsed: unknown = JSON.parse(attributes);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through to {} */ }
  }
  return {};
}

/** Shared per-user VOTD resolution: local calendar date (timezone attr,
 *  Chicago fallback) + content language (language_tag attr, en fallback).
 *  Used by send-grouping, prepareVotdContent, and demo/send — keep single. */
export function resolveVotdUserKey(attributes: unknown, at: Date): VotdUserKey {
  const attrs = parseAttributes(attributes);
  const timezone = typeof attrs.timezone === "string" ? attrs.timezone : null;
  const langRaw = typeof attrs.language_tag === "string" ? attrs.language_tag : null;
  return {
    date: userLocalDate(timezone, at),
    languageTag: contentLanguageFor(langRaw),
  };
}
```

- [ ] **Step 6.4: Implement `votd-content.ts`**

```typescript
// src/lib/votd/votd-content.ts
import { buildVerseImageUrls } from "@/lib/verse-image";
import { versionForLanguage } from "./version-map";
import { resolveVotdUserKey, votdContentKey } from "./votd-user-key";

export type VotdContent = {
  date: string;
  languageTag: string;
  usfm: string;
  reference: string;
  verseText: string;
  versionId: number;
  imageUrlIos: string | null;
  imageUrlAndroid: string | null;
};

type PrismaLike = typeof import("@/lib/db").prisma;

const VOTD_HEADERS = {
  Referer: "http://yvapi.youversionapi.com",
  "X-YouVersion-Client": "youversion",
  "X-YouVersion-App-Platform": "internal",
  "X-YouVersion-App-Version": "1",
} as const;

type VotdCalendarEntry = { day: number; usfm: string[]; image_id?: number | string };

// 365-entry static calendar, memoized per process. Reset on failure so a
// transient error doesn't poison every later call.
let calendarPromise: Promise<VotdCalendarEntry[]> | null = null;

export function __resetVotdCalendarCacheForTests(): void {
  calendarPromise = null;
}

async function loadVotdCalendar(): Promise<VotdCalendarEntry[]> {
  if (!calendarPromise) {
    calendarPromise = (async () => {
      try {
        const res = await fetch(
          "https://moments.youversionapi.com/3.1/votd.json?type=standard&language_tag=en",
          { headers: VOTD_HEADERS },
        );
        if (!res.ok) throw new Error(`votd.json HTTP ${res.status}`);
        const json = (await res.json()) as { votd?: VotdCalendarEntry[] };
        if (!Array.isArray(json.votd) || json.votd.length === 0) {
          throw new Error("votd.json: empty calendar");
        }
        return json.votd;
      } catch (err) {
        calendarPromise = null;
        throw err;
      }
    })();
  }
  return calendarPromise;
}

/** Day-of-year (1–366) for a "YYYY-MM-DD" string, computed in UTC. */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1;
}

/** Render an images-API URL template ({w}x{h} or {width}x{height} placeholders);
 *  protocol-relative URLs get an https: prefix. */
export function renderImageUrl(template: string, w: number, h: number): string {
  const url = template
    .replaceAll("{w}", String(w))
    .replaceAll("{h}", String(h))
    .replaceAll("{width}", String(w))
    .replaceAll("{height}", String(h));
  return url.startsWith("//") ? `https:${url}` : url;
}

async function fetchVerse(
  usfms: string[],
  versionId: number,
): Promise<{ reference: string; verseText: string } | null> {
  const refs = usfms.map((u) => `references[]=${encodeURIComponent(u)}`).join("&");
  const res = await fetch(
    `https://bible.youversionapi.com/3.1/verses.json?${refs}&id=${versionId}&format=text`,
    { headers: VOTD_HEADERS },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as {
    verses?: Array<{ content?: string; reference?: { human?: string } }>;
  };
  const verses = json.verses ?? [];
  const reference = verses.map((v) => v.reference?.human).filter(Boolean).join("; ");
  const verseText = verses.map((v) => (v.content ?? "").trim()).filter(Boolean).join(" ");
  if (!reference || !verseText) return null;
  return { reference, verseText };
}

async function fetchImageUrls(
  usfm: string,
  languageTag: string,
  fallbackImageId: string | null,
): Promise<{ ios: string | null; android: string | null }> {
  try {
    const res = await fetch(
      `https://images.youversionapi.com/3.2/items.json?usfm[]=${encodeURIComponent(usfm)}&language_tag=${encodeURIComponent(languageTag)}&category=prerendered`,
      { headers: VOTD_HEADERS },
    );
    if (res.ok) {
      const json = (await res.json()) as { items?: Array<{ urls?: { regular?: string } }> };
      const template = json.items?.[0]?.urls?.regular;
      if (template) {
        return {
          ios: renderImageUrl(template, 320, 320),
          android: renderImageUrl(template, 1024, 512),
        };
      }
    }
  } catch { /* image failure is non-fatal — text-only sends still work */ }
  if (fallbackImageId) {
    const { ios, android } = buildVerseImageUrls(fallbackImageId);
    return { ios, android };
  }
  return { ios: null, android: null };
}

/** Cached VOTD content for a user-local date + content language.
 *  DB hit → return; miss → fetch calendar/verse/images, upsert, return.
 *  Any text-path failure → null (caller must skip the user — never send raw tags). */
export async function getVotdContent(
  prisma: PrismaLike,
  date: string,
  languageTag: string,
): Promise<VotdContent | null> {
  const existing = await prisma.votdDailyContent.findUnique({
    where: { date_languageTag: { date, languageTag } },
  });
  if (existing) return existing;

  try {
    const calendar = await loadVotdCalendar();
    const doy = dayOfYear(date);
    // Day 366 (leap-year Dec 31) has no calendar entry → reuse day 365.
    const entry = calendar.find((e) => e.day === doy) ?? calendar.find((e) => e.day === 365);
    if (!entry || !Array.isArray(entry.usfm) || entry.usfm.length === 0) return null;

    const versionId = versionForLanguage(languageTag);
    const verse = await fetchVerse(entry.usfm, versionId);
    if (!verse) return null;

    const images = await fetchImageUrls(
      entry.usfm[0],
      languageTag,
      entry.image_id != null ? String(entry.image_id) : null,
    );

    // @@unique([date, languageTag]) makes concurrent misses safe.
    return await prisma.votdDailyContent.upsert({
      where: { date_languageTag: { date, languageTag } },
      create: {
        date,
        languageTag,
        usfm: entry.usfm.join("+"),
        reference: verse.reference,
        verseText: verse.verseText,
        versionId,
        imageUrlIos: images.ios,
        imageUrlAndroid: images.android,
      },
      update: {},
    });
  } catch (err) {
    console.error("[votd] getVotdContent failed:", date, languageTag, err);
    return null;
  }
}

/** Cron-side pre-fetch: collect the unique (date, language) pairs for users
 *  assigned to VOTD variants, resolve each via getVotdContent, and return a
 *  map keyed by votdContentKey for the pure grouping pass. Unresolvable pairs
 *  are simply absent (those users get skipped). */
export async function prepareVotdContent(
  prisma: PrismaLike,
  inputs: Array<{ user: { attributes: unknown }; variantId: string; scheduledAt: Date }>,
  votdVariantIds: Set<string>,
): Promise<Map<string, VotdContent>> {
  const out = new Map<string, VotdContent>();
  if (votdVariantIds.size === 0) return out;

  const pending = new Map<string, { date: string; languageTag: string }>();
  for (const input of inputs) {
    if (!votdVariantIds.has(input.variantId)) continue;
    const key = resolveVotdUserKey(input.user.attributes, input.scheduledAt);
    pending.set(votdContentKey(key.date, key.languageTag), key);
  }

  for (const [key, { date, languageTag }] of pending) {
    const content = await getVotdContent(prisma, date, languageTag);
    if (content) out.set(key, content);
  }
  return out;
}
```

- [ ] **Step 6.5: Run unit tests — expect PASS**

```bash
bun test tests/unit/votd-user-key.test.ts tests/unit/votd-content-helpers.test.ts
```

- [ ] **Step 6.6: Write the integration test (stubbed fetch + test DB)**

```typescript
// tests/integration/votd-content.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  getVotdContent,
  prepareVotdContent,
  __resetVotdCalendarCacheForTests,
} from "@/lib/votd/votd-content";
import { buildVerseImageUrls } from "@/lib/verse-image";
import { votdContentKey } from "@/lib/votd/votd-user-key";

const realFetch = globalThis.fetch;
let fetchCalls: string[] = [];

function stubFetch(opts: { failVerse?: boolean; failImages?: boolean; failCalendar?: boolean } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.includes("moments.youversionapi.com")) {
      if (opts.failCalendar) return new Response("err", { status: 500 });
      return Response.json({
        votd: [
          { day: 1, usfm: ["GEN.1.1"] }, // no image_id → tests null-image path
          { day: 162, usfm: ["JHN.3.16"], image_id: 77058 },
        ],
      });
    }
    if (url.includes("bible.youversionapi.com")) {
      if (opts.failVerse) return new Response("err", { status: 500 });
      return Response.json({
        verses: [{ content: "For God so loved the world", reference: { human: "John 3:16" } }],
      });
    }
    if (url.includes("images.youversionapi.com")) {
      if (opts.failImages) return new Response("err", { status: 500 });
      return Response.json({ items: [{ urls: { regular: "//imgs.youversion.com/{w}x{h}/a.jpg" } }] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

beforeEach(async () => {
  await truncateAll();
  await prisma.votdDailyContent.deleteMany({});
  __resetVotdCalendarCacheForTests();
  fetchCalls = [];
});
afterEach(async () => {
  await prisma.votdDailyContent.deleteMany({});
  await truncateAll();
  globalThis.fetch = realFetch;
});

describe("getVotdContent", () => {
  it("cold miss fetches, writes a row, and returns content", async () => {
    stubFetch();
    const content = await getVotdContent(prisma, "2026-06-11", "en"); // day 162
    expect(content).not.toBeNull();
    expect(content!.reference).toBe("John 3:16");
    expect(content!.verseText).toBe("For God so loved the world");
    expect(content!.usfm).toBe("JHN.3.16");
    expect(content!.versionId).toBe(111);
    expect(content!.imageUrlIos).toBe("https://imgs.youversion.com/320x320/a.jpg");
    expect(content!.imageUrlAndroid).toBe("https://imgs.youversion.com/1024x512/a.jpg");
    const row = await prisma.votdDailyContent.findUnique({
      where: { date_languageTag: { date: "2026-06-11", languageTag: "en" } },
    });
    expect(row).not.toBeNull();
  });

  it("warm hit returns the cached row with zero fetches", async () => {
    await prisma.votdDailyContent.create({
      data: {
        date: "2026-06-11", languageTag: "en", usfm: "JHN.3.16",
        reference: "John 3:16", verseText: "cached", versionId: 111,
      },
    });
    globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    expect(content!.verseText).toBe("cached");
  });

  it("image API failure falls back to the calendar image_id (nullable-safe)", async () => {
    stubFetch({ failImages: true });
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    const { ios, android } = buildVerseImageUrls("77058");
    expect(content!.imageUrlIos).toBe(ios);
    expect(content!.imageUrlAndroid).toBe(android);
  });

  it("image API failure with no calendar image_id stores null image columns", async () => {
    stubFetch({ failImages: true });
    const content = await getVotdContent(prisma, "2026-01-01", "en"); // day 1 = GEN.1.1, no image_id
    expect(content).not.toBeNull();
    expect(content!.imageUrlIos).toBeNull();
    expect(content!.imageUrlAndroid).toBeNull();
  });

  it("verse fetch failure returns null and writes no row", async () => {
    stubFetch({ failVerse: true });
    const content = await getVotdContent(prisma, "2026-06-11", "en");
    expect(content).toBeNull();
    const count = await prisma.votdDailyContent.count();
    expect(count).toBe(0);
  });

  it("calendar failure returns null but a later call can retry (memo reset)", async () => {
    stubFetch({ failCalendar: true });
    expect(await getVotdContent(prisma, "2026-06-11", "en")).toBeNull();
    stubFetch(); // now healthy
    expect(await getVotdContent(prisma, "2026-06-11", "en")).not.toBeNull();
  });
});

describe("prepareVotdContent", () => {
  it("dedupes (date, language) pairs and ignores non-VOTD variants", async () => {
    stubFetch();
    const at = new Date("2026-06-11T15:00:00Z");
    const inputs = [
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at },
      { user: { attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "vX", scheduledAt: at },
    ];
    const map = await prepareVotdContent(prisma, inputs, new Set(["v1"]));
    expect(map.size).toBe(1);
    expect(map.get(votdContentKey("2026-06-11", "en"))!.reference).toBe("John 3:16");
    // one calendar + one verse + one images fetch — duplicates deduped, vX ignored
    expect(fetchCalls.length).toBe(3);
  });

  it("returns an empty map when no VOTD variants exist (zero fetches)", async () => {
    globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
    const map = await prepareVotdContent(prisma, [], new Set());
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 6.7: Run the integration test (ONE file at a time)**

```bash
TEST_FILES=tests/integration/votd-content.test.ts bun run test:int-reg
```

Expected: PASS. (Requires local `nexus_test` Postgres with the Task 1 DDL applied.)

- [ ] **Step 6.8: Commit**

```bash
git add src/lib/votd/votd-user-key.ts src/lib/votd/votd-content.ts tests/unit/votd-user-key.test.ts tests/unit/votd-content-helpers.test.ts tests/integration/votd-content.test.ts && git commit -m "feat(votd): cached VOTD content service + shared per-user date/lang resolution"
```

---

## Task 7: VOTD branch in `groupDecisionsByVariant` (pure)

**Files:**
- Modify: `src/lib/cron/send-grouping.ts`
- Test: `tests/unit/send-grouping-votd.test.ts`

- [ ] **Step 7.1: Write the failing test**

```typescript
// tests/unit/send-grouping-votd.test.ts
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";
import type { VotdContent } from "@/lib/votd/votd-content";
import { votdContentKey } from "@/lib/votd/votd-user-key";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";

const votdMeta: VariantMeta = {
  channel: "push",
  body: "{{votd_reference}}",
  title: "{{guided_scripture_label}}",
  deeplink: "https://www.bible.com/stories",
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null,
  iconImageUrl: null,
};

function content(overrides: Partial<VotdContent> = {}): VotdContent {
  return {
    date: "2026-06-11", languageTag: "en", usfm: "JHN.3.16",
    reference: "John 3:16", verseText: "For God so loved the world",
    versionId: 111, imageUrlIos: null, imageUrlAndroid: null,
    ...overrides,
  };
}

// 15:00Z = 10:00 CDT → Chicago local date 2026-06-11
const AT = new Date("2026-06-11T15:00:00Z");

function input(externalId: string, attributes: Record<string, unknown> = { language_tag: "en", timezone: "America/Chicago" }) {
  return { user: { externalId, brazeId: null, attributes }, variantId: "v1", scheduledAt: AT, inLocalTime: false };
}

function loc(votdContent: Map<string, VotdContent>) {
  return {
    enabled: false,
    translationsByVariant: new Map(),
    votdVariantIds: new Set(["v1"]),
    votdContent,
  };
}

describe("send-grouping VOTD", () => {
  it("substitutes label + reference for an English user", () => {
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Scripture");
    expect(g.body).toBe("John 3:16");
    expect(g.deeplink).toBe("https://www.bible.com/stories");
  });

  it("substitutes the localized label + reference for a Spanish user", () => {
    const map = new Map([[votdContentKey("2026-06-11", "es"), content({ languageTag: "es", reference: "Juan 3:16" })]]);
    const groups = groupDecisionsByVariant(
      [input("u1", { language_tag: "es", timezone: "America/Chicago" })],
      new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(map),
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("La Escritura guiada de hoy");
    expect(g.body).toBe("Juan 3:16");
  });

  it("substitutes the prayer label and verse text", () => {
    const meta: VariantMeta = { ...votdMeta, title: "{{guided_prayer_label}}", body: "{{votd_text}}", deeplink: "https://www.bible.com/guides/1" };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Today's Guided Prayer");
    expect(g.body).toBe("For God so loved the world");
  });

  it("skips users whose (date, language) content is missing — never sends raw tags", () => {
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", votdMeta]]), new Map([["u1", "d1"]]), loc(new Map()));
    expect(Object.keys(groups)).toHaveLength(0);
  });

  it("attaches the content image URLs when iconImageUrl is the sentinel", () => {
    const meta: VariantMeta = { ...votdMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content({ imageUrlIos: "https://img/ios.jpg", imageUrlAndroid: "https://img/android.jpg" })]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBe("https://img/ios.jpg");
    expect(g.androidImageUrl).toBe("https://img/android.jpg");
  });

  it("sends text-only when the sentinel is set but the content has no images", () => {
    const meta: VariantMeta = { ...votdMeta, iconImageUrl: VERSE_IMAGE_SENTINEL };
    const map = new Map([[votdContentKey("2026-06-11", "en"), content()]]);
    const groups = groupDecisionsByVariant([input("u1")], new Map([["v1", meta]]), new Map([["u1", "d1"]]), loc(map));
    const g = Object.values(groups)[0];
    expect(g.iosImageUrl).toBeNull();
    expect(g.androidImageUrl).toBeNull();
    expect(g.body).toBe("John 3:16"); // copy still substituted
  });

  it("splits users on different local dates into different groups", () => {
    // 03:00Z: Tokyo = Jun 11, Chicago = Jun 10
    const at = new Date("2026-06-11T03:00:00Z");
    const map = new Map([
      [votdContentKey("2026-06-11", "en"), content({ date: "2026-06-11", reference: "John 3:16" })],
      [votdContentKey("2026-06-10", "en"), content({ date: "2026-06-10", reference: "Psalm 23:1" })],
    ]);
    const groups = groupDecisionsByVariant(
      [
        { user: { externalId: "tokyo", brazeId: null, attributes: { language_tag: "en", timezone: "Asia/Tokyo" } }, variantId: "v1", scheduledAt: at, inLocalTime: false },
        { user: { externalId: "chicago", brazeId: null, attributes: { language_tag: "en", timezone: "America/Chicago" } }, variantId: "v1", scheduledAt: at, inLocalTime: false },
      ],
      new Map([["v1", votdMeta]]),
      new Map([["tokyo", "d1"], ["chicago", "d2"]]),
      loc(map),
    );
    const bodies = Object.values(groups).map((g) => g.body).sort();
    expect(bodies).toEqual(["John 3:16", "Psalm 23:1"]);
  });

  it("leaves non-VOTD variants untouched", () => {
    const meta: VariantMeta = { ...votdMeta, title: "Plain", body: "Copy" };
    const groups = groupDecisionsByVariant(
      [{ ...input("u1"), variantId: "v2" }],
      new Map([["v2", meta]]),
      new Map([["u1", "d1"]]),
      loc(new Map()), // votdVariantIds only contains v1
    );
    const g = Object.values(groups)[0];
    expect(g.title).toBe("Plain");
    expect(g.body).toBe("Copy");
  });
});
```

- [ ] **Step 7.2: Run it — expect FAIL** (votdVariantIds/votdContent unknown options; no substitution happens)

```bash
bun test tests/unit/send-grouping-votd.test.ts
```

- [ ] **Step 7.3: Implement in `src/lib/cron/send-grouping.ts`**

Add imports (after the existing `verse-image` import at line 16):

```typescript
import { substituteVotdTags } from "@/lib/votd/votd-tags";
import { guidedLabels } from "@/lib/votd/labels";
import { resolveVotdUserKey, votdContentKey } from "@/lib/votd/votd-user-key";
import type { VotdContent } from "@/lib/votd/votd-content";
```

(All runtime imports are pure — keeps the module's "No DB / network access" contract.)

Extend the `localization` parameter type (lines 68–73) to:

```typescript
  localization?: {
    enabled: boolean;
    translationsByVariant: Map<string, Map<string, LocalizedCopy>>;
    versePool?: VersePool;
    strategyByVariant?: Map<string, VerseStrategy>;
    /** Push variants whose title/body contain {{votd_*}} liquid tags. */
    votdVariantIds?: Set<string>;
    /** Pre-fetched VOTD rows keyed by votdContentKey(date, languageTag). */
    votdContent?: Map<string, VotdContent>;
  },
```

Add a per-user image holder next to `verseImageId` (line 90):

```typescript
    let verseImageId: string | undefined;
    let votdImage: { ios: string | null; android: string | null } | undefined;
```

Replace the non-giving `else` branch body (current lines 107–134) with — the VOTD branch comes FIRST, the verse branch becomes `else if`:

```typescript
      resolvedDeeplink = meta.deeplink === GIVING_LINK_SENTINEL
        ? buildGivingDeeplink(attrs, "blend", meta.givingFrequency ?? "monthly")
        : meta.deeplink;

      // VOTD liquid-tag arms resolve today's (user-local) localized verse from
      // the pre-fetched content map; verse-push arms (body sentinel) resolve a
      // rotated verse; otherwise fall back to the standard translation path.
      const isVotd = (localization?.votdVariantIds?.has(variantId) ?? false) && meta.channel === "push";
      const verseStrategy = localization?.strategyByVariant?.get(variantId);
      const isVerse =
        !isVotd && meta.body === VERSE_PUSH_SENTINEL && verseStrategy != null && localization?.versePool != null;
      if (isVotd) {
        const key = resolveVotdUserKey(user.attributes, scheduledAt);
        const content = localization?.votdContent?.get(votdContentKey(key.date, key.languageTag));
        // Missing content → skip rather than deliver raw liquid tags.
        if (!content) continue;
        const labels = guidedLabels(content.languageTag);
        const subs = {
          guidedScriptureLabel: labels.guidedScripture,
          guidedPrayerLabel: labels.guidedPrayer,
          votdReference: content.reference,
          votdText: content.verseText,
        };
        copy = {
          title: meta.title != null ? substituteVotdTags(meta.title, subs) : null,
          body: substituteVotdTags(meta.body, subs),
        };
        votdImage = { ios: content.imageUrlIos, android: content.imageUrlAndroid };
      } else if (isVerse) {
        const dateBucket = scheduledAt.toISOString().slice(0, 10);
        const verse = pickVerse(localization!.versePool!, user.externalId, dateBucket);
        // Empty pool → skip rather than deliver the raw sentinel as a push body.
        if (!verse) continue;
        copy = resolveVerseCopy(verse, tag, verseStrategy!);
        verseImageId = verse.imageId;
      } else if (localization?.enabled && meta.channel === "push") {
        // Strict localization: skip recipients we cannot serve in their own language
        // rather than falling back to the English copy.
        const localized = resolvePushLocaleStrict(
          tag,
          localization.translationsByVariant.get(variantId) ?? new Map(),
          { title: meta.title, body: meta.body },
        );
        if (!localized) continue;
        copy = localized;
      }
      copyKeyed = meta.channel === "push" && (isVotd || isVerse || (localization?.enabled ?? false));
```

Extend the image-resolution block (current lines 137–151) so the sentinel also resolves on VOTD arms:

```typescript
    // Resolve per-platform image URLs (payload-determining → folded into the group key).
    let iosImageUrl: string | null = null;
    let androidImageUrl: string | null = null;
    if (meta.iconImageUrl === VERSE_IMAGE_SENTINEL) {
      if (votdImage && meta.channel === "push") {
        // VOTD arm: today's localized verse image (nullable → text-only send).
        iosImageUrl = votdImage.ios;
        androidImageUrl = votdImage.android;
      } else if (meta.body === VERSE_PUSH_SENTINEL && meta.channel === "push") {
        // Sentinel only resolves on a verse arm (we have a chosen verse). On a
        // non-verse arm the sentinel is meaningless → no image.
        const { ios, android } = buildVerseImageUrls(verseImageId ?? DEFAULT_VERSE_IMAGE_ID);
        iosImageUrl = ios;
        androidImageUrl = android;
      }
    } else if (meta.iconImageUrl) {
      iosImageUrl = meta.iconImageUrl;
      androidImageUrl = meta.iconImageUrl;
    }
```

No group-key changes needed: `copyKeyed` already folds the resolved copy into the key (users on different dates/languages produce different copy), and the image key is always appended.

- [ ] **Step 7.4: Run the new test AND the existing grouping tests — expect PASS**

```bash
bun test tests/unit/send-grouping-votd.test.ts tests/unit/send-grouping-image.test.ts && bun run test:quick
```

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/unit/send-grouping-votd.test.ts && git commit -m "feat(votd): resolve liquid-tag VOTD copy + images in send grouping"
```

---

## Task 8: Cron route wiring — detect VOTD variants + pre-fetch content

`groupDecisionsByVariant` is pure, so the cron route must pre-fetch the content rows and pass them through `localization`.

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts`

- [ ] **Step 8.1: Add imports** (alongside the existing send-grouping import at line ~39)

```typescript
import { hasVotdTags } from "@/lib/votd/votd-tags";
import { prepareVotdContent } from "@/lib/votd/votd-content";
```

- [ ] **Step 8.2: Build `votdVariantIds` and add it to `localization`**

Find the `strategyByVariant` block (lines ~890–900). Directly after the `versePool` line and replacing the existing `const localization = …` line:

```typescript
    // VOTD dynamic variants: liquid-tag copy resolved per user-local date + language.
    const votdVariantIds = new Set<string>();
    for (const msg of agent.messages) {
      if (msg.channel !== "push") continue;
      for (const v of msg.variants) {
        if (hasVotdTags(v.title ?? null, v.body)) votdVariantIds.add(v.id);
      }
    }
    const localization = { enabled: localizeEnabled, translationsByVariant, versePool, strategyByVariant, votdVariantIds };
```

- [ ] **Step 8.3: Pre-fetch + pass content at BOTH call sites**

Call site 1 — lottery path (line ~1348). Replace:

```typescript
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser, localization, givingMultiplier);
```

with:

```typescript
          const votdContent = await prepareVotdContent(prisma, lotteryDecisionInputs, votdVariantIds);
          byVariant = groupDecisionsByVariant(lotteryDecisionInputs, variantMeta, lotteryDecisionIdByUser, { ...localization, votdContent }, givingMultiplier);
```

Call site 2 — in-window path (line ~1794). Replace:

```typescript
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser, localization, givingMultiplier);
```

with:

```typescript
        const windowVotdContent = await prepareVotdContent(prisma, decisionInputs, votdVariantIds);
        windowByVariant = groupDecisionsByVariant(decisionInputs, variantMeta, decisionIdByUser, { ...localization, votdContent: windowVotdContent }, givingMultiplier);
```

(`prepareVotdContent` returns an empty map immediately when `votdVariantIds` is empty — zero overhead for non-VOTD agents.)

- [ ] **Step 8.4: Typecheck + run the cron integration test**

```bash
bun run typecheck && TEST_FILES=tests/integration/cron-send.test.ts bun run test:int-reg
```

Expected: PASS (existing behavior unchanged — no VOTD variants in those fixtures).

- [ ] **Step 8.5: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts && git commit -m "feat(votd): pre-fetch VOTD content in select-and-send and thread through grouping"
```

---

## Task 9: Seed the 12 dynamic library variants

**Files:**
- Modify: `scripts/seed-push-copy-templates.ts`

- [ ] **Step 9.1: Add `iconImageUrl` to `VariantDef` and the create call**

In the `VariantDef` type, add:

```typescript
  iconImageUrl?: string;
```

Add the import at the top of the script:

```typescript
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
```

In `main()`, in the `prisma.messageVariant.create` data object (alongside `category`, `subcategory`, `status`), add:

```typescript
          iconImageUrl: v.iconImageUrl ?? null,
```

- [ ] **Step 9.2: Append 6 dynamic variants to the `guided-scripture` category's variants array**

Guided Scripture dynamic variants use `subcategory: null` (the guided-scripture category has no subcategories — they mix with the static templates):

```typescript
  // --- Dynamic VOTD variants (liquid tags resolved at send time) ---
  {
    subcategory: null,
    name: "VOTD: Label + Reference",
    title: "{{guided_scripture_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: null,
    name: "VOTD: Label + Reference (Verse Image)",
    title: "{{guided_scripture_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: null,
    name: "VOTD: Label + Verse Text",
    title: "{{guided_scripture_label}}",
    body: "{{votd_text}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: null,
    name: "VOTD: Label + Verse Text (Verse Image)",
    title: "{{guided_scripture_label}}",
    body: "{{votd_text}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: null,
    name: "VOTD: Reference + Label",
    title: "{{votd_reference}}",
    body: "{{guided_scripture_label}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: null,
    name: "VOTD: Reference + Label (Verse Image)",
    title: "{{votd_reference}}",
    body: "{{guided_scripture_label}}",
    deeplink: "https://www.bible.com/stories",
    cta: "Open Guided Scripture",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
```

- [ ] **Step 9.3: Append 6 dynamic variants to the `guided-prayer` category's variants array**

Guided Prayer uses `subcategory: "votd-dynamic"` and the prayer label/deeplink — the same three permutations:

```typescript
  // --- Dynamic VOTD variants (liquid tags resolved at send time) ---
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Label + Reference",
    title: "{{guided_prayer_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Label + Reference (Verse Image)",
    title: "{{guided_prayer_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Label + Verse Text",
    title: "{{guided_prayer_label}}",
    body: "{{votd_text}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Label + Verse Text (Verse Image)",
    title: "{{guided_prayer_label}}",
    body: "{{votd_text}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "medium", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Reference + Label",
    title: "{{votd_reference}}",
    body: "{{guided_prayer_label}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
  {
    subcategory: "votd-dynamic",
    name: "VOTD: Reference + Label (Verse Image)",
    title: "{{votd_reference}}",
    body: "{{guided_prayer_label}}",
    deeplink: "https://www.bible.com/guides/1",
    cta: "Open Guided Prayer",
    iconImageUrl: VERSE_IMAGE_SENTINEL,
    actionFeatures: { tone: "empathy", hasPersonalization: true, ctaType: "deeplink", messageLengthBucket: "short", sourceFile: "dynamic-votd" },
  },
```

- [ ] **Step 9.4: Typecheck, then run the seed (hits the PRODUCTION DB — established idempotent flow: it deletes and recreates the "Push Copy Library" draft agent's messages)**

```bash
bun run typecheck && bun run scripts/seed-push-copy-templates.ts
```

Expected: script reports created variants including the 12 new "VOTD: …" entries. (May need `dangerouslyDisableSandbox: true` for DB access.)

- [ ] **Step 9.5: Verify in prod (read-only)**

```bash
cat > /tmp/check-votd-seed.ts <<'EOF'
import { prisma } from "/Users/danluk/repos/nexus/src/lib/db";
const rows = await prisma.messageVariant.findMany({
  where: { name: { startsWith: "VOTD:" }, sourceTemplateId: null },
  select: { name: true, category: true, subcategory: true, iconImageUrl: true, title: true, body: true, deeplink: true },
  orderBy: [{ category: "asc" }, { name: "asc" }],
});
console.log(rows.length, "VOTD variants");
for (const r of rows) console.log(r.category, "|", r.subcategory, "|", r.name, "|", r.iconImageUrl ?? "-");
await prisma.$disconnect();
EOF
bun /tmp/check-votd-seed.ts
```

Expected: `12 VOTD variants` — 6 per category, image twins showing `__NEXUS_VERSE_IMAGE__`.

- [ ] **Step 9.6: Commit**

```bash
git add scripts/seed-push-copy-templates.ts && git commit -m "feat(votd): seed 12 dynamic VOTD library variants (3 permutations x +/-image x 2 categories)"
```

---

## Task 10: Picker taxonomy + `/api/variants` exposes `iconImageUrl`

**Files:**
- Modify: `src/lib/push-categories.ts`
- Modify: `src/app/api/variants/route.ts`

- [ ] **Step 10.1: Add the guided-prayer subcategory**

In `src/lib/push-categories.ts`, the `guided-prayer` entry's `subcategories` array (lines ~46–52) gains:

```typescript
      { value: "votd-dynamic", label: "Daily Verse (Dynamic)" },
```

(`guided-scripture` stays without subcategories — its dynamic variants mix with the static list.)

- [ ] **Step 10.2: Add `iconImageUrl` to the variants API select**

In `src/app/api/variants/route.ts`, the `select` object (lines 21–32) gains:

```typescript
        iconImageUrl: true,
```

(`MessageVariant` in `src/types/agent.ts` already declares `iconImageUrl?: string | null` — no type change needed.)

- [ ] **Step 10.3: Typecheck + existing tests**

```bash
bun run typecheck && bun run test:quick
```

- [ ] **Step 10.4: Commit**

```bash
git add src/lib/push-categories.ts src/app/api/variants/route.ts && git commit -m "feat(votd): expose iconImageUrl in variants API + votd-dynamic subcategory"
```

---

## Task 11: Picker + wizard carry-through and "+ today's verse image" hint

The sentinel must survive: library variant → picker draft → wizard form → POST `/api/agents` → Hono create (the Hono service already passes `iconImageUrl` through at `apps/api/src/routes/agents.ts:263` — no change there).

**Files:**
- Modify: `src/components/agents/template-picker.tsx`
- Modify: `src/components/agents/agent-wizard.tsx`

- [ ] **Step 11.1: template-picker.tsx — carry the field + show the hint**

Add the import:

```typescript
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
```

In the `DraftMessage` type (lines ~29–33), the variants array element type gains:

```typescript
    iconImageUrl?: string;
```

In `buildPayload` (lines ~163–184), where each selected variant is mapped (alongside `deeplink`/`sourceTemplateId`), add:

```typescript
        iconImageUrl: v.iconImageUrl ?? undefined,
```

In the variant card render (lines ~418–446), after the body `<p>` line, add the hint:

```tsx
                  {v.iconImageUrl === VERSE_IMAGE_SENTINEL && (
                    <p className="text-xs text-muted-foreground">+ today&apos;s verse image</p>
                  )}
```

- [ ] **Step 11.2: agent-wizard.tsx — accept + map the field**

In `addMessageFromTemplate` (lines ~307–321), the parameter type's variants element gains `iconImageUrl?: string`, and the variant map gains the field:

```typescript
  const addMessageFromTemplate = (msg: {
    name: string;
    channel: "push";
    variants: Array<{ name: string; title?: string; body: string; deeplink?: string; iconImageUrl?: string; sourceTemplateId: string }>;
  }) => {
```

and in the `.map(...)` that builds form variants:

```typescript
        iconImageUrl: v.iconImageUrl ?? "",
```

(`emptyVariant()` already initializes `iconImageUrl: ""` if the form field exists; if the form variant type lacks the field, add `iconImageUrl?: string` to it and keep `""` as the empty default — `handleSubmit` POSTs the full form object, and the API treats `""`/undefined as null.)

**Check before finishing:** confirm the POST body sends a non-empty `iconImageUrl` for image variants. If the wizard's submit mapping enumerates variant fields explicitly, add `iconImageUrl: v.iconImageUrl || undefined` there too.

- [ ] **Step 11.3: Typecheck + quick suite**

```bash
bun run typecheck && bun run test:quick
```

- [ ] **Step 11.4: Commit**

```bash
git add src/components/agents/template-picker.tsx src/components/agents/agent-wizard.tsx && git commit -m "feat(votd): carry iconImageUrl through picker/wizard + verse-image hint"
```

---

## Task 12: Demo/send VOTD resolution (test-send path)

`/api/demo/send` sends a real push to specific test users via Braze. It must resolve VOTD tags the same way the cron does, otherwise test sends would deliver literal `{{votd_reference}}` text. This is the path Task 14 (live QA) uses.

**Files:**
- Modify: `src/app/api/demo/send/route.ts`
- Test: `tests/integration/demo-send-votd.test.ts` (create)

- [ ] **Step 12.1: Write the failing integration test**

Create `tests/integration/demo-send-votd.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import {
  createAgent,
  createMessage,
  createPersona,
  createSchedulingRule,
  createUser,
  createVariant,
} from "../helpers/builders";
import { __resetVotdCalendarCacheForTests } from "@/lib/votd/votd-content";
import { userLocalDate } from "@/lib/votd/local-date";

// Admin session is required by the route; stub it like api.demo.send.test.ts does.
const mockAuth = { user: { email: "dan.luk@youversion.com" } };
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => mockAuth,
}));

const { POST } = await import("@/app/api/demo/send/route");

const realFetch = globalThis.fetch;

async function setupVotdAgent() {
  const persona = await createPersona();
  const agent = await createAgent();
  const message = await createMessage(agent.id);
  const variant = await createVariant(message.id, {
    name: "VOTD: Label + Reference",
    title: "{{guided_scripture_label}}",
    body: "{{votd_reference}}",
    deeplink: "https://www.bible.com/stories",
  });
  await createUser("usr_votd_demo", { personaId: persona.id });
  await createSchedulingRule(agent.id);
  return { agent, variant };
}

function send(agentId: string) {
  return POST(
    buildRequest("POST", { agentId, userIds: ["usr_votd_demo"] }) as NextRequest
  );
}

describe("POST /api/demo/send — VOTD variants", () => {
  beforeEach(async () => {
    await truncateAll();
    await prisma.votdDailyContent.deleteMany();
    __resetVotdCalendarCacheForTests();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("fails the user (not the request) when VOTD content is unavailable", async () => {
    const { agent } = await setupVotdAgent();
    // Every upstream fetch fails -> getVotdContent returns null.
    globalThis.fetch = (async () =>
      new Response("upstream down", { status: 500 })) as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ status: string; reason?: string }>;
    };
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("VOTD content unavailable");
  });

  test("resolves tags from cached content before the Braze gate", async () => {
    const { agent } = await setupVotdAgent();
    // Pre-seed today's row so no fetch is needed; user has no timezone
    // attribute -> America/Chicago fallback, language_tag "en" from builder.
    await prisma.votdDailyContent.create({
      data: {
        date: userLocalDate(null, new Date()),
        languageTag: "en",
        usfm: "JHN.3.16",
        reference: "John 3:16",
        verseText: "For God so loved the world...",
        versionId: 111,
        imageUrlIos: null,
        imageUrlAndroid: null,
      },
    });
    // Any fetch would be a bug (cache hit expected).
    globalThis.fetch = (async () => {
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    const res = await send(agent.id);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: Array<{ status: string; reason?: string }>;
    };
    // Braze env vars are absent in tests, so reaching the Braze gate proves
    // VOTD resolution + substitution completed without erroring.
    expect(data[0].status).toBe("failed");
    expect(data[0].reason).toBe("Braze not configured");
  });
});
```

- [ ] **Step 12.2: Run the test to verify it fails**

```bash
TEST_FILES=tests/integration/demo-send-votd.test.ts bun run test:int-reg
```

Expected: FAIL — first test gets `reason: "Braze not configured"` instead of `"VOTD content unavailable"` (route doesn't know about VOTD tags yet).

- [ ] **Step 12.3: Implement VOTD resolution in the route**

In `src/app/api/demo/send/route.ts`, add imports:

```typescript
import { hasVotdTags, substituteVotdTags } from "@/lib/votd/votd-tags";
import { guidedLabels } from "@/lib/votd/labels";
import { resolveVotdUserKey } from "@/lib/votd/votd-user-key";
import { getVotdContent } from "@/lib/votd/votd-content";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";
```

Extend the variant select (currently lines 61-64) to include the fields VOTD needs:

```typescript
      const variant = await prisma.messageVariant.findUnique({
        where: { id: decision.variantId },
        select: {
          name: true,
          title: true,
          body: true,
          deeplink: true,
          iconImageUrl: true,
        },
      });
```

Then insert the VOTD block **before** the `if (!brazeClient || !factory)` "Braze not configured" check (so integration tests can observe VOTD behavior without Braze configured), and switch the payload to the resolved values:

```typescript
      let title = variant.title ?? "";
      let body = variant.body;
      let iosImageUrl: string | undefined;
      let androidImageUrl: string | undefined;

      if (hasVotdTags(variant.title, variant.body)) {
        const trackedUser = await prisma.trackedUser.findUnique({
          where: { externalId: userId },
          select: { attributes: true },
        });
        const key = resolveVotdUserKey(trackedUser?.attributes ?? {}, new Date());
        const content = await getVotdContent(prisma, key.date, key.languageTag);
        if (!content) {
          return {
            userId,
            status: "failed" as const,
            variantName: variant.name,
            reason: "VOTD content unavailable",
          };
        }
        const labels = guidedLabels(content.languageTag);
        const subs = {
          guidedScriptureLabel: labels.guidedScripture,
          guidedPrayerLabel: labels.guidedPrayer,
          votdReference: content.reference,
          votdText: content.verseText,
        };
        title = substituteVotdTags(title, subs);
        body = substituteVotdTags(body, subs);
        if (variant.iconImageUrl === VERSE_IMAGE_SENTINEL) {
          iosImageUrl = content.imageUrlIos ?? undefined;
          androidImageUrl = content.imageUrlAndroid ?? undefined;
        }
      }
```

And update the `buildPushPayload` call (currently lines 71-77) to use the resolved values:

```typescript
      const payload = factory.buildPushPayload(
        {
          title,
          body,
          deeplink: variant.deeplink ?? undefined,
          iosImageUrl,
          androidImageUrl,
        },
        { externalUserIds: [userId] },
        campaignId,
        decision.brazeVariantId ?? undefined,
        false
      );
```

(`buildPushPayload` already supports `iosImageUrl`/`androidImageUrl` — same fields the cron's `sendVariantGroup` passes.)

- [ ] **Step 12.4: Run the test to verify it passes**

```bash
bun run typecheck && TEST_FILES=tests/integration/demo-send-votd.test.ts bun run test:int-reg
```

Expected: PASS (both tests).

- [ ] **Step 12.5: Commit**

```bash
git add src/app/api/demo/send/route.ts tests/integration/demo-send-votd.test.ts && git commit -m "feat(votd): resolve VOTD liquid tags in demo test sends"
```

---

## Task 13: Full check + MR + merge

- [ ] **Step 13.1: Run the full suite**

```bash
bun run check
```

Expected: all green (~5-8 min). Fix anything that fails before proceeding.

- [ ] **Step 13.2: Push the branch and open the MR**

Direct pushes to main are hook-blocked — always branch → MR → merge:

```bash
git push -u origin feat/votd-dynamic-guided-pushes
glab mr create --title "feat: dynamic daily VOTD Guided Scripture / Guided Prayer pushes" --description "Liquid-tag push variants that resolve to today's Verse of the Day per user (timezone + language aware), with optional localized verse image. Spec: docs/superpowers/specs/2026-06-11-dynamic-daily-guided-pushes-design.md" --source-branch feat/votd-dynamic-guided-pushes --target-branch main
```

- [ ] **Step 13.3: Merge**

```bash
glab mr merge <NUMBER> --remove-source-branch --yes
```

If glab returns a 401/405, it can be transient — retry the identical command once with the MR number before investigating.

---

## Task 14: Live QA — test sends to real devices (explicitly required)

Dan explicitly requested on-device confirmation before any agent adopts these variants. **Do not skip.** No agent uses the new library variants until Dan creates one, so merging first is safe.

Prerequisites: Task 13 merged and the Vercel deploy for main is live (Braze env vars only exist in deployed envs).

- [ ] **Step 14.1: Identify test users**

Ask Dan for test-user external IDs: one English user and one non-English user (e.g. `language_tag: "es"`), both with push tokens on a real device.

- [ ] **Step 14.2: Create a QA agent with the VOTD variants**

In the deployed app, Dan (or you via the UI/API) creates a throwaway agent whose message uses the seeded VOTD variants — at minimum:
- one text-only variant (e.g. "VOTD: Label + Reference")
- one image variant (e.g. "VOTD: Label + Reference (Verse Image)")

- [ ] **Step 14.3: Send via /api/demo/send**

From the deployed app's demo page (or curl with an admin session), POST to `/api/demo/send` with the QA agent id and the test-user IDs. Repeat as needed to cover:
- English user, text-only variant — title/body show resolved English label + today's reference/text (no literal `{{...}}`)
- English user, image variant — push arrives with today's verse image on iOS and Android
- Non-English user — label and verse reference/text arrive in the user's language
- Verify the deeplinks open Guided Scripture (`/stories`) and Guided Prayer (`/guides/1`)

- [ ] **Step 14.4: Confirmation gate**

Wait for Dan's explicit confirmation that the pushes look correct on device. Only after confirmation are the variants considered live/adoptable. Delete or pause the throwaway QA agent afterward.

---

## Self-review notes

- **Spec coverage:** all spec sections map to tasks — data model (Task 1), version map/labels/local-date (Tasks 2–4), tags (Task 5), content service + user key (Task 6), send-time resolution (Tasks 7–8), seeded variants (Task 9), picker/library surface (Tasks 10–11), test-send QA (Tasks 12, 14). Documented deviations from the spec (approved during planning): image flag is the `iconImageUrl === VERSE_IMAGE_SENTINEL` sentinel rather than a `votd-dynamic-image` subcategory (survives `sanitizeVariant`), and the verse endpoint is `verses.json` (plural, `references[]=` + `format=text`) rather than `verse.json`.
- **Type consistency:** `votdContentKey` uses the **space** separator everywhere (`` `${date} ${languageTag}` ``); `VotdContent` shape `{date, languageTag, usfm, reference, verseText, versionId, imageUrlIos, imageUrlAndroid}` is identical in Tasks 6, 7, and 12; `resolveVotdUserKey(attributes, at)` and `VotdSubstitutions {guidedScriptureLabel, guidedPrayerLabel, votdReference, votdText}` match across Tasks 6/7/8/12.
- **Environment guards:** schema change is additive DDL via `prisma db execute --stdin` only (never `migrate dev`/`db push`); seed script runs against prod intentionally and is idempotent; integration tests run one file at a time via `TEST_FILES=...`.




