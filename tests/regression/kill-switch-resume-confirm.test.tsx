import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the global kill switch confirmed before ACTIVATING but turned
// OFF (resumed ALL sending across every agent) on a single click. Resuming all
// communications is just as consequential as pausing them, so the off/resume
// direction must also go through a confirmation dialog.

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

const { KillSwitchToggle } = await import("@/components/control-tower/kill-switch-toggle");

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof mock>;

beforeEach(() => {
  fetchMock = mock(async () =>
    new Response(JSON.stringify({ data: {} }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(text));
}

describe("KillSwitchToggle resume confirmation", () => {
  it("opens a confirmation when turning the kill switch OFF instead of resuming immediately", () => {
    act(() => {
      root.render(<KillSwitchToggle initialOn={true} />);
    });

    const resumeBtn = findButton("Resume all");
    expect(resumeBtn).toBeDefined();

    act(() => resumeBtn!.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Turn off kill switch?");
    expect(findButton("Resume all sending")).toBeDefined();
  });

  it("posts global_sending_paused:false only after confirming", async () => {
    act(() => {
      root.render(<KillSwitchToggle initialOn={true} />);
    });

    act(() => findButton("Resume all")!.click());
    await act(async () => {
      findButton("Resume all sending")!.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/settings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ global_sending_paused: "false" });
  });
});
