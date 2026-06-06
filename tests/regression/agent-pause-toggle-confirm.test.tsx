import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the per-agent Pause/Resume toggle fired the PATCH immediately on
// click, so a stray tap silently stopped (or resumed) an agent's communications
// with no confirmation. Both directions must now go through an AlertDialog so
// the user double-checks before sending state changes.

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

const { AgentPauseToggle } = await import("@/components/agents/agent-pause-toggle");

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

describe("AgentPauseToggle confirmation", () => {
  it("opens a confirmation dialog on Pause instead of PATCHing immediately", () => {
    act(() => {
      root.render(<AgentPauseToggle agentId="a1" agentName="Trinity" sendingPaused={false} />);
    });

    const pauseBtn = findButton("Pause");
    expect(pauseBtn).toBeDefined();

    act(() => pauseBtn!.click());

    // The PATCH must NOT have fired yet — only the confirmation should be open.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Pause \"Trinity\"?");
    expect(findButton("Pause sending")).toBeDefined();
  });

  it("fires the PATCH (sendingPaused:true) only after the user confirms", async () => {
    act(() => {
      root.render(<AgentPauseToggle agentId="a1" agentName="Trinity" sendingPaused={false} />);
    });

    act(() => findButton("Pause")!.click());
    await act(async () => {
      findButton("Pause sending")!.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agents/a1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ sendingPaused: true });
  });

  it("confirms in the resume direction too", () => {
    act(() => {
      root.render(<AgentPauseToggle agentId="a1" agentName="Trinity" sendingPaused={true} />);
    });

    const resumeBtn = findButton("Resume");
    expect(resumeBtn).toBeDefined();

    act(() => resumeBtn!.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Resume \"Trinity\"?");
    expect(findButton("Resume sending")).toBeDefined();
  });
});
