// Regression: the condition value editor must render the RIGHT control per field
// kind, not a free-text box for everything. Bug guard — enum/persona/segment fields
// previously rendered a plain <input>, letting users type values that never match
// the stored enum tokens (e.g. "WAU" vs "wau"). See Task 10 code review (commit d222ddb).
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RuleNodeEditor, type EditorContext } from "@/components/segments/rule-node-editor";
import type { Condition } from "@/types/segment";

const noopCtx: EditorContext = {
  personaOptions: [{ value: "p1", label: "Night Owls" }],
  segmentNameOptions: ["VIP donors", "Lapsed WAU"],
  facetMap: {},
  onAddCondition: () => {},
  onAddGroup: () => {},
  onRemove: () => {},
  onChangeCondition: () => {},
  onToggleJoin: () => {},
};

const render = (node: Condition) =>
  renderToStaticMarkup(<RuleNodeEditor node={node} path={[0]} ctx={noopCtx} />);

describe("segment rule editor value controls", () => {
  it("enum field (funnel stage) renders a multi-select, not a text input", () => {
    const html = render({ kind: "condition", fieldId: "funnelStage", operator: "in", value: [] });
    expect(html).toContain("<select multiple=\"\"");
    // Funnel-stage enum labels come from the catalog, not free text.
    expect(html).toContain("<option");
  });

  it("persona field pulls its options from personaOptions prop", () => {
    const html = render({ kind: "condition", fieldId: "persona", operator: "in", value: [] });
    expect(html).toContain("<select multiple=\"\"");
    expect(html).toContain("Night Owls");
  });

  it("segment field renders a single-select of segment names", () => {
    const html = render({ kind: "condition", fieldId: "segment_membership", operator: "in_segment", value: "" });
    expect(html).toContain("Select segment…");
    expect(html).toContain("VIP donors");
    expect(html).toContain("Lapsed WAU");
    expect(html).not.toContain("multiple=\"\"");
  });

  it("string field still renders a free-text input", () => {
    const html = render({ kind: "condition", fieldId: "email", operator: "eq", value: "" });
    expect(html).toContain("<input");
  });

  it("valueless operator renders no value control", () => {
    const html = render({ kind: "condition", fieldId: "has_recurring_gift", operator: "is_true", value: null });
    // Only the field + operator selects remain; no value <input> and no segment/enum picker.
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Select segment…");
  });
});
