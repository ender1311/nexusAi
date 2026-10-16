import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { generateFontModules, presetWebFonts } from "@site/brand/font-codegen";
import { WEB_FONTS } from "@site/brand/font-stacks";
import { activeBrand, BRANDS } from "@site/brand/presets";

const loaderCalls = (src: string) => [...src.matchAll(/(\w+)\(\{[^}]*variable: "(--font-[a-z-]+)"[^}]*preload: (true|false)/g)]
  .map((m) => ({ variable: m[2]!, preload: m[3] === "true" }));

describe("font codegen", () => {
  it("preloads exactly the active preset's web fonts, and declares the rest unpreloaded for /brand", () => {
    for (const preset of Object.values(BRANDS)) {
      const { active, preview } = generateFontModules(preset);
      const wanted: string[] = presetWebFonts(preset).map((k) => WEB_FONTS[k]!.variable).sort();
      const activeCalls = loaderCalls(active);
      expect(activeCalls.map((c) => c.variable).sort()).toEqual(wanted);
      expect(activeCalls.every((c) => c.preload)).toBe(true);
      const previewCalls = loaderCalls(preview);
      expect(previewCalls.every((c) => !c.preload)).toBe(true);
      expect(previewCalls.some((c) => wanted.includes(c.variable))).toBe(false);
      expect([...activeCalls, ...previewCalls]).toHaveLength(Object.keys(WEB_FONTS).length);
    }
  });

  it("generates no loader at all for a preset on system fonts", () => {
    const { active } = generateFontModules(BRANDS.midnight);
    expect(presetWebFonts(BRANDS.midnight)).toEqual([]);
    expect(active).not.toContain("next/font");
    expect(active).toContain('export const activeFontVariables = "";');
  });

  // pretest regenerates them, so this holds for whatever NEXT_PUBLIC_BRAND is set
  // (unset → midnight, the version committed to git).
  it("the generated files on disk match the active brand", () => {
    const { active, preview } = generateFontModules(activeBrand());
    const dir = path.join(import.meta.dir, "..", "brand");
    expect(readFileSync(path.join(dir, "active-fonts.generated.ts"), "utf8")).toBe(active);
    expect(readFileSync(path.join(dir, "preview-fonts.generated.ts"), "utf8")).toBe(preview);
  });
});
