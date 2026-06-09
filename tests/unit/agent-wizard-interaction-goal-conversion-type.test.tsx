import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentWizard } from "@/components/agents/agent-wizard";

// The wizard renders two nav bars (compact top + full bottom); always click the last one.
function clickNext() {
  const btns = screen.getAllByRole("button", { name: /next/i });
  fireEvent.click(btns[btns.length - 1]!);
}

function clickLaunch() {
  const btns = screen.getAllByRole("button", { name: /launch agent/i });
  fireEvent.click(btns[btns.length - 1]!);
}

function fillStep1Required() {
  fireEvent.change(screen.getByPlaceholderText("e.g. Recommend Bible Plans"), {
    target: { value: "Test Agent" },
  });
  const comboboxes = screen.getAllByRole("combobox");
  fireEvent.click(comboboxes[1]!);
  const options = screen.queryAllByRole("option");
  if (options[0]) fireEvent.click(options[0]);
}

const agentPostCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  agentPostCalls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/segments")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    if (urlStr.includes("/api/agents") && init?.method === "POST") {
      try {
        agentPostCalls.push(JSON.parse(init.body as string));
      } catch {
        agentPostCalls.push({});
      }
    }
    return new Response(JSON.stringify({ id: "agent-1", status: "draft" }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => cleanup());

describe("AgentWizard — interaction-flag goal conversionType", () => {
  it("selecting an interaction-flag preset includes conversionType 'first_interaction' in POST payload", async () => {
    render(<AgentWizard personas={[]} />);
    fillStep1Required();
    clickNext(); // → Step 2 (Goals)

    // "Guided Scripture (first interaction)" is an INTERACTION_GOALS preset
    const interactionBtn = screen.getByRole("button", { name: "Guided Scripture (first interaction)" });
    fireEvent.click(interactionBtn);

    clickNext(); // → Step 3
    clickNext(); // → Step 4
    clickNext(); // → Step 5 Review
    clickLaunch();

    await new Promise((r) => setTimeout(r, 50));

    expect(agentPostCalls.length).toBeGreaterThan(0);
    const payload = agentPostCalls[0] as { goals?: Array<{ eventName: string; conversionType?: string }> };
    const goal = payload.goals?.find((g) => g.eventName === "guided_scripture_interaction_has_ever_flag");
    expect(goal).toBeDefined();
    expect(goal?.conversionType).toBe("first_interaction");
  });

  it("selecting a non-interaction preset does NOT include conversionType in POST payload", async () => {
    render(<AgentWizard personas={[]} />);
    fillStep1Required();
    clickNext(); // → Step 2 (Goals)

    // "Have a session" is a POSITIVE_GOALS preset (not an interaction flag)
    const regularBtn = screen.getByRole("button", { name: "Have a session" });
    fireEvent.click(regularBtn);

    clickNext(); // → Step 3
    clickNext(); // → Step 4
    clickNext(); // → Step 5 Review
    clickLaunch();

    await new Promise((r) => setTimeout(r, 50));

    expect(agentPostCalls.length).toBeGreaterThan(0);
    const payload = agentPostCalls[0] as { goals?: Array<{ eventName: string; conversionType?: string }> };
    const goal = payload.goals?.find((g) => g.eventName === "session_start");
    expect(goal).toBeDefined();
    expect(goal?.conversionType).toBeUndefined();
  });
});
