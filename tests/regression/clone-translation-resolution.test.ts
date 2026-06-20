// Bug: cloned variants had no MessageVariantTranslation rows of their own, so the
// cron looked them up by the clone id, found none, and strict-skipped non-English
// users. Translations live on the template; resolve through sourceTemplateId.
// Fix: resolveTranslationsByVariant() loads translations for the union of variant ids
// and their non-null sourceTemplateIds, then falls back to the template map for
// clones with no own rows.
import { describe, it, expect } from "bun:test";
import { resolveTranslationsByVariant } from "@/lib/cron/translation-resolver";
import type { LocalizedCopy } from "@/lib/push-locale";

const es: LocalizedCopy = { title: "Título", body: "Cuerpo" };
const pt: LocalizedCopy = { title: "Título PT", body: "Corpo" };

describe("resolveTranslationsByVariant", () => {
  it("clone with no own translations inherits template map via sourceTemplateId", () => {
    const templateId = "tmpl-1";
    const cloneId = "clone-1";

    // Rows: only the template variant has an `es` translation
    const rows = [
      { messageVariantId: templateId, language: "es", title: es.title, body: es.body },
    ];

    // Variants: clone references the template, has no own rows
    const variants = [
      { id: cloneId, sourceTemplateId: templateId },
    ];

    const result = resolveTranslationsByVariant(rows, variants);

    // Clone should resolve to the template's translation map
    expect(result.has(cloneId)).toBe(true);
    expect(result.get(cloneId)?.get("es")).toEqual(es);
  });

  it("clone with its own translations uses its own map (not template's)", () => {
    const templateId = "tmpl-2";
    const cloneId = "clone-2";

    // Template has es, clone has pt (its own row)
    const rows = [
      { messageVariantId: templateId, language: "es", title: es.title, body: es.body },
      { messageVariantId: cloneId, language: "pt", title: pt.title, body: pt.body },
    ];

    const variants = [
      { id: cloneId, sourceTemplateId: templateId },
    ];

    const result = resolveTranslationsByVariant(rows, variants);

    const cloneMap = result.get(cloneId);
    expect(cloneMap?.has("pt")).toBe(true);
    // Clone's own map should NOT inherit es from the template
    expect(cloneMap?.has("es")).toBe(false);
  });

  it("standalone variant (no sourceTemplateId) with own translations maps itself", () => {
    const variantId = "v-standalone";

    const rows = [
      { messageVariantId: variantId, language: "es", title: es.title, body: es.body },
    ];

    const variants = [
      { id: variantId, sourceTemplateId: null },
    ];

    const result = resolveTranslationsByVariant(rows, variants);

    expect(result.get(variantId)?.get("es")).toEqual(es);
  });

  it("clone with no own translations and no template rows is not added to map", () => {
    const templateId = "tmpl-3";
    const cloneId = "clone-3";

    // No rows at all (template has no translations either)
    const rows: { messageVariantId: string; language: string; title: string | null; body: string }[] = [];

    const variants = [
      { id: cloneId, sourceTemplateId: templateId },
    ];

    const result = resolveTranslationsByVariant(rows, variants);

    // No template map → clone gets nothing (consistent with "no translations" behavior)
    expect(result.has(cloneId)).toBe(false);
  });

  it("multiple clones of the same template all inherit the template map", () => {
    const templateId = "tmpl-4";
    const clone1 = "clone-4a";
    const clone2 = "clone-4b";

    const rows = [
      { messageVariantId: templateId, language: "es", title: es.title, body: es.body },
      { messageVariantId: templateId, language: "pt", title: pt.title, body: pt.body },
    ];

    const variants = [
      { id: clone1, sourceTemplateId: templateId },
      { id: clone2, sourceTemplateId: templateId },
    ];

    const result = resolveTranslationsByVariant(rows, variants);

    expect(result.get(clone1)?.get("es")).toEqual(es);
    expect(result.get(clone1)?.get("pt")).toEqual(pt);
    expect(result.get(clone2)?.get("es")).toEqual(es);
    expect(result.get(clone2)?.get("pt")).toEqual(pt);
  });
});
