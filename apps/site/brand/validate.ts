import { isFontKey } from "./font-stacks";
import { isLogoKey } from "./logos";
import { SECTION_IDS, TOKEN_NAMES, tokenSets, type BrandPreset } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;
/** CSS values are injected into a <style> tag, so they must not be able to break out of it. */
const SAFE_CSS_VALUE = /^[^<>{};]+$/;

/** Every problem with a preset, as human-readable strings. Empty means valid. */
export function validatePreset(preset: BrandPreset): string[] {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(preset.id)) errors.push(`id "${preset.id}" must be lowercase kebab-case`);

  for (const [key, value] of Object.entries(preset.identity)) {
    if (typeof value !== "string" || value.trim() === "") errors.push(`identity.${key} is missing`);
  }
  if (!isLogoKey(preset.identity.logo)) errors.push(`identity.logo "${preset.identity.logo}" is not a known logo`);

  for (const { scheme, tokens } of tokenSets(preset)) {
    if (!tokens) {
      errors.push(`${scheme} token set is missing`);
      continue;
    }
    for (const name of TOKEN_NAMES) {
      const value: unknown = tokens[name];
      if (value === undefined) errors.push(`${scheme}.${name} is missing`);
      else if (typeof value !== "string" || !HEX.test(value)) errors.push(`${scheme}.${name} "${String(value)}" is not a 6-digit hex color`);
    }
    if (!Array.isArray(tokens.chart) || tokens.chart.length !== 4) errors.push(`${scheme}.chart must have exactly 4 colors`);
    else tokens.chart.forEach((c, i) => { if (!HEX.test(c)) errors.push(`${scheme}.chart[${i}] "${c}" is not a 6-digit hex color`); });
  }

  for (const slot of ["display", "body", "mono"] as const) {
    if (!isFontKey(preset.fonts[slot])) errors.push(`fonts.${slot} "${preset.fonts[slot]}" is not a known font key`);
  }

  const cssValues: Record<string, string> = {
    "fonts.displayWeight": preset.fonts.displayWeight,
    "fonts.displayTracking": preset.fonts.displayTracking,
    ...Object.fromEntries(Object.entries(preset.shape).map(([k, v]) => [`shape.${k}`, v])),
    ...Object.fromEntries(Object.entries(preset.text).map(([k, v]) => [`text.${k}`, v])),
  };
  for (const [key, value] of Object.entries(cssValues)) {
    if (typeof value !== "string" || !SAFE_CSS_VALUE.test(value)) errors.push(`${key} "${String(value)}" is not a safe CSS value`);
  }

  const { sections } = preset.layout;
  if (!sections.includes("offer")) errors.push(`layout.sections must include "offer"`);
  for (const s of sections) if (!(SECTION_IDS as readonly string[]).includes(s)) errors.push(`layout.sections has unknown section "${s}"`);
  const dupes = sections.filter((s, i) => sections.indexOf(s) !== i);
  if (dupes.length > 0) errors.push(`layout.sections has duplicate sections: ${[...new Set(dupes)].join(", ")}`);
  if (!["left", "centered"].includes(preset.layout.hero)) errors.push(`layout.hero "${preset.layout.hero}" must be "left" or "centered"`);
  if (!["compact", "comfortable", "airy"].includes(preset.density)) errors.push(`density "${preset.density}" is not a known density`);

  return errors;
}
