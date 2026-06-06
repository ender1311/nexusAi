import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/types/agent";

// Regression: on mobile the agent-card header controls (convergence + status +
// pause + delete) sit in a shrink-0 row that stole the header width, crushing
// the flex-1 name column. The funnel-stage badge lived inside that column with
// `truncate`, so it collapsed to a single letter ("Lapsed WAU" -> "L") and the
// funnel stage was effectively invisible. The fix moves the badge to its own
// full-width row directly under the header, so it renders its full label and is
// no longer a descendant of the squeezed name column.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Trinity",
    description: null,
    status: "active",
    sendingPaused: false,
    algorithm: "thompson",
    epsilon: 0.1,
    funnelStage: "lapsed_wau",
    color: "#3b82f6",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _count: { goals: 1, messages: 1, variants: 100, decisions: 0 },
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

function render(agent: Agent) {
  act(() => {
    root.render(<AgentCard agent={agent} />);
  });
}

// The badge renders as a <span> with no data-slot, so locate it by its exact
// text — the leaf element whose textContent is precisely the label.
function findBadge(text: string): HTMLElement {
  const badge = Array.from(container.querySelectorAll<HTMLElement>("span"))
    .find((el) => el.textContent === text);
  expect(badge, `badge with text "${text}" should exist`).toBeDefined();
  return badge!;
}

describe("AgentCard funnel-stage badge", () => {
  it("renders the full funnel-stage label, not a truncated letter", () => {
    render(makeAgent({ funnelStage: "lapsed_wau" }));
    // The whole label must be present in the DOM (not clipped to "L").
    expect(container.textContent).toContain("Lapsed WAU");
    findBadge("Lapsed WAU");
  });

  it("shows the named segment when one is set", () => {
    render(makeAgent({ targetSegmentName: "VIP donors" }));
    findBadge("Segment: VIP donors");
  });

  it("places the badge in its own header row, not inside the crushed name column", () => {
    render(makeAgent({ funnelStage: "wau" }));
    const badge = findBadge("WAU");

    // The badge must be a direct child of the card header (its own grid row),
    // so the shrink-0 controls can't squeeze it.
    const header = container.querySelector<HTMLElement>("[data-slot='card-header']");
    expect(header).not.toBeNull();
    expect(badge.parentElement).toBe(header);

    // And it must NOT live inside the agent-name element / its column.
    const name = Array.from(container.querySelectorAll<HTMLElement>("p"))
      .find((el) => el.textContent === "Trinity");
    expect(name).toBeDefined();
    expect(name!.parentElement!.contains(badge)).toBe(false);
  });
});
