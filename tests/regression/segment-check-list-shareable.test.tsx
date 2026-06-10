import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SegmentCheckList } from "@/components/agents/segment-check-list";

// Regression: segments targeted by another agent were disabled in the picker
// (segment-level exclusivity). 2026-06-10: segments are shareable across
// agents — exclusivity is per USER via lockedByAgentId at recruitment, so the
// row must stay clickable and only show who else targets it.

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

const taken = { name: "new_user_21day_10percent", userCount: 7000, assignedTo: "Oracle" };

describe("SegmentCheckList shareable segments", () => {
  it("keeps a segment targeted by another agent clickable and selectable", () => {
    let selected: string[] = [];
    act(() => {
      root.render(
        <SegmentCheckList
          segments={[taken]}
          selected={selected}
          currentAgentTargetNames={[]}
          onChange={(next) => {
            selected = next;
          }}
        />,
      );
    });

    const row = container.querySelector<HTMLButtonElement>("button")!;
    expect(row.disabled).toBe(false);
    expect(row.textContent).toContain("also targeted by Oracle");

    act(() => {
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(selected).toEqual(["new_user_21day_10percent"]);
  });

  it("suppresses the targeted-by label when the current agent is the one targeting it", () => {
    act(() => {
      root.render(
        <SegmentCheckList
          segments={[taken]}
          selected={[taken.name]}
          currentAgentTargetNames={[taken.name]}
          onChange={() => {}}
        />,
      );
    });

    expect(container.textContent).not.toContain("also targeted by");
    expect(container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  });
});
