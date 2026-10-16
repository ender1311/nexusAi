import { describe, expect, it } from "bun:test";
import { allBrandsCss, brandCss } from "@site/brand/css";
import { BRANDS } from "@site/brand/presets";
import { midnight } from "@site/brand/presets/midnight";
import { humanHand } from "@site/brand/presets/human-hand";
import { TOKEN_NAMES } from "@site/brand/types";

const kebab = (s: string) => s.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

describe("brandCss", () => {
  it("emits every color token, chart color and scale token for a preset", () => {
    const css = brandCss(humanHand, '[data-brand="human-hand"]');
    for (const name of TOKEN_NAMES) expect(css).toContain(`--${kebab(name)}: ${humanHand.light[name]};`);
    humanHand.light.chart.forEach((c, i) => expect(css).toContain(`--chart-${i + 1}: ${c};`));
    for (const token of [
      "--font-display:", "--font-body:", "--font-code:", "--display-weight:", "--display-tracking:",
      "--r-sm:", "--r:", "--r-lg:", "--r-chip:", "--shadow:", "--shadow-pop:", "--border-width:",
      "--label-case:", "--label-tracking:", "--eyebrow-case:", "--eyebrow-tracking:", "--btn-case:", "--btn-weight:",
      "--section-y:", "--control-x:", "--control-y:",
    ]) expect(css).toContain(token);
    expect(css).toContain("--font-display: var(--font-instrument-serif)");
    expect(css).toContain("color-scheme: light;");
  });

  it("scopes every rule to the selector", () => {
    const css = brandCss(humanHand, ".x");
    expect(css.trim().startsWith(".x {")).toBe(true);
    expect(css).not.toContain(":root");
  });

  it("puts the dark set of an auto preset under prefers-color-scheme: dark", () => {
    const css = brandCss(midnight, '[data-brand="midnight"]');
    const [lightPart, darkPart] = css.split("@media (prefers-color-scheme: dark)");
    expect(lightPart).toContain(`--bg: ${midnight.light.bg};`);
    expect(darkPart).toContain('[data-brand="midnight"]');
    expect(darkPart).toContain(`--bg: ${midnight.dark.bg};`);
    expect(darkPart).not.toContain("--r-sm:");
  });

  it("allBrandsCss covers every preset under its data-brand selector", () => {
    const css = allBrandsCss();
    for (const id of Object.keys(BRANDS)) expect(css).toContain(`[data-brand="${id}"] {`);
  });

  it("never emits a value that could close the style tag", () => {
    expect(allBrandsCss()).not.toMatch(/<\/?style/i);
  });
});
