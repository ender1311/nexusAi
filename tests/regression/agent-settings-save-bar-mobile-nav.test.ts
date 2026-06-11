// Regression (2026-06-10): the Settings edit-mode save bar was `fixed
// bottom-0 z-30`, but the mobile bottom nav (sidebar.tsx) is `fixed bottom-0
// z-50 lg:hidden` — on phones the nav fully covered Save/Cancel, so edits
// (e.g. max sends per week) could never be saved on mobile. The save bar must
// sit above the mobile nav below the lg breakpoint and return to bottom-0 on
// desktop where the nav is hidden.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("settings save bar clears the mobile bottom nav", () => {
  const editor = readFileSync(
    join(root, "src/components/agents/agent-settings-editor.tsx"),
    "utf8",
  );
  const sidebar = readFileSync(join(root, "src/components/layout/sidebar.tsx"), "utf8");

  it("save bar is offset by the mobile nav height below lg, bottom-0 at lg+", () => {
    expect(editor).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(editor).toContain("lg:bottom-0");
    // Never reintroduce an unconditional bottom-0 on the save bar.
    expect(editor).not.toMatch(/fixed bottom-0 /);
  });

  it("assumptions about the mobile nav still hold (fixed bottom-0, z-50, hidden at lg+)", () => {
    expect(sidebar).toMatch(/fixed bottom-0[^"]*z-50[^"]*lg:hidden/);
  });

  it("edit form reserves extra bottom padding on mobile so the last card scrolls clear", () => {
    expect(editor).toContain("pb-48 lg:pb-32");
  });
});
