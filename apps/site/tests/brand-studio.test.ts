import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { BRANDS } from "@site/brand/presets";
import { midnight } from "@site/brand/presets/midnight";
import { studioBrand, studioIcon } from "@site/brand/studio";

describe("studio brand", () => {
  it("takes the accent and colors from the preset", () => {
    const brand = studioBrand(midnight);
    expect(brand).toMatchObject({ version: 1, id: "nexus", name: "Nexus", icon: "icon.svg" });
    expect(brand.colors.accent).toBe(midnight.light.accent);
    expect(brand.colors.dark?.accent).toBe(midnight.dark.accent);
    expect(studioIcon(midnight)).toContain('stop-color="#6580ff"');
  });

  it("hashes the icon it serves, for every preset", () => {
    for (const preset of Object.values(BRANDS)) {
      const icon = studioIcon(preset);
      expect(studioBrand(preset).iconSha256).toBe(createHash("sha256").update(icon).digest("hex"));
      expect(icon.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(studioBrand(preset).colors.accent).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
