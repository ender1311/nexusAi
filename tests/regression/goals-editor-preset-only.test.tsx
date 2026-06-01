import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GoalsEditor } from "@/components/goals/goals-editor";

// Regression: the standalone agent goals page used to accept free-text event
// names. It now only allows picking from the YouVersion preset list, so there
// must be no text input, and clicking a preset chip must add that exact goal.

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

function chipByLabel(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  );
}

describe("GoalsEditor (preset-only)", () => {
  it("exposes no free-text event-name input", async () => {
    await act(async () => {
      root.render(<GoalsEditor agentId="a1" initialGoals={[]} />);
    });
    expect(container.querySelectorAll("input").length).toBe(0);
  });

  it("adds the exact preset event when a chip is clicked, and dedupes", async () => {
    await act(async () => {
      root.render(<GoalsEditor agentId="a1" initialGoals={[]} />);
    });

    expect(container.textContent).toContain("Goals (0)");

    const gift = chipByLabel("Give a gift");
    expect(gift).toBeDefined();
    await act(async () => {
      gift!.click();
    });

    expect(container.textContent).toContain("Goals (1)");
    expect(container.textContent).toContain("gift_given");

    // The chip is now selected/disabled, so a second click is a no-op (dedupe).
    const giftAgain = chipByLabel("Give a gift");
    expect(giftAgain?.disabled).toBe(true);
    await act(async () => {
      giftAgain!.click();
    });
    expect(container.textContent).toContain("Goals (1)");
  });
});
