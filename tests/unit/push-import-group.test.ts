import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { groupImportFiles } from "@/lib/push-import/group";
import type { ImportFile } from "@/lib/push-import/types";

function f(name: string): ImportFile {
  return { relativePath: name, contents: readFileSync(new URL(`../fixtures/push-import/${name}`, import.meta.url), "utf8") };
}

describe("groupImportFiles", () => {
  it("groups files of one stem across languages", () => {
    const { groups, skipped } = groupImportFiles([
      f("2026-01-daily-remind-PUSH-1-en.json"),
      f("2026-01-daily-remind-PUSH-1-es.json"),
      f("2026-01-daily-remind-PUSH-1-zh_TW.json"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].stem).toBe("2026-01-daily-remind-PUSH-1");
    expect([...groups[0].byLang.keys()].sort()).toEqual(["en", "es", "zh_TW"]);
    expect(groups[0].byLang.get("es")?.body).toContain("tómate un momento");
    expect(skipped).toHaveLength(0);
  });

  it("skips non-translation files and unparseable contents", () => {
    const { groups, skipped } = groupImportFiles([
      { relativePath: "combined/liquid_title.html", contents: "<x>" },
      { relativePath: "schedule.md", contents: "# notes" },
      { relativePath: "foo-bar-es.json", contents: "not json" },
    ]);
    expect(groups).toHaveLength(0);
    expect(skipped.map((s) => s.relativePath).sort()).toEqual([
      "combined/liquid_title.html", "foo-bar-es.json", "schedule.md",
    ]);
  });

  it("last file wins on duplicate (stem, lang)", () => {
    const { groups } = groupImportFiles([
      { relativePath: "x-es.json", contents: JSON.stringify({ push_message_non_personal: "first" }) },
      { relativePath: "x-es.json", contents: JSON.stringify({ push_message_non_personal: "second" }) },
    ]);
    expect(groups[0].byLang.get("es")?.body).toBe("second");
  });
});
