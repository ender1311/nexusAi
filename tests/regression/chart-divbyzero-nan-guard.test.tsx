import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VariantComparison } from "@/components/charts/variant-comparison";
import { BetaBar } from "@/components/control-tower/user-inspector";
import type { VariantMetric } from "@/types/metrics";

// Regression: both VariantComparison and BetaBar divide by a denominator that
// can be 0 for a fresh agent/arm with no data yet (all ciHigh === 0, or
// alpha === beta === 0). Division by 0 yields NaN/Infinity, which React writes
// straight into the style width as "NaN%"/"Infinity%", visually breaking the
// bars. The fix clamps the denominator so a zero-scale renders 0%-wide bars.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeVariant(overrides: Partial<VariantMetric> = {}): VariantMetric {
  return {
    variantId: "v1",
    variantName: "Variant A",
    channel: "push",
    sends: 0,
    conversions: 0,
    conversionRate: 0,
    ciLow: 0,
    ciHigh: 0,
    reward: 0,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VariantComparison div-by-zero guard", () => {
  it("renders no NaN%/Infinity% widths when every variant has a zero CI scale", () => {
    act(() => {
      root.render(<VariantComparison variants={[makeVariant(), makeVariant({ variantId: "v2" })]} />);
    });

    const html = container.innerHTML;
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");

    // Every bar width should be a clean 0% under the clamped denominator.
    const bars = container.querySelectorAll<HTMLElement>('[style*="width"]');
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((bar) => {
      expect(bar.getAttribute("style") ?? "").not.toMatch(/NaN|Infinity/);
    });
  });

  it("still scales bar widths correctly when data is present", () => {
    act(() => {
      root.render(
        <VariantComparison
          variants={[makeVariant({ conversionRate: 5, ciLow: 4, ciHigh: 10, sends: 100 })]}
        />
      );
    });
    const html = container.innerHTML;
    expect(html).not.toContain("NaN");
    // conversionRate 5 / maxRate 10 = 50%
    expect(html).toContain("50%");
  });
});

describe("BetaBar div-by-zero guard", () => {
  it("renders 0% for a fresh arm where alpha === beta === 0", () => {
    act(() => {
      root.render(<BetaBar alpha={0} beta={0} />);
    });
    const html = container.innerHTML;
    expect(html).not.toContain("NaN");
    expect(html).toContain("0%");
  });

  it("computes the expected percentage when data is present", () => {
    act(() => {
      // alpha 3 / (3 + 1) = 75%
      root.render(<BetaBar alpha={3} beta={1} />);
    });
    expect(container.innerHTML).toContain("75%");
  });
});
