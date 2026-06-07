export type Operator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "in" | "nin"
  | "contains"
  | "exists" | "nexists"
  | "is_true" | "is_false"
  | "in_segment" | "not_in_segment";

export type FieldType = "string" | "number" | "boolean" | "date" | "enum" | "segment";

export type ConditionValue = string | number | boolean | string[] | null;

export type Condition = {
  kind: "condition";
  fieldId: string;
  operator: Operator;
  value: ConditionValue;
};

export type Group = {
  kind: "group";
  join: "AND" | "OR";
  children: RuleNode[];
};

export type RuleNode = Condition | Group;
export type SegmentRule = Group;
