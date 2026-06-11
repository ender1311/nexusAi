import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentCard } from "@/components/agents/agent-card";
import type { Agent } from "@/types/agent";

// Regression: on the 3-column desktop agents grid the card header packed the
// agent name (flex-1 min-w-0 truncate) next to a shrink-0 control cluster
// (convergence label + status badge + pause toggle + delete). The cluster's
// max-content width exceeded the narrow card's header row, crushing the name
// to a single character ("Oracle" -> "O…"). happy-dom does no layout, so we
// validate the structural fix instead: the name row may only contain the
// small delete button, while the wide controls (convergence/status/pause)
// live on their own full-width row below the targeting badge.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Oracle",
    description: "New-user VOTD nudges",
    status: "active",
    sendingPaused: false,
    algorithm: "thompson",
    epsilon: 0.1,
    funnelStage: "wau",
    color: "#3b82f6",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _count: { goals: 1, messages: 1, variants: 18, decisions: 2100 },
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
    root.render(<AgentCard agent={agent} isAdmin convergenceState="exploring" />);
  });
}

function nameRow(): HTMLElement {
  const name = Array.from(container.querySelectorAll<HTMLElement>("p"))
    .find((el) => el.textContent === "Oracle");
  expect(name, "agent name element should exist").toBeDefined();
  // p -> name column div -> header name row
  return name!.parentElement!.parentElement!;
}

function findButton(text: string): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>("button"))
    .find((el) => el.textContent?.includes(text));
}

describe("AgentCard name row is never crushed by controls", () => {
  it("keeps the pause toggle out of the name row", () => {
    render(makeAgent());
    const pause = findButton("Pause sending");
    expect(pause, "pause toggle should render for admins").toBeDefined();
    expect(nameRow().contains(pause!)).toBe(false);
  });

  it("keeps the convergence label and status badge out of the name row", () => {
    render(makeAgent());
    const row = nameRow();
    expect(row.textContent).not.toContain("Exploring");
    expect(row.textContent).not.toContain("Active");
  });

  it("groups convergence, status badge, and pause toggle in a shared controls row", () => {
    render(makeAgent());
    const pause = findButton("Pause sending")!;
    const header = container.querySelector<HTMLElement>("[data-slot='card-header']")!;
    // controls row is a direct child of the header (own grid row)
    let controlsRow: HTMLElement | null = pause;
    while (controlsRow && controlsRow.parentElement !== header) {
      controlsRow = controlsRow.parentElement;
    }
    expect(controlsRow, "pause toggle should sit in a direct-child row of the header").not.toBeNull();
    expect(controlsRow!.textContent).toContain("Exploring");
    expect(controlsRow!.textContent).toContain("Active");
    // the controls row must not contain the name
    expect(controlsRow!.textContent).not.toContain("Oracle");
  });

  it("keeps only the compact delete button in the name row", () => {
    render(makeAgent());
    const row = nameRow();
    const del = row.querySelector<HTMLElement>("button[aria-label='Delete agent']");
    expect(del).not.toBeNull();
    expect(row.querySelectorAll("button").length).toBe(1);
  });

  it("still renders the targeting badge in its own header row (prior mobile fix)", () => {
    render(makeAgent());
    const header = container.querySelector<HTMLElement>("[data-slot='card-header']")!;
    const badge = Array.from(container.querySelectorAll<HTMLElement>("span"))
      .find((el) => el.textContent === "WAU");
    expect(badge).toBeDefined();
    expect(badge!.parentElement).toBe(header);
  });
});
