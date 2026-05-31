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
    es: { reference: "Juan 3:16", "verse-text": "Porque tanto amó Dios..." },
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
