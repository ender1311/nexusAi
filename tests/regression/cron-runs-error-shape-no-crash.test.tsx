import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: CronRuns did `.then((d) => setRuns(d.data))` with no fallback.
// When /api/cron/runs returns an error shape `{ error }` (which parses as JSON,
// so the `.catch` never fires), `d.data` was undefined → setRuns(undefined) →
// the render's `runs.length === 0` threw "Cannot read properties of undefined".
// The fix is `setRuns(d.data ?? [])`, which renders the empty state instead.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CronRuns } = await import("@/components/control-tower/cron-runs");

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

describe("CronRuns error-shape handling", () => {
  it("renders the empty state instead of crashing when the API returns an error shape", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    act(() => {
      root.render(<CronRuns />);
    });
    await flush();

    expect(container.textContent).toContain("No cron runs recorded yet.");
  });

  it("renders rows when the API returns a valid data array", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "run-1",
              cronName: "select-and-send",
              startedAt: new Date().toISOString(),
              finishedAt: null,
              status: "completed",
              sent: 5,
              suppressed: 2,
              errors: 0,
              agentCount: 3,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    act(() => {
      root.render(<CronRuns />);
    });
    await flush();

    expect(container.textContent).toContain("3 agents");
    expect(container.textContent).not.toContain("No cron runs recorded yet.");
  });
});
