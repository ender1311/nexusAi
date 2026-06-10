// Regression (2026-06-09 unified agent settings): editing used to be split
// across an edit sheet, a scheduling page, and a fallback-send-time editor.
// The Settings tab (AgentSettingsEditor) is now the single edit surface.
// This test pins the consolidation so the dual surfaces stay dead.
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("single edit surface for agent settings", () => {
  it("the old edit components do not exist on disk", () => {
    expect(existsSync(join(root, "src/components/agents/agent-edit-sheet.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/components/scheduling/scheduling-editor.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/components/agents/fallback-send-time-editor.tsx"))).toBe(false);
  });

  it("the scheduling page is a redirect to the Settings tab and renders no form", () => {
    const src = readFileSync(join(root, "src/app/agents/[id]/scheduling/page.tsx"), "utf8");
    expect(src).toContain("redirect(`/agents/${id}?tab=settings`)");
    expect(src).not.toContain("SchedulingEditor");
    expect(src).not.toContain("<form");
  });

  it("the detail page has exactly one editor entry point", () => {
    const src = readFileSync(join(root, "src/app/agents/[id]/page.tsx"), "utf8");
    expect(src).toContain("AgentSettingsEditor");
    expect(src).not.toContain("AgentEditSheet");
    // No links into the dead scheduling page
    expect(src).not.toMatch(/href=\{?`?[^`"}]*\/scheduling`?\}?/);
  });
});
