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
  // Alternative spellings found in campaign YAML files
  "1JHN": "1 John",    "2JHN": "2 John",     "3JHN": "3 John",
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
  "1JHN": 62, "2JHN": 63, "3JHN": 64,
};

type VersePart = { book: string; chapter: number; verse: number };

function parsePart(part: string): VersePart | null {
  const segments = part.split(".");
  if (segments.length < 3) return null;
  const verse = parseInt(segments[segments.length - 1], 10);
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
