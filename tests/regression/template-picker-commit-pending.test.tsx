import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRef } from "react";
import { TemplatePicker, type TemplatePickerHandle } from "@/components/agents/template-picker";
import type { VariantWithMessage } from "@/types/agent";

// Regression: agent-creation wizard dropped picked push verses because they
// lived only inside TemplatePicker's internal selection state. The fix exposes
// an imperative commitPending() that the wizard calls on "Next", committing the
// selection even if the user never clicked the inner "Add Message" button.
//
// This drives the REAL component in happy-dom: render the picker, wait for the
// mocked verse list, click a verse, then call commitPending() and assert the
// picked variant is emitted to onAddToDraft.

const VERSES: VariantWithMessage[] = [
  {
    id: "verse-a",
    messageId: "m1",
    name: "Open Bible Verse A",
    body: "Body A",
    title: "Title A",
    deeplink: "youversion://bible",
    status: "active",
    createdAt: new Date().toISOString(),
    message: { channel: "push", name: "Reader — Open Bible" },
  },
  {
    id: "verse-b",
    messageId: "m1",
    name: "Open Bible Verse B",
    body: "Body B",
    title: "Title B",
    deeplink: "youversion://bible",
    status: "active",
    createdAt: new Date().toISOString(),
    message: { channel: "push", name: "Reader — Open Bible" },
  },
];

// react-dom act() support flag — without it React logs noisy
// "testing environment is not configured to support act(...)" warnings.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Mock the /api/variants fetch the picker fires on mount.
  global.fetch = mock(async () =>
    new Response(JSON.stringify(VERSES), { status: 200, headers: { "Content-Type": "application/json" } }),
  ) as unknown as typeof fetch;

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function flush() {
  // Let the fetch promise + state updates settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("TemplatePicker.commitPending (wizard verse persistence)", () => {
  it("emits the picked verse and returns false when nothing is selected", async () => {
    const ref = createRef<TemplatePickerHandle>();
    const added: Array<{ name: string; variants: Array<{ name: string }> }> = [];

    await act(async () => {
      root.render(
        <TemplatePicker
          ref={ref}
          onAddToDraft={(msg) => added.push(msg as { name: string; variants: Array<{ name: string }> })}
        />,
      );
    });
    await flush();

    // Nothing selected yet → commit is a no-op.
    let committed = true;
    act(() => {
      committed = ref.current!.commitPending();
    });
    expect(committed).toBe(false);
    expect(added).toHaveLength(0);

    // Click the first verse card (cards carry the "p-2.5" utility class).
    const cards = Array.from(container.querySelectorAll<HTMLDivElement>('div[class*="p-2.5"]'))
      .filter((d) => d.textContent?.includes("Open Bible Verse A"));
    expect(cards.length).toBeGreaterThan(0);
    await act(async () => {
      cards[0].click();
    });

    // Now commitPending should emit the selected verse.
    act(() => {
      committed = ref.current!.commitPending();
    });
    expect(committed).toBe(true);
    expect(added).toHaveLength(1);
    expect(added[0].variants.map((v) => v.name)).toContain("Open Bible Verse A");
  });
});
