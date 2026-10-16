import { tokenSets, type BrandPreset, type TokenSet } from "./types";

/**
 * What a chart needs from the brand. Recharts takes literal values (SVG attributes
 * and inline styles), so charts read these from the preset object, never from
 * getComputedStyle.
 */
export type ChartTheme = {
  series: readonly string[];
  surface: string;
  line: string;
  ink: string;
  ink3: string;
  radius: string;
};

/** One theme per OS color scheme. Light-only and dark-only presets use the same theme for both. */
export type ChartThemes = { light: ChartTheme; dark: ChartTheme };

function themeFor(tokens: TokenSet, radius: string): ChartTheme {
  return { series: tokens.chart, surface: tokens.surface, line: tokens.line, ink: tokens.ink, ink3: tokens.ink3, radius };
}

export function chartThemes(preset: BrandPreset): ChartThemes {
  const sets = tokenSets(preset);
  const light = themeFor(sets.find((s) => s.scheme === "light")?.tokens ?? sets[0]!.tokens, preset.shape.radius);
  const dark = themeFor(sets.find((s) => s.scheme === "dark")?.tokens ?? sets[0]!.tokens, preset.shape.radius);
  return { light, dark };
}
