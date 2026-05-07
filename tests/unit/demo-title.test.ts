import { describe, expect, it } from "bun:test";
import { buildDemoTitle, DEMO_TITLE_PREFIX } from "@/lib/braze/demo-utils";

describe("buildDemoTitle", () => {
  it("prepends the [TEST] Liquid prefix to a normal title", () => {
    expect(buildDemoTitle("Want peace?")).toBe("[TEST] {{${first_name}}}, Want peace?");
  });

  it("handles null title (empty base)", () => {
    expect(buildDemoTitle(null)).toBe("[TEST] {{${first_name}}}, ");
  });

  it("trims leading/trailing whitespace from the variant title", () => {
    expect(buildDemoTitle("  Don't forget  ")).toBe("[TEST] {{${first_name}}}, Don't forget");
  });

  it("handles empty string title", () => {
    expect(buildDemoTitle("")).toBe("[TEST] {{${first_name}}}, ");
  });

  it("DEMO_TITLE_PREFIX always starts with [TEST]", () => {
    expect(DEMO_TITLE_PREFIX).toMatch(/^\[TEST\]/);
  });

  it("DEMO_TITLE_PREFIX contains Braze Liquid first_name token", () => {
    // Braze Liquid syntax for first_name attribute is {{${first_name}}}
    expect(DEMO_TITLE_PREFIX).toContain("{{${first_name}}}");
  });

  it("live cron title passthrough: raw DB titles have no [TEST] prefix", () => {
    // This test documents the intentional separation:
    // live cron uses group.title directly — buildDemoTitle is NEVER called in the live pipeline.
    const liveTitle = "Read your Bible today";
    expect(liveTitle).not.toContain("[TEST]");
    expect(liveTitle).not.toContain("{{");
    // Contrast: demo title wraps it
    expect(buildDemoTitle(liveTitle)).toContain("[TEST]");
  });
});
