import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Regression: SegmentCheckList was duplicated verbatim (56 lines each) in
// agent-wizard.tsx and agent-settings-editor.tsx. The wizard restyle
// (2026-06-10) extracted a single shared component. This pins the
// single-source rule so a future edit can't silently re-inline a copy.

const componentsDir = join(import.meta.dir, "../../src/components/agents");

describe("SegmentCheckList single source", () => {
  it("is defined exactly once, in the shared file", () => {
    const sharedPath = join(componentsDir, "segment-check-list.tsx");
    expect(existsSync(sharedPath)).toBe(true);
    const shared = readFileSync(sharedPath, "utf8");
    expect(shared).toContain("export function SegmentCheckList");
  });

  it("wizard and settings editor import it instead of re-declaring it", () => {
    for (const file of ["agent-wizard.tsx", "agent-settings-editor.tsx"]) {
      const src = readFileSync(join(componentsDir, file), "utf8");
      expect(src).not.toMatch(/(?:function|const|let|var)\s+SegmentCheckList\b/);
      expect(src).toMatch(/from "(\.\/|@\/components\/agents\/)segment-check-list"/);
    }
  });
});
