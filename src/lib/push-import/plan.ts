import type { GroupedPush, VariantSnapshot, ImportPlan, PerLanguagePlan, StemPlan } from "./types";

const SUFFIX = /-[a-z]{2,3}(_[a-z]{2,4})?\.(json|ya?ml)$/i;

/** Strip a trailing `-<lang>.{json,yml}` suffix to recover the shared stem. */
export function stripLangSuffix(sourceFile: string): string {
  return sourceFile.replace(SUFFIX, "");
}

export function buildImportPlan(
  groups: GroupedPush[],
  variants: VariantSnapshot[],
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
  let creates = 0, updates = 0;

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
      englishDivergence,
    });
  }

  return {
    matched,
    unmatched,
    totals: {
      stems: groups.length,
      matchedStems: matched.length,
      unmatchedStems: unmatched.length,
      creates,
      updates,
      noops: 0, // plan never produces noops; noops are a commit-stage concept
    },
  };
}
