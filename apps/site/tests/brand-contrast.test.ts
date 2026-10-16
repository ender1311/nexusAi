import { describe, expect, it } from "bun:test";
import { contrastRatio, relativeLuminance } from "@site/brand/contrast";
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
        ];
        for (const [name, fg, bg] of pairs) {
          const ratio = contrastRatio(fg, bg);
          if (ratio < AA) throw new Error(`${preset.id}/${scheme}: ${name} is ${ratio.toFixed(2)}:1`);
          expect(ratio).toBeGreaterThanOrEqual(AA);
        }
      });
    }
  }
});
