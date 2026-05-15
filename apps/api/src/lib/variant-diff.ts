export type TestedVariable =
  | "title"
  | "body"
  | "deeplink"
  | "iconImageUrl"
  | "sendHour"
  | "sendDayOfWeek"
  | "frequencyCap";

export interface MessageVariant {
  id?: string;
  messageId?: string;
  name: string;
  subject?: string | null;
  body: string;
  cta?: string | null;
  status?: "active" | "paused";
  brazeVariantId?: string | null;
  title?: string | null;
  iconImageUrl?: string | null;
  deeplink?: string | null;
  preferredHour?: number | null;
  preferredDayOfWeek?: number | null;
  frequencyCapOverride?: unknown;
  sourceTemplateId?: string | null;
  category?: string | null;
  createdAt?: string;
}

const PUSH_TESTED_FIELDS: Array<{ field: keyof MessageVariant; variable: TestedVariable }> = [
  { field: "title", variable: "title" },
  { field: "body", variable: "body" },
  { field: "deeplink", variable: "deeplink" },
  { field: "iconImageUrl", variable: "iconImageUrl" },
  { field: "preferredHour", variable: "sendHour" },
  { field: "preferredDayOfWeek", variable: "sendDayOfWeek" },
  { field: "frequencyCapOverride", variable: "frequencyCap" },
];

/**
 * Compares all variants and returns which fields differ across them.
 */
export function detectTestedVariables(variants: MessageVariant[]): TestedVariable[] {
  if (variants.length < 2) return [];

  const tested: TestedVariable[] = [];
  for (const { field, variable } of PUSH_TESTED_FIELDS) {
    const values = variants.map((v) => v[field] ?? null);
    const unique = new Set(values.map((val) => JSON.stringify(val)));
    if (unique.size > 1) {
      tested.push(variable);
    }
  }
  return tested;
}
