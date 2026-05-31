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
