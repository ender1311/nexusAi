import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression 1: AgentStatusToggle fired the PATCH and immediately called
// router.refresh() without checking res.ok. A failed status update (e.g. 500)
// was silently swallowed — the UI refreshed as if it had succeeded and the user
// got no feedback. The fix checks res.ok, throws on failure, surfaces the error
// via toast.error, and only calls router.refresh() on success.
//
// Regression 2: the active-state trigger was labelled "Pause", identical to the
// AgentPauseToggle next to it on the agent detail page — two "Pause" buttons
// with wildly different blast radius (status flip releases the whole cohort).
// The trigger must say "Deactivate" and the cohort-releasing PATCH must go
// through an AlertDialog confirmation instead of firing on first click.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let refreshCalls = 0;
const toastErrors: string[] = [];

// Local override: the global useRouter mock has no `refresh`. Track it here.
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

mock.module("sonner", () => ({
  toast: {
    error: (msg: string) => {
      toastErrors.push(msg);
    },
    success: () => {},
  },
}));

const { AgentStatusToggle } = await import("@/components/agents/agent-status-toggle");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  refreshCalls = 0;
  toastErrors.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

function clickTrigger() {
  const button = container.querySelector("button")!;
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function findDialogButton(text: string): HTMLButtonElement | undefined {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) return undefined;
  return Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(text));
}

async function confirmDeactivate() {
  await act(async () => {
    findDialogButton("Deactivate agent")!.click();
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AgentStatusToggle confirmation", () => {
  it('labels the active-state trigger "Deactivate" (never "Pause") and confirms before PATCHing', () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentStatusToggle agentId="a1" agentName="Oracle" status="active" />);
    });

    const trigger = container.querySelector("button")!;
    expect(trigger.textContent).toContain("Deactivate");
    expect(trigger.textContent).not.toContain("Pause");

    clickTrigger();

    // Cohort-releasing PATCH must NOT fire until the user confirms.
    expect(fetchCalls).toBe(0);
    expect(document.body.textContent).toContain('Deactivate "Oracle"?');
    expect(findDialogButton("Deactivate agent")).toBeDefined();
  });

  it("confirms in the activate direction too", () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentStatusToggle agentId="a1" agentName="Oracle" status="draft" />);
    });

    expect(container.querySelector("button")!.textContent).toContain("Activate");

    clickTrigger();

    expect(fetchCalls).toBe(0);
    expect(document.body.textContent).toContain('Activate "Oracle"?');
    expect(findDialogButton("Activate agent")).toBeDefined();
  });
});

describe("AgentStatusToggle error handling", () => {
  it("shows a toast and does NOT refresh when the PATCH fails", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Database unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentStatusToggle agentId="a1" agentName="Oracle" status="active" />);
    });

    clickTrigger();
    await confirmDeactivate();
    await flush();

    expect(toastErrors).toContain("Database unavailable");
    expect(refreshCalls).toBe(0);
  });

  it("refreshes and shows no error toast when the PATCH succeeds", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: { id: "a1", status: "draft" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentStatusToggle agentId="a1" agentName="Oracle" status="active" />);
    });

    clickTrigger();
    await confirmDeactivate();
    await flush();

    expect(refreshCalls).toBe(1);
    expect(toastErrors).toHaveLength(0);
  });
});
