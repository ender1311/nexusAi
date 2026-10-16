import { describe, expect, it } from "bun:test";
import { BRANDS } from "@site/brand/presets";
import { validatePreset } from "@site/brand/validate";
import { midnight } from "@site/brand/presets/midnight";

describe("brand preset validator", () => {
  for (const preset of Object.values(BRANDS)) {
    it(`${preset.id} is a valid preset`, () => {
      expect(validatePreset(preset)).toEqual([]);
    });
  }

  it("registry keys match preset ids", () => {
    for (const [key, preset] of Object.entries(BRANDS)) expect(preset.id).toBe(key);
  });

  it("rejects a preset without the offer section", () => {
    const bad = { ...midnight, layout: { ...midnight.layout, sections: midnight.layout.sections.filter((s) => s !== "offer") } };
    expect(validatePreset(bad).join("\n")).toMatch(/offer/);
  });

  it("rejects duplicate sections", () => {
    const bad = { ...midnight, layout: { ...midnight.layout, sections: [...midnight.layout.sections, "faq" as const] } };
    expect(validatePreset(bad).join("\n")).toMatch(/duplicate/i);
  });

  it("rejects an invalid hex color and a missing token", () => {
    const light = { ...midnight.light, accent: "blue" };
    const withoutInk: Partial<typeof midnight.dark> = { ...midnight.dark };
    delete withoutInk.ink;
    const bad = { ...midnight, light, dark: withoutInk as typeof midnight.dark };
    const errors = validatePreset(bad).join("\n");
    expect(errors).toMatch(/light\.accent/);
    expect(errors).toMatch(/dark\.ink\b/);
  });

  it("rejects an unknown font key and a short chart palette", () => {
    const bad = {
      ...midnight,
      fonts: { ...midnight.fonts, display: "comic-sans" as typeof midnight.fonts.display },
      light: { ...midnight.light, chart: ["#000000"] as unknown as typeof midnight.light.chart },
    };
    const errors = validatePreset(bad).join("\n");
    expect(errors).toMatch(/comic-sans/);
    expect(errors).toMatch(/chart/);
  });
});
