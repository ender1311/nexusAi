// Pure helper: resolves a per-variant translation map where cloned variants
// (sourceTemplateId != null) inherit translations from their template when they
// have no rows of their own. This is the single source of truth used by the
// select-and-send cron; extracting it here makes it unit-testable without DB.

import type { LocalizedCopy } from "@/lib/push-locale";

type TranslationRow = {
  messageVariantId: string;
  language: string;
  title: string | null;
  body: string;
};

type VariantRef = {
  id: string;
  sourceTemplateId: string | null;
};

/**
 * Build a Map<variantId, Map<language, LocalizedCopy>> from a flat list of
 * MessageVariantTranslation rows and the agent's variant references.
 *
 * Rules:
 *  - If a variant has its own rows → use them (clone's own translations win).
 *  - If a variant has no own rows AND has a sourceTemplateId that has rows →
 *    inherit the template's map (resolves clone → template translations).
 *  - If neither applies, the variant is absent from the result (caller treats
 *    it as "no translations" and strict-skips non-English recipients).
 */
export function resolveTranslationsByVariant(
  rows: TranslationRow[],
  variants: VariantRef[],
): Map<string, Map<string, LocalizedCopy>> {
  // Build a raw id → Map<lang, copy> index from all loaded rows.
  const byId = new Map<string, Map<string, LocalizedCopy>>();
  for (const r of rows) {
    let m = byId.get(r.messageVariantId);
    if (!m) {
      m = new Map();
      byId.set(r.messageVariantId, m);
    }
    m.set(r.language, { title: r.title, body: r.body });
  }

  // Resolve each variant: own rows first, then template fallback.
  const result = new Map<string, Map<string, LocalizedCopy>>();
  for (const v of variants) {
    const own = byId.get(v.id);
    if (own && own.size > 0) {
      result.set(v.id, own);
    } else if (v.sourceTemplateId) {
      const tmpl = byId.get(v.sourceTemplateId);
      if (tmpl && tmpl.size > 0) {
        result.set(v.id, tmpl);
      }
    }
  }

  return result;
}
