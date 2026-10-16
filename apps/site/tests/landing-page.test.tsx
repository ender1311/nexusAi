import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { LandingPage } from "@site/components/landing-page";
import { BRANDS } from "@site/brand/presets";
import { withPreset } from "@site/brand/presets";
import type { SectionId } from "@site/brand/types";

afterEach(cleanup);

function renderedSections(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-section]")].map((el) => el.getAttribute("data-section")!);
}

describe("LandingPage", () => {
  for (const preset of Object.values(BRANDS)) {
    it(`renders ${preset.id}'s sections in preset order`, () => {
      const { container } = render(<LandingPage brand={preset} />);
      expect(renderedSections(container)).toEqual(preset.layout.sections);
    });
  }

  it("follows a reordered, trimmed section list", () => {
    const sections: SectionId[] = ["offer", "hero", "faq"];
    const { container } = render(<LandingPage brand={withPreset("midnight", { layout: { sections, hero: "centered" } })} />);
    expect(renderedSections(container)).toEqual(sections);
    expect(container.querySelector('[data-section="hero"]')!.getAttribute("data-hero")).toBe("centered");
  });

  it("uses the preset's identity strings", () => {
    const brand = withPreset("editorial", { identity: { ...BRANDS.editorial!.identity, eyebrow: "Test eyebrow", name: "Test Studio" } });
    const { container } = render(<LandingPage brand={brand} />);
    expect(container.textContent).toContain("Test eyebrow");
    expect(container.textContent).toContain("Test Studio");
  });
});
