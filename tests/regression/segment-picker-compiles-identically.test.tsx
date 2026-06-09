// Regression: the value picker is pure input-assistance. A value chosen via the
// combobox must flow through the unchanged parse-rule → compile-sql path and
// produce byte-identical SQL + params as the same value typed by hand.
// Spec: docs/superpowers/specs/2026-06-09-segment-value-pickers-design.md
import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RuleNodeEditor, type EditorContext } from "@/components/segments/rule-node-editor";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import type { Condition, SegmentRule } from "@/types/segment";
import type { FacetMap } from "@/lib/segments/facet-types";

afterEach(() => cleanup());

const facetMap: FacetMap = {
  country_latest: { kind: "values", payload: { top: [{ value: "US", count: 10 }], distinctApprox: 1, total: 10 } },
};

function ctxCapturing(onChange: (next: Condition) => void): EditorContext {
  return {
    personaOptions: [], segmentNameOptions: [], facetMap,
    onAddCondition: () => {}, onAddGroup: () => {}, onRemove: () => {},
    onChangeCondition: (_p, n) => onChange(n), onToggleJoin: () => {},
  };
}

describe("picker value ≡ hand-typed value after compile", () => {
  it("produces identical SQL + params for country = US", () => {
    const holder: { picked: Condition | null } = { picked: null };
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={ctxCapturing((n) => { holder.picked = n; })} />);
    fireEvent.focus(screen.getByRole("combobox", { name: /value/i }));
    fireEvent.click(screen.getByText(/United States/));

    expect(holder.picked).not.toBeNull();
    const pickedRule: SegmentRule = { kind: "group", join: "AND", children: [holder.picked!] };
    const handRule: SegmentRule = {
      kind: "group", join: "AND",
      children: [{ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" }],
    };
    expect(compileSegmentRule(pickedRule)).toEqual(compileSegmentRule(handRule));
  });
});
