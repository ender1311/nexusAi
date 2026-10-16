import { describe, expect, it } from "bun:test";
import { compositeOver, contrastRatio, relativeLuminance } from "@site/brand/contrast";
import { BRANDS } from "@site/brand/presets";
import { tokenSets } from "@site/brand/types";

describe("WCAG contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#000000")).toBeCloseTo(0);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1);
    // #767676 on white is the classic 4.54:1 grey.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("composites a translucent color over a base", () => {
    expect(compositeOver("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(compositeOver("#ff0000", 0, "#00ff00")).toBe("#00ff00");
  });
});

const AA = 4.5;

describe("every preset meets text contrast (AA, 4.5:1)", () => {
  for (const preset of Object.values(BRANDS)) {
    for (const { scheme, tokens: t } of tokenSets(preset)) {
      it(`${preset.id} / ${scheme}`, () => {
        const pairs: [string, string, string][] = [
          ["ink on bg", t.ink, t.bg],
          ["ink on surface", t.ink, t.surface],
          ["onAccent on accent", t.onAccent, t.accent],
          ["accentInk on bg", t.accentInk, t.bg],
          ["ink3 on bg", t.ink3, t.bg],
          ["ink3 on surface", t.ink3, t.surface],
          ["accentInk on surface", t.accentInk, t.surface],
          ["bad on bg", t.bad, t.bg],
          ["bad on surface", t.bad, t.surface],
          ["bad on badBg", t.bad, t.badBg],
          ["ok on surface", t.ok, t.surface],
          ["ok on okBg", t.ok, t.okBg],
          // The step-4 "Chosen" label sits on the chosen row: bg-accent/15 over the surface panel.
          ["ok on accent-15% tint", t.ok, compositeOver(t.accent, 0.15, t.surface)],
        ];
        const failures = pairs
          .map(([name, fg, bg]) => ({ name, ratio: contrastRatio(fg, bg) }))
          .filter(({ ratio }) => ratio < AA)
          .map(({ name, ratio }) => `${name} is ${ratio.toFixed(2)}:1`);
        expect(failures).toEqual([]);
      });
    }
  }
});
