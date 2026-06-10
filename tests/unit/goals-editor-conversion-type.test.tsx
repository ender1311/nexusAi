import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GoalsEditor } from "@/components/goals/goals-editor";
import type { Goal } from "@/types/agent";

const putCalls: unknown[] = [];

beforeEach(() => {
  putCalls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/api/agents") && init?.method === "PUT") {
      try {
        putCalls.push(JSON.parse(init.body as string));
      } catch {
        putCalls.push({});
      }
    }
    // Return updated goals so the editor can call setGoals(updated)
    return new Response(JSON.stringify([]), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => cleanup());

const INTERACTION_GOAL: Goal = {
  id: "g1",
  agentId: "a1",
  eventName: "plan_subscribed_has_ever_flag",
  tier: "very_good",
  valueWeight: 5,
  weightMode: "fixed",
  weightProperty: null,
  weightDefault: 1.0,
  description: "Plan Subscription",
};

const REGULAR_GOAL: Goal = {
  id: "g2",
  agentId: "a1",
  eventName: "session_start",
  tier: "best",
  valueWeight: 3,
  weightMode: "fixed",
  weightProperty: null,
  weightDefault: 1.0,
  description: "User starts a session",
};

describe("GoalsEditor — conversion type toggle", () => {
  it("shows Conversion type toggle for an interaction-flag goal", () => {
    render(<GoalsEditor agentId="a1" initialGoals={[INTERACTION_GOAL]} />);
    expect(screen.getByText("Conversion type")).toBeInTheDocument();
  });

  it("does NOT show Conversion type toggle for a regular goal", () => {
    render(<GoalsEditor agentId="a1" initialGoals={[REGULAR_GOAL]} />);
    expect(screen.queryByText("Conversion type")).toBeNull();
  });

  it("defaults to 'First interaction' for an interaction-flag goal", () => {
    render(<GoalsEditor agentId="a1" initialGoals={[INTERACTION_GOAL]} />);
    const firstBtn = screen.getByRole("button", { name: "First interaction" });
    expect(firstBtn.className).toContain("bg-primary");
    const anyBtn = screen.getByRole("button", { name: "Any interaction" });
    expect(anyBtn.className).not.toContain("bg-primary");
  });

  it("switches to 'Any interaction' when clicked", () => {
    render(<GoalsEditor agentId="a1" initialGoals={[INTERACTION_GOAL]} />);
    const anyBtn = screen.getByRole("button", { name: "Any interaction" });
    fireEvent.click(anyBtn);
    expect(anyBtn.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "First interaction" }).className).not.toContain("bg-primary");
  });

  it("includes conversionType 'first_interaction' in PUT payload by default", async () => {
    render(<GoalsEditor agentId="a1" initialGoals={[INTERACTION_GOAL]} />);
    const saveBtn = screen.getByRole("button", { name: /save goals/i });
    fireEvent.click(saveBtn);

    await new Promise((r) => setTimeout(r, 50));

    expect(putCalls.length).toBe(1);
    const body = putCalls[0] as Array<{ eventName: string; conversionType?: string }>;
    const goal = body.find((g) => g.eventName === "plan_subscribed_has_ever_flag");
    expect(goal?.conversionType).toBe("first_interaction");
  });

  it("includes conversionType 'any_interaction' when switched", async () => {
    render(<GoalsEditor agentId="a1" initialGoals={[INTERACTION_GOAL]} />);
    fireEvent.click(screen.getByRole("button", { name: "Any interaction" }));
    fireEvent.click(screen.getByRole("button", { name: /save goals/i }));

    await new Promise((r) => setTimeout(r, 50));

    expect(putCalls.length).toBe(1);
    const body = putCalls[0] as Array<{ eventName: string; conversionType?: string }>;
    const goal = body.find((g) => g.eventName === "plan_subscribed_has_ever_flag");
    expect(goal?.conversionType).toBe("any_interaction");
  });

  it("does NOT include conversionType in PUT payload for regular goals", async () => {
    render(<GoalsEditor agentId="a1" initialGoals={[REGULAR_GOAL]} />);
    fireEvent.click(screen.getByRole("button", { name: /save goals/i }));

    await new Promise((r) => setTimeout(r, 50));

    expect(putCalls.length).toBe(1);
    const body = putCalls[0] as Array<{ eventName: string; conversionType?: string }>;
    const goal = body.find((g) => g.eventName === "session_start");
    expect(goal?.conversionType).toBeUndefined();
  });
});
