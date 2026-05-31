import { describe, it, expect } from "bun:test";
import { stripLangSuffix, buildImportPlan } from "@/lib/push-import/plan";
import type { GroupedPush, VariantSnapshot } from "@/lib/push-import/types";

function group(stem: string, langs: Record<string, { title?: string | null; body: string }>): GroupedPush {
  const byLang = new Map(Object.entries(langs).map(([l, c]) => [l, { title: c.title ?? null, body: c.body, bodyPersonal: null }]));
  return { stem, byLang };
}

describe("stripLangSuffix", () => {
  it("strips the -<lang>.json suffix from a sourceFile to get the stem", () => {
    expect(stripLangSuffix("2026-01-daily-remind-PUSH-1-en.json")).toBe("2026-01-daily-remind-PUSH-1");
    expect(stripLangSuffix("foo-bar-zh_TW.yml")).toBe("foo-bar");
  });
  it("returns the input unchanged when no recognizable suffix", () => {
    expect(stripLangSuffix("foo-bar")).toBe("foo-bar");
  });
});

describe("buildImportPlan", () => {
  const variants: VariantSnapshot[] = [
    { id: "v1", name: "Daily Remind 1", body: "take a moment in God's Word today.", sourceFile: "2026-01-daily-remind-PUSH-1-en.json", existingLanguages: new Set(["es"]) },
  ];

  it("matches stem to variant and plans creates/updates, skipping en", () => {
    const plan = buildImportPlan(
      [group("2026-01-daily-remind-PUSH-1", {
        en: { body: "take a moment in God's Word today." },
        es: { title: "ES", body: "es body" },   // existing → update
        pt: { title: "PT", body: "pt body" },    // new → create
      })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched).toHaveLength(1);
    const m = plan.matched[0];
    expect(m.messageVariantId).toBe("v1");
    const byLang = Object.fromEntries(m.languages.map((l) => [l.language, l.action]));
    expect(byLang).toEqual({ es: "update", pt: "create" }); // no "en" entry
    expect(m.englishDivergence).toBeNull(); // en body identical
    expect(plan.totals).toMatchObject({ creates: 1, updates: 1, matchedStems: 1, unmatchedStems: 0 });
  });

  it("flags english divergence when the en file differs from variant.body", () => {
    const plan = buildImportPlan(
      [group("2026-01-daily-remind-PUSH-1", { en: { body: "NEW english copy" }, es: { body: "es" } })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched[0].englishDivergence).toEqual({ incoming: "NEW english copy", current: "take a moment in God's Word today." });
  });

  it("reports unmatched stems", () => {
    const plan = buildImportPlan(
      [group("unknown-stem-PUSH-9", { en: { body: "x" }, es: { body: "y" } })],
      variants,
      { refreshEnglish: false },
    );
    expect(plan.matched).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0]).toMatchObject({ stem: "unknown-stem-PUSH-9", matched: false });
    expect(plan.unmatched[0].languages.sort()).toEqual(["en", "es"]);
  });
});
