import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { RuleNodeEditor, type EditorContext } from "@/components/segments/rule-node-editor";
import type { Condition } from "@/types/segment";
import type { FacetMap } from "@/lib/segments/facet-types";

afterEach(() => cleanup());

function makeCtx(facetMap: FacetMap, onChange: (path: number[], next: Condition) => void): EditorContext {
  return {
    personaOptions: [],
    segmentNameOptions: [],
    facetMap,
    onAddCondition: () => {},
    onAddGroup: () => {},
    onRemove: () => {},
    onChangeCondition: onChange,
    onToggleJoin: () => {},
  };
}

const countryFacet: FacetMap = {
  country_latest: { kind: "values", payload: { top: [{ value: "US", count: 174018 }, { value: "GB", count: 50000 }], distinctApprox: 2, total: 224018 } },
};

describe("ValueEditor facet dispatch", () => {
  it("renders a searchable combobox for a values-facet field and commits a picked value", () => {
    const captured: { value: Condition | null } = { value: null };
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(countryFacet, (_p, n) => { captured.value = n; })} />);

    const input = screen.getByRole("combobox", { name: /value/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "united" } });
    fireEvent.click(screen.getByText(/United States/));
    expect(captured.value).toEqual({ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" });
  });

  it("commits a free-text value not present in the suggestions", () => {
    const captured: { value: Condition | null } = { value: null };
    const node: Condition = { kind: "condition", fieldId: "country_latest", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(countryFacet, (_p, n) => { captured.value = n; })} />);

    const input = screen.getByRole("combobox", { name: /value/i });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "XK" } });
    fireEvent.click(screen.getByText(/Use "XK"/));
    expect(captured.value).toEqual({ kind: "condition", fieldId: "country_latest", operator: "eq", value: "XK" });
  });

  it("renders a range hint for a numeric facet field", () => {
    const facetMap: FacetMap = { days_since_last_open: { kind: "range", payload: { min: 0, max: 365, p50: 12, p90: 200 } } };
    const node: Condition = { kind: "condition", fieldId: "days_since_last_open", operator: "gt", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx(facetMap, () => {})} />);
    expect(screen.getByText("In data: 0–365 · median 12")).toBeInTheDocument();
  });

  it("renders a plain text input for email (no facet)", () => {
    const node: Condition = { kind: "condition", fieldId: "email", operator: "eq", value: null };
    render(<RuleNodeEditor node={node} path={[]} ctx={makeCtx({}, () => {})} />);
    expect(screen.queryByRole("combobox", { name: /value/i })).toBeNull();
    expect(screen.queryByText(/In data:/)).toBeNull();
  });
});
