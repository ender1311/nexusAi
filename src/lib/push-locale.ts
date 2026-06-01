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

/**
 * Strict variant of resolvePushLocale: returns null instead of falling back to
 * English when no translation matches a non-English recipient. Used when an agent
 * opts into "localize push" with no English fallback — recipients we cannot serve
 * in their own language are skipped entirely rather than sent the English copy.
 *
 *   1. blank / unparseable tag           -> null (skip; language unknown)
 *   2. English recipient (primary "en")  -> English copy (always available)
 *   3. exact full-tag match (es_ES)      -> translation
 *   4. base-subtag match (es_ES -> es)   -> translation (skipped for zh)
 *   5. non-English, no match             -> null (skip)
 */
export function resolvePushLocaleStrict(
  tag: string | null | undefined,
  translationsByLang: Map<string, LocalizedCopy>,
  englishVariant: { title: string | null; body: string },
): LocalizedCopy | null {
  const norm = tag ? normalizePushLocaleTag(tag) : null;
  if (!norm) return null;
  if (norm.primary === "en") return { title: englishVariant.title, body: englishVariant.body };

  const exact = translationsByLang.get(norm.full);
  if (exact) return exact;

  if (norm.primary !== "zh") {
    const base = translationsByLang.get(norm.primary);
    if (base) return base;
  }
  return null;
}
