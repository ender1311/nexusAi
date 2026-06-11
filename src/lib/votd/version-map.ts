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
  sl: 376, sn: 32, sq: 292, sr: 202, sr_CYRILLIC: 1969, sw: 74, ta: 339,
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
