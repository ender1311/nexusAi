import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the wizard's Next button disabled silently on step 1 — users got
// no explanation of what was missing until step 5 or a backend rejection.
// The 2026-06-10 restyle added inline hint text mirroring the gating logic.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AgentWizard } = await import("@/components/agents/agent-wizard");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/segments")) {
      return new Response(
        JSON.stringify({ data: [{ name: "VIP", userCount: 1200, assignedTo: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeInto(input: HTMLInputElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function nextButtons() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent?.trim() === "Next",
  );
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AgentWizard step-1 validation hints", () => {
  it("walks the hint through name → funnel stage and disables Next meanwhile", async () => {
    act(() => {
      root.render(<AgentWizard personas={[]} />);
    });
    await flush();

    expect(container.textContent).toContain("Enter an agent name to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Recommend Bible Plans"]',
    )!;
    typeInto(nameInput, "My Agent");

    expect(container.textContent).not.toContain("Enter an agent name to continue.");
    expect(container.textContent).toContain("Choose a funnel stage to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);
  });

  it("in segment mode, hints for includes and enables Next once one is picked", async () => {
    act(() => {
      root.render(<AgentWizard personas={[]} />);
    });
    await flush();

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Recommend Bible Plans"]',
    )!;
    typeInto(nameInput, "My Agent");

    clickButtonByText("Segment");
    expect(container.textContent).toContain("Select at least one include segment to continue.");
    expect(nextButtons().every((b) => b.disabled)).toBe(true);

    // The include SegmentCheckList renders first; its VIP row is the first match.
    const vipRow = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("VIP"),
    )!;
    act(() => {
      vipRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Select at least one include segment");
    expect(nextButtons().every((b) => !b.disabled)).toBe(true);
  });
});
