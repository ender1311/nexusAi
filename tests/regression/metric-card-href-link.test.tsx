import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MetricCard } from "@/components/charts/metric-card";

// Regression: the dashboard "Active Agents" metric card was a plain, non-
// interactive card — tapping it did nothing, which is a dead end on mobile
// where the card looks tappable. MetricCard now takes an optional `href`; when
// set, the whole card is wrapped in a Next.js Link to that route. This guards
// both that the link is rendered when href is given and that cards without an
// href stay non-interactive (so the other dashboard tiles aren't accidentally
// turned into links).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("MetricCard href linking", () => {
  it("wraps the card in a link to the given route when href is set", () => {
    act(() => {
      root.render(<MetricCard title="Active Agents" value={4} description="currently running" href="/agents" />);
    });

    const link = container.querySelector<HTMLAnchorElement>('a[href="/agents"]');
    expect(link).not.toBeNull();
    // The value still renders inside the link.
    expect(link!.textContent).toContain("Active Agents");
    expect(link!.textContent).toContain("4");
  });

  it("renders no link when href is omitted (other dashboard tiles stay static)", () => {
    act(() => {
      root.render(<MetricCard title="Tracked Users" value="33.9M" description="synced from Hightouch" />);
    });

    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Tracked Users");
  });
});
