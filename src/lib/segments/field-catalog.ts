import type { Operator, FieldType } from "@/types/segment";
import { FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";

export type FieldCompile =
  | { strategy: "scalar"; column: string }
  | { strategy: "attr"; key: string; cast: "text" | "numeric" | "boolean"; absentFalse?: boolean }
  | { strategy: "channelStat"; channel: string; metric: string }
  | { strategy: "segment" };

export type FieldCategory = "scalar" | "attribute" | "segment" | "engagement";

export type FieldFacet = { kind: "values" | "range" };

export type FieldDef = {
  id: string;
  label: string;
  category: FieldCategory;
  type: FieldType;
  operators: Operator[];
  enumValues?: { value: string; label: string }[];
  facet?: FieldFacet;
  compile: FieldCompile;
};

const NUM_OPS: Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "exists", "nexists"];
const STR_OPS: Operator[] = ["eq", "neq", "in", "nin", "contains", "exists", "nexists"];
const BOOL_OPS: Operator[] = ["is_true", "is_false", "exists", "nexists"];
const ENUM_OPS: Operator[] = ["in", "nin", "exists", "nexists"];
const SEG_OPS: Operator[] = ["in_segment", "not_in_segment"];

const FUNNEL_ENUM = FUNNEL_STAGES.map((s) => ({ value: s, label: FUNNEL_STAGE_META[s].label }));

// Hightouch syncs these with `| default: false`, so an absent attribute means
// false — the compile must COALESCE, otherwise `is_false` would silently drop
// users who have never been synced with the flag at all.
const INTERACTION_FLAG_FIELDS: FieldDef[] = INTERACTION_FLAGS.map((flag) => ({
  id: flag,
  label: INTERACTION_FLAG_LABELS[flag],
  category: "attribute",
  type: "boolean",
  operators: BOOL_OPS,
  compile: { strategy: "attr", key: flag, cast: "boolean", absentFalse: true },
}));

export const FIELD_CATALOG: FieldDef[] = [
  // scalar
  { id: "funnelStage", label: "Funnel stage", category: "scalar", type: "enum", operators: ENUM_OPS, enumValues: FUNNEL_ENUM, compile: { strategy: "scalar", column: "funnelStage" } },
  { id: "persona", label: "Persona", category: "scalar", type: "enum", operators: ENUM_OPS, compile: { strategy: "scalar", column: "personaId" } },
  { id: "timezone", label: "Timezone", category: "scalar", type: "string", operators: STR_OPS, facet: { kind: "values" }, compile: { strategy: "scalar", column: "timezone" } },
  { id: "createdAt", label: "Created at", category: "scalar", type: "date", operators: NUM_OPS, facet: { kind: "range" }, compile: { strategy: "scalar", column: "createdAt" } },
  // attribute
  { id: "email", label: "Email", category: "attribute", type: "string", operators: STR_OPS, compile: { strategy: "attr", key: "email", cast: "text" } },
  { id: "country_latest", label: "Country", category: "attribute", type: "string", operators: STR_OPS, facet: { kind: "values" }, compile: { strategy: "attr", key: "country_latest", cast: "text" } },
  { id: "language_tag", label: "Language", category: "attribute", type: "string", operators: STR_OPS, facet: { kind: "values" }, compile: { strategy: "attr", key: "language_tag", cast: "text" } },
  { id: "days_since_last_open", label: "Days since last open", category: "attribute", type: "number", operators: NUM_OPS, facet: { kind: "range" }, compile: { strategy: "attr", key: "days_since_last_open", cast: "numeric" } },
  { id: "has_recurring_gift", label: "Has recurring gift", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "has_recurring_gift", cast: "boolean" } },
  { id: "gift_count_lifetime", label: "Lifetime gift count", category: "attribute", type: "number", operators: NUM_OPS, facet: { kind: "range" }, compile: { strategy: "attr", key: "gift_count_lifetime", cast: "numeric" } },
  { id: "newsletter_push_enabled", label: "Push opt-in", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "newsletter_push_enabled", cast: "boolean" } },
  { id: "newsletter_email_enabled", label: "Email opt-in", category: "attribute", type: "boolean", operators: BOOL_OPS, compile: { strategy: "attr", key: "newsletter_email_enabled", cast: "boolean" } },
  { id: "preferred_channel_overall_30_days", label: "Preferred channel (30d)", category: "attribute", type: "string", operators: STR_OPS, facet: { kind: "values" }, compile: { strategy: "attr", key: "preferred_channel_overall_30_days", cast: "text" } },
  ...INTERACTION_FLAG_FIELDS,
  // engagement
  { id: "push_sent", label: "Push sent (count)", category: "engagement", type: "number", operators: NUM_OPS, facet: { kind: "range" }, compile: { strategy: "channelStat", channel: "push", metric: "sent" } },
  { id: "push_converted", label: "Push converted (count)", category: "engagement", type: "number", operators: NUM_OPS, facet: { kind: "range" }, compile: { strategy: "channelStat", channel: "push", metric: "converted" } },
  // segment
  { id: "segment_membership", label: "Segment membership", category: "segment", type: "segment", operators: SEG_OPS, compile: { strategy: "segment" } },
];

const BY_ID = new Map(FIELD_CATALOG.map((f) => [f.id, f]));

export function getField(id: string): FieldDef | undefined {
  return BY_ID.get(id);
}

export function isOperatorLegal(field: FieldDef, op: Operator): boolean {
  return field.operators.includes(op);
}
