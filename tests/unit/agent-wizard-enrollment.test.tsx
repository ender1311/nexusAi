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

// Fill the required Step 1 fields so the "Next" button is enabled.
// The funnelStage combobox is the second combobox on step 1 (index 1; index 0 is Algorithm).
function fillStep1Required() {
  fireEvent.change(screen.getByPlaceholderText("e.g. Recommend Bible Plans"), {
    target: { value: "Test Agent" },
  });
  const comboboxes = screen.getAllByRole("combobox");
  // Open the funnelStage Select (index 1)
  fireEvent.click(comboboxes[1]!);
  // Pick the first option ("New")
  const options = screen.queryAllByRole("option");
  if (options[0]) fireEvent.click(options[0]);
}

// Only capture POST /api/agents calls
const agentPostCalls: Record<string, unknown>[] = [];

beforeEach(() => {
  agentPostCalls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = String(url);
    // Segments endpoint — return empty list so SegmentCheckList renders its empty state
    if (urlStr.includes("/api/segments")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    // Capture POST /api/agents
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

describe("AgentWizard — Enrollment Mode", () => {
  it("renders the Enrollment card title in Step 1", () => {
    // 2026-06-10 restyle: the "Enrollment Mode" section label became an
    // "Enrollment" Card title (the full name lives in the InfoTip popup).
    render(<AgentWizard personas={[]} />);
    expect(screen.getByText("Enrollment")).toBeInTheDocument();
  });

  it("renders two enrollment option buttons — Fixed Cohort and Continuous", () => {
    render(<AgentWizard personas={[]} />);
    expect(screen.getByRole("button", { name: "Fixed Cohort" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuous (trigger-based)" })).toBeInTheDocument();
  });

  it("defaults to Fixed Cohort active state", () => {
    render(<AgentWizard personas={[]} />);
    const fixedBtn = screen.getByRole("button", { name: "Fixed Cohort" });
    // The active button carries bg-primary in its className
    expect(fixedBtn.className).toContain("bg-primary");
    const contBtn = screen.getByRole("button", { name: "Continuous (trigger-based)" });
    expect(contBtn.className).not.toContain("bg-primary");
  });

  it("switches active state when Continuous is clicked", () => {
    render(<AgentWizard personas={[]} />);
    const contBtn = screen.getByRole("button", { name: "Continuous (trigger-based)" });
    fireEvent.click(contBtn);
    expect(contBtn.className).toContain("bg-primary");
    expect(screen.getByRole("button", { name: "Fixed Cohort" }).className).not.toContain("bg-primary");
  });

  it("does NOT show soft-ceiling note in Fixed mode on Step 4", () => {
    render(<AgentWizard personas={[]} />);
    fillStep1Required();
    clickNext(); // → Step 2
    clickNext(); // → Step 3
    clickNext(); // → Step 4
    expect(screen.queryByText(/soft ceiling/i)).toBeNull();
  });

  it("shows soft-ceiling note on Max Unique Users when Continuous is selected (Step 4)", () => {
    render(<AgentWizard personas={[]} />);
    // Choose continuous in Step 1
    fireEvent.click(screen.getByRole("button", { name: "Continuous (trigger-based)" }));
    fillStep1Required();
    // Navigate to Step 4
    clickNext(); // → Step 2
    clickNext(); // → Step 3
    clickNext(); // → Step 4
    // Multiple elements may contain "soft ceiling" (h3 span + p text); any match suffices
    expect(screen.getAllByText(/soft ceiling/i).length).toBeGreaterThan(0);
  });

  it("includes enrollmentMode 'fixed' in submit payload by default", async () => {
    render(<AgentWizard personas={[]} />);
    fillStep1Required();
    clickNext(); // → Step 2
    clickNext(); // → Step 3
    clickNext(); // → Step 4
    clickNext(); // → Step 5 Review
    clickLaunch();

    await new Promise((r) => setTimeout(r, 50));

    expect(agentPostCalls.length).toBeGreaterThan(0);
    expect(agentPostCalls[0]!.enrollmentMode).toBe("fixed");
  });

  it("includes enrollmentMode 'continuous' when Continuous is chosen before submit", async () => {
    render(<AgentWizard personas={[]} />);
    // Switch to continuous before advancing
    fireEvent.click(screen.getByRole("button", { name: "Continuous (trigger-based)" }));
    fillStep1Required();
    clickNext();
    clickNext();
    clickNext();
    clickNext();
    clickLaunch();

    await new Promise((r) => setTimeout(r, 50));

    expect(agentPostCalls.length).toBeGreaterThan(0);
    expect(agentPostCalls[0]!.enrollmentMode).toBe("continuous");
  });
});
