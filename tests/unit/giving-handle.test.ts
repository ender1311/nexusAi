import { describe, expect, it } from "bun:test";
import {
  deriveGivingStrategy, deriveGivingFrequency, deriveGivingDefaultUsd,
  hasUnsubstitutedTokens, resolveGivingHandle,
} from "@/lib/engine/giving-handle";

describe("deriveGiving*", () => {
  it("strategy is null for non-dynamic-handle, else from actionFeatures (default blend)", () => {
    expect(deriveGivingStrategy("specific-verse", {})).toBeNull();
    expect(deriveGivingStrategy("dynamic-handle", {})).toBe("blend");
    expect(deriveGivingStrategy("dynamic-handle", { givingHandleStrategy: "avg-gift" })).toBe("avg-gift");
  });
  it("frequency defaults monthly; default USD clamps via engine (>0 else 25)", () => {
    expect(deriveGivingFrequency({})).toBe("monthly");
    expect(deriveGivingFrequency({ givingFrequency: "once" })).toBe("once");
    expect(deriveGivingDefaultUsd({})).toBe(25);
    expect(deriveGivingDefaultUsd({ givingHandleDefaultUsd: 50 })).toBe(50);
  });
});

describe("hasUnsubstitutedTokens", () => {
  it("detects leftover {{...}} in any part", () => {
    expect(hasUnsubstitutedTokens("Give $25 a month", "600 Bibles")).toBe(false);
    expect(hasUnsubstitutedTokens("Give {{ask}} a month", null)).toBe(true);
    expect(hasUnsubstitutedTokens(null, "{{bibles}} Bibles")).toBe(true);
  });
});

describe("resolveGivingHandle", () => {
  it("substitutes {{ask}}/{{bibles}} and builds the give URL when no explicit deeplink", () => {
    const r = resolveGivingHandle({
      title: "Become a Sower", body: "{{ask}}/mo → {{bibles}} Bibles",
      explicitDeeplink: null, strategy: "blend", frequency: "monthly", defaultUsd: 25, attrs: {}, multiplier: 24,
    });
    expect(r.body).toBe("$25/mo → 600 Bibles");
    expect(hasUnsubstitutedTokens(r.title, r.body)).toBe(false);
    expect(r.deeplink).toContain("https://www.bible.com/give?");
    expect(r.deeplink).toContain("amount=25");
  });
  it("an explicit deeplink wins (find-out-more → Sowers) but copy still substitutes", () => {
    const r = resolveGivingHandle({
      title: null, body: "A gift of {{ask}} reaches {{bibles}}. Find out more.",
      explicitDeeplink: "https://youversion.com/sowers", strategy: "blend", frequency: "monthly", defaultUsd: 25, attrs: {}, multiplier: 24,
    });
    expect(r.body).toBe("A gift of $25 reaches 600. Find out more.");
    expect(r.deeplink).toBe("https://youversion.com/sowers");
  });
});
