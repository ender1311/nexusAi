import { describe, expect, it } from "bun:test";
import { chartThemes } from "@site/brand/chart-theme";
import { BRANDS } from "@site/brand/presets";
import { tokenSets } from "@site/brand/types";
import { chartChrome } from "@site/components/simulator/chart-chrome";

describe("chart chrome comes from the preset", () => {
  for (const preset of Object.values(BRANDS)) {
    for (const { scheme, tokens } of tokenSets(preset)) {
      it(`${preset.id} / ${scheme}: axes, grid, tooltip and series`, () => {
        const theme = chartThemes(preset)[scheme];
        const chrome = chartChrome(theme);
        expect(theme.series).toEqual(tokens.chart);
        expect(chrome.tick.fill).toBe(tokens.ink3);
        expect(chrome.axisStroke).toBe(tokens.line);
        expect(chrome.gridStroke).toBe(tokens.line);
        expect(chrome.tooltip.contentStyle).toEqual({
          background: tokens.surface, border: `1px solid ${tokens.line}`, borderRadius: preset.shape.radius, color: tokens.ink,
        });
        expect(chrome.tooltip.labelStyle.color).toBe(tokens.ink);
        expect(chrome.tooltip.itemStyle.color).toBe(tokens.ink);
      });
    }
  }

  it("an auto preset gets a separate dark theme; a light-only preset reuses light", () => {
    const midnight = chartThemes(BRANDS.midnight);
    expect(midnight.dark.surface).not.toBe(midnight.light.surface);
    const editorial = chartThemes(BRANDS.editorial);
    expect(editorial.dark).toEqual(editorial.light);
  });
});
