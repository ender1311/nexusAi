import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/types/agent";

// Regression: agent cards in the same grid row rendered at different heights
// when one had a description and the other didn't. The grid stretches each
// cell, but the `h-full` on <Card> only resolves if every ancestor between the
// stretched grid cell and the card also carries height. The wrapper <div> and
// the <Link> sat in between with no height, so the card collapsed to its
// content height. The fix threads `h-full` through the wrapper div and the
// Link (block h-full). This test guards that the height chain stays intact.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Trinity",
    description: null,
    status: "active",
    algorithm: "thompson",
    epsilon: 0.1,
    funnelStage: "lapsed_dau4",
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

describe("AgentCard equal-height structure", () => {
  it("threads h-full through wrapper, link, and card so grid cells stretch evenly", () => {
    render(makeAgent());

    // Outer wrapper div must carry height down from the stretched grid cell.
    const wrapper = container.querySelector<HTMLDivElement>("div.relative");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("h-full");

    // The Link is the next link in the chain — it must be a block with h-full.
    const link = container.querySelector<HTMLAnchorElement>("a[href='/agents/a1']");
    expect(link).not.toBeNull();
    expect(link!.className).toContain("h-full");

    // The Card itself keeps h-full so it fills the now-tall link.
    const card = link!.firstElementChild as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card!.className).toContain("h-full");
  });

  it("keeps the same height chain whether or not the agent has a description", () => {
    // A description adds a line to the header — the source of the original
    // height mismatch. The structural h-full chain must be identical either way.
    render(makeAgent({ description: "re engage" }));

    const wrapper = container.querySelector<HTMLDivElement>("div.relative");
    const link = container.querySelector<HTMLAnchorElement>("a[href='/agents/a1']");
    const card = link?.firstElementChild as HTMLElement | null;

    expect(wrapper!.className).toContain("h-full");
    expect(link!.className).toContain("h-full");
    expect(card!.className).toContain("h-full");

    // Sanity: the description actually rendered (so this isn't a no-op path).
    expect(container.textContent).toContain("re engage");
  });
});
