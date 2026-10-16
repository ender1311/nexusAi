import { FONT_STACKS } from "./font-stacks";
import { BRANDS } from "./presets";
import { tokenSets, TOKEN_NAMES, type BrandPreset, type Density, type TokenSet } from "./types";

/** Section rhythm and control padding per density. "comfortable" is the original site's spacing. */
export const DENSITY: Record<Density, { sectionY: string; controlX: string; controlY: string }> = {
  compact: { sectionY: "3rem", controlX: "0.875rem", controlY: "0.4375rem" },
  comfortable: { sectionY: "4rem", controlX: "1rem", controlY: "0.5rem" },
  airy: { sectionY: "5.5rem", controlX: "1.25rem", controlY: "0.625rem" },
};

const kebab = (s: string) => s.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

function colorDeclarations(t: TokenSet): string[] {
  return [
    ...TOKEN_NAMES.map((name) => `--${kebab(name)}: ${t[name]};`),
    ...t.chart.map((c, i) => `--chart-${i + 1}: ${c};`),
  ];
}

function scaleDeclarations(p: BrandPreset): string[] {
  const d = DENSITY[p.density];
  return [
    `--font-display: ${FONT_STACKS[p.fonts.display]};`,
    `--font-body: ${FONT_STACKS[p.fonts.body]};`,
    `--font-code: ${FONT_STACKS[p.fonts.mono]};`,
    `--display-weight: ${p.fonts.displayWeight};`,
    `--display-tracking: ${p.fonts.displayTracking};`,
    `--r-sm: ${p.shape.radiusSm};`,
    `--r: ${p.shape.radius};`,
    `--r-lg: ${p.shape.radiusLg};`,
    `--r-chip: ${p.shape.radiusChip};`,
    `--shadow: ${p.shape.shadow};`,
    `--shadow-pop: ${p.shape.shadowPop};`,
    `--border-width: ${p.shape.borderWidth};`,
    `--label-case: ${p.text.labelCase};`,
    `--label-tracking: ${p.text.labelTracking};`,
    `--eyebrow-case: ${p.text.eyebrowCase};`,
    `--eyebrow-tracking: ${p.text.eyebrowTracking};`,
    `--btn-case: ${p.text.btnCase};`,
    `--btn-weight: ${p.text.btnWeight};`,
    `--section-y: ${d.sectionY};`,
    `--control-x: ${d.controlX};`,
    `--control-y: ${d.controlY};`,
  ];
}

function rule(selector: string, declarations: string[], indent = ""): string {
  return `${indent}${selector} {\n${declarations.map((d) => `${indent}  ${d}`).join("\n")}\n${indent}}`;
}

/**
 * The preset's tokens as CSS custom properties, scoped to `selector`.
 * Light/dark presets set one scheme; "auto" sets light and overrides it under
 * prefers-color-scheme: dark. (Auto leaves color-scheme unset, as the original site did.)
 */
export function brandCss(preset: BrandPreset, selector: string): string {
  const [first, second] = tokenSets(preset);
  const scheme = preset.colorScheme === "auto" ? [] : [`color-scheme: ${preset.colorScheme};`];
  const base = rule(selector, [...scheme, ...colorDeclarations(first!.tokens), ...scaleDeclarations(preset)]);
  if (!second) return `${base}\n`;
  return `${base}\n@media (prefers-color-scheme: dark) {\n${rule(selector, colorDeclarations(second.tokens), "  ")}\n}\n`;
}

/** CSS for every preset under [data-brand="<id>"], so any element can opt into any brand. */
export function allBrandsCss(): string {
  return Object.values(BRANDS).map((p) => brandCss(p, `[data-brand="${p.id}"]`)).join("\n");
}
