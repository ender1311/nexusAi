export type PinnedProperty = { label: string; value: string };
export type PinnedInput = {
  attributes: Record<string, unknown>;
  funnelStage: string | null;
  timezone: string | null;
  personaName: string | null;
};

function fmt(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

function deriveName(attrs: Record<string, unknown>): string | null {
  const direct = fmt(attrs.name);
  if (direct) return direct;
  const parts = [attrs.first_name, attrs.last_name].map(fmt).filter((p): p is string => p !== null);
  return parts.length ? parts.join(" ") : null;
}

export function buildPinnedProperties(input: PinnedInput): PinnedProperty[] {
  const a = input.attributes;
  // Each entry: [label, computed value, core?]. Core rows always render (— when null).
  const candidates: Array<[string, string | null, boolean]> = [
    ["Name", deriveName(a), false],
    ["Email", fmt(a.email), false],
    ["Funnel stage", fmt(input.funnelStage), true],
    ["Persona", fmt(input.personaName), true],
    ["Language", fmt(a.language_tag), false],
    ["Country", fmt(a.country_latest), false],
    ["Timezone", fmt(input.timezone), false],
    ["Days since last open", fmt(a.days_since_last_open), false],
    ["Preferred channel (30d)", fmt(a.preferred_channel_overall_30_days), false],
    ["Newsletter push", fmt(a.newsletter_push_enabled), false],
    ["Newsletter email", fmt(a.newsletter_email_enabled), false],
    ["Recurring gift", fmt(a.has_recurring_gift), false],
    ["Lifetime gifts", fmt(a.gift_count_lifetime), false],
  ];
  return candidates
    .filter(([, value, core]) => core || value !== null)
    .map(([label, value]) => ({ label, value: value ?? "—" }));
}
