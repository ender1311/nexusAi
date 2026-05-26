export type TestedVariable =
  | "title"
  | "body"
  | "deeplink"
  | "iconImageUrl"
  | "sendHour"
  | "sendDayOfWeek"
  | "frequencyCap";

export interface VariantInput {
  name?: string | null;
  subject?: string | null;
  body?: string;
  cta?: string | null;
  title?: string | null;
  iconImageUrl?: string | null;
  deeplink?: string | null;
  preferredHour?: number | null;
  preferredDayOfWeek?: number | null;
  frequencyCapOverride?: unknown;
  sourceTemplateId?: string | null;
}

const PUSH_TESTED_FIELDS: Array<{ field: keyof VariantInput; variable: TestedVariable }> = [
  { field: "title", variable: "title" },
  { field: "body", variable: "body" },
  { field: "deeplink", variable: "deeplink" },
  { field: "iconImageUrl", variable: "iconImageUrl" },
  { field: "preferredHour", variable: "sendHour" },
  { field: "preferredDayOfWeek", variable: "sendDayOfWeek" },
  { field: "frequencyCapOverride", variable: "frequencyCap" },
];

export function detectTestedVariables(variants: VariantInput[]): TestedVariable[] {
  if (variants.length < 2) return [];
  const tested: TestedVariable[] = [];
  for (const { field, variable } of PUSH_TESTED_FIELDS) {
    const values = variants.map((v) => v[field] ?? null);
    const unique = new Set(values.map((val) => JSON.stringify(val)));
    if (unique.size > 1) tested.push(variable);
  }
  return tested;
}
