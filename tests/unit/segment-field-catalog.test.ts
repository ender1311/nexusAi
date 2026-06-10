import { describe, expect, it } from "bun:test";
import { FIELD_CATALOG, getField, isOperatorLegal } from "@/lib/segments/field-catalog";
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";

describe("field catalog", () => {
  it("every entry has a non-empty operators list", () => {
    for (const f of FIELD_CATALOG) expect(f.operators.length).toBeGreaterThan(0);
  });

  it("compile strategy is consistent with field type/category", () => {
    for (const f of FIELD_CATALOG) {
      if (f.compile.strategy === "segment") expect(f.type).toBe("segment");
      if (f.compile.strategy === "channelStat") expect(f.category).toBe("engagement");
      if (f.type === "segment") expect(f.compile.strategy).toBe("segment");
    }
  });

  it("ids are unique", () => {
    const ids = FIELD_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getField returns a def or undefined", () => {
    expect(getField("funnelStage")?.id).toBe("funnelStage");
    expect(getField("nope")).toBeUndefined();
  });

  it("isOperatorLegal reflects the entry's operators", () => {
    const f = getField("funnelStage")!;
    expect(isOperatorLegal(f, "in")).toBe(true);
    expect(isOperatorLegal(f, "contains")).toBe(false);
  });

  it("funnelStage enum values come from the funnel-stage metadata", () => {
    const f = getField("funnelStage")!;
    expect(f.enumValues?.map((e) => e.value)).toContain("wau");
  });
});

describe("interaction-flag fields", () => {
  it("every canonical interaction flag is a boolean attribute field with absent-as-false compile", () => {
    for (const flag of INTERACTION_FLAGS) {
      const f = getField(flag);
      expect(f).toBeDefined();
      expect(f!.label).toBe(INTERACTION_FLAG_LABELS[flag]);
      expect(f!.category).toBe("attribute");
      expect(f!.type).toBe("boolean");
      expect(f!.operators).toEqual(["is_true", "is_false"]);
      expect(f!.compile).toEqual({ strategy: "attr", key: flag, cast: "boolean", absentFalse: true });
    }
  });
});
