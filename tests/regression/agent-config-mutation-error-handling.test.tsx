import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AGENT_PALETTE } from "@/types/agent";

// Regression: agent config editors (color picker, funnel config, audience cap,
// fallback send time, localization, edit sheet) fired their PATCH and immediately
// treated it as success — calling router.refresh() / showing "Saved" without
// checking res.ok. A 409 (segment already assigned) or 400 was silently swallowed.
// The fix checks res.ok, surfaces the server error inline, and only commits the
// optimistic UI / refresh on success.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let refreshCalls = 0;

// The global useRouter mock has no `refresh` — track it here.
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    refresh: () => {
      refreshCalls += 1;
    },
  }),
}));

const { AgentColorPicker } = await import("@/components/agents/agent-color-picker");
const { AgentEditSheet } = await import("@/components/agents/agent-edit-sheet");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  refreshCalls = 0;
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

describe("AgentColorPicker error handling", () => {
  const current = AGENT_PALETTE[0]!;
  const target = AGENT_PALETTE[1]!;

  it("surfaces the server error and does NOT change color or refresh when PATCH fails", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "color must be a 6-digit hex value" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentColorPicker agentId="a1" currentColor={current} usedColors={[]} />);
    });

    const swatch = container.querySelector<HTMLButtonElement>(`button[title="${target}"]`)!;
    act(() => {
      swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("color must be a 6-digit hex value");
    expect(refreshCalls).toBe(0);
    // The selected-color readout still shows the original color (no optimistic commit).
    expect(container.textContent).toContain(current);
  });

  it("refreshes and shows no error when PATCH succeeds", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "a1", color: target }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentColorPicker agentId="a1" currentColor={current} usedColors={[]} />);
    });

    const swatch = container.querySelector<HTMLButtonElement>(`button[title="${target}"]`)!;
    act(() => {
      swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(refreshCalls).toBe(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("AgentEditSheet segment-conflict handling", () => {
  function routedFetch(patchStatus: number, patchBody: object) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/segments")) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // PATCH /api/agents/:id
      void init;
      return new Response(JSON.stringify(patchBody), {
        status: patchStatus,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  function renderSheet() {
    act(() => {
      root.render(
        <AgentEditSheet
          agentId="a1"
          initialName="My Agent"
          initialDescription={null}
          initialAlgorithm="thompson"
          initialEpsilon={0.1}
          initialFunnelStage="wau"
          initialColor={AGENT_PALETTE[0]!}
          usedColors={[]}
          initialTargetSegmentName={null}
          initialSegmentTargeting={null}
          initialDailySendCap={null}
          initialDeeplinkOverride={null}
          hasVerseVariants={false}
        />,
      );
    });
  }

  function openSheet() {
    // The trigger is the only button in the container before the sheet opens.
    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function clickSave() {
    // Sheet content portals to document.body; find the "Save Changes" button.
    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"));
    const save = buttons.find((b) => b.textContent?.includes("Save Changes"))!;
    act(() => {
      save.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("shows the 409 conflict error and does NOT refresh when the segment is taken", async () => {
    globalThis.fetch = routedFetch(409, { error: 'Segment "VIP" is already assigned to agent "Other"' });

    renderSheet();
    openSheet();
    await flush();
    clickSave();
    await flush();

    expect(document.body.textContent).toContain("already assigned to agent");
    expect(refreshCalls).toBe(0);
  });

  it("refreshes and shows no error when the save succeeds", async () => {
    globalThis.fetch = routedFetch(200, { id: "a1", name: "My Agent" });

    renderSheet();
    openSheet();
    await flush();
    clickSave();
    await flush();

    expect(refreshCalls).toBe(1);
  });
});
