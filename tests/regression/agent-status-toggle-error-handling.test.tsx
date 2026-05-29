import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: AgentStatusToggle fired the PATCH and immediately called
// router.refresh() without checking res.ok. A failed status update (e.g. 500)
// was silently swallowed — the UI refreshed as if it had succeeded and the user
// got no feedback. The fix checks res.ok, throws on failure, surfaces the error
// via toast.error, and only calls router.refresh() on success.

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

function clickToggle() {
  const button = container.querySelector("button")!;
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AgentStatusToggle error handling", () => {
  it("shows a toast and does NOT refresh when the PATCH fails", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Database unavailable" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<AgentStatusToggle agentId="a1" status="active" />);
    });

    clickToggle();
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
      root.render(<AgentStatusToggle agentId="a1" status="active" />);
    });

    clickToggle();
    await flush();

    expect(refreshCalls).toBe(1);
    expect(toastErrors).toHaveLength(0);
  });
});
