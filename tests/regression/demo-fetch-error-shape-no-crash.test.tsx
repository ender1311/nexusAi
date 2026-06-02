import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the demo RewardIntelligencePanel did
// `.then((r) => r.json()).then((json) => dispatch({ type: "fetch_done", payload: json }))`
// with no res.ok check. When /api/demo/arm-stats returns an error shape `{ error }`
// (which parses as JSON, so the `.catch` never fired), that error object was stored
// as `data`. The Beta Curves tab then read `data.armStats.length` → "Cannot read
// properties of undefined". The fix checks res.ok and dispatches fetch_error on
// failure, leaving `data` null so the empty/prior state renders.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Panel reads the agent id from `searchParams.get("agent")`; without it the fetch
// never fires. Provide one so the arm-stats fetch path is exercised.
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("agent=a1"),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} }),
}));

const { RewardIntelligencePanel } = await import("@/components/demo/RewardIntelligencePanel");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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

describe("RewardIntelligencePanel error-shape handling", () => {
  it("renders the prior/empty state on the Beta Curves tab instead of crashing when arm-stats errors", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Failed to fetch arm stats" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<RewardIntelligencePanel />);
    });
    await flush();

    // Switch to the "Beta Curves" tab — that's where data.armStats is read.
    const tab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      b.textContent?.includes("Beta Curves"),
    )!;
    act(() => {
      tab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(container.textContent).toContain("No arm data yet");
  });
});
