export type FunnelStage =
  | "new"          // First-time users, installed < N days ago
  | "dau4"         // Daily active — opens 4+ days/week
  | "wau"          // Weekly active — opens 1–3 days/week
  | "mau"          // Monthly active — opens at least once/month
  | "lapsed_dau4"  // Lapsed DAU4 — normalized from Hightouch "lapsed_dau" alias on ingest
  | "lapsed_wau"   // Previously WAU, now inactive
  | "lapsed_mau";  // Previously MAU, now inactive

export const FUNNEL_STAGES: FunnelStage[] = [
  "new",
  "dau4",
  "wau",
  "mau",
  "lapsed_dau4",
  "lapsed_wau",
  "lapsed_mau",
];

export const FUNNEL_STAGE_META: Record<FunnelStage, { label: string }> = {
  new:         { label: "New" },
  dau4:        { label: "DAU4" },
  wau:         { label: "WAU" },
  mau:         { label: "MAU" },
  lapsed_dau4: { label: "Lapsed DAU4" },
  lapsed_wau:  { label: "Lapsed WAU" },
  lapsed_mau:  { label: "Lapsed MAU" },
};

export type SegmentTargeting = {
  includes: string[];  // user must be in ALL of these segments (AND logic)
  excludes: string[];  // user must NOT be in ANY of these segments (OR exclusion)
};

// Human-readable label for who an agent targets: a named segment if one is set,
// otherwise the funnel-stage label. Falls back to the raw funnelStage value when
// it isn't a known FunnelStage (e.g. legacy/Hightouch values), and to "—" when
// there's nothing to show, so the badge never renders empty.
export function agentTargetingLabel(
  agent: { targetSegmentName?: string | null; funnelStage?: string | null },
): string {
  if (agent.targetSegmentName) return `Segment: ${agent.targetSegmentName}`;
  const stage = agent.funnelStage;
  if (!stage) return "—";
  return FUNNEL_STAGE_META[stage as FunnelStage]?.label ?? stage;
}

export type AgentStatus = "draft" | "active" | "paused";
export type Algorithm = "thompson" | "epsilon_greedy" | "linucb";

export const AGENT_PALETTE: string[] = [
  // Reds
  "#ef4444", "#f87171", "#dc2626", "#b91c1c",
  // Orange / Amber
  "#f97316", "#fb923c", "#f59e0b", "#fbbf24",
  // Yellow / Lime
  "#eab308", "#facc15", "#84cc16", "#a3e635",
  // Green
  "#22c55e", "#4ade80", "#16a34a", "#15803d",
  // Emerald / Teal
  "#10b981", "#34d399", "#14b8a6", "#2dd4bf",
  // Cyan / Sky
  "#06b6d4", "#22d3ee", "#0ea5e9", "#38bdf8",
  // Blue
  "#3b82f6", "#60a5fa", "#2563eb", "#1d4ed8",
  // Indigo / Violet
  "#6366f1", "#818cf8", "#8b5cf6", "#a78bfa",
  // Purple / Fuchsia
  "#a855f7", "#c084fc", "#d946ef", "#e879f9",
  // Pink / Rose
  "#ec4899", "#f472b6", "#f43f5e", "#fb7185",
  // Slate / Gray
  "#64748b", "#94a3b8", "#6b7280", "#9ca3af",
  // Stone / Zinc
  "#78716c", "#a8a29e", "#71717a", "#a1a1aa",
];

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  status: AgentStatus;
  sendingPaused: boolean;
  algorithm: Algorithm;
  epsilon: number;
  funnelStage: FunnelStage;
  color: string;
  targetFilter?: Record<string, unknown> | null;
  uniqueUsersCap?: number | null;
  dailySendCap?: number | null;
  targetSegmentName?: string | null;
  segmentTargeting?: SegmentTargeting | null;
  uniqueUsers?: number;
  assigned?: number;
  pushSends?: number;
  pushOpens?: number;
  pushOpenRate?: number | null;
  sortOrder?: number;
  createdAt: string;
  updatedAt: string;
  goals?: Goal[];
  messages?: Message[];
  schedulingRule?: SchedulingRule | null;
  enrollmentMode?: "fixed" | "continuous" | null;
  targetPersonaIds?: string[];
  _count?: {
    goals?: number;
    messages?: number;
    variants?: number;
    decisions: number;
  };
}

export interface Goal {
  id: string;
  agentId: string;
  eventName: string;
  tier: GoalTier;
  valueWeight: number;
  weightMode: "fixed" | "property";
  weightProperty?: string | null;
  weightDefault: number;
  description?: string | null;
  conversionType?: "first_interaction" | "any_interaction" | null;
}

export type GoalTier = "best" | "very_good" | "good" | "bad" | "very_bad" | "worst";

export interface Message {
  id: string;
  agentId: string;
  name: string;
  channel: Channel;
  brazeCampaignId?: string | null;
  testedVariables?: TestedVariable[];
  createdAt: string;
  variants?: MessageVariant[];
}

export type Channel = "push" | "email" | "sms";

export type TestedVariable =
  | "title"
  | "body"
  | "deeplink"
  | "iconImageUrl"
  | "sendHour"
  | "sendDayOfWeek"
  | "frequencyCap";

export interface PushDeeplink {
  label: string;
  value: string;
  category: string;
}

export interface MessageVariant {
  id: string;
  messageId: string;
  name: string;
  subject?: string | null;
  body: string;
  cta?: string | null;
  status: "active" | "paused";
  brazeVariantId?: string | null;
  title?: string | null;
  iconImageUrl?: string | null;
  deeplink?: string | null;
  preferredHour?: number | null;
  preferredDayOfWeek?: number | null;
  frequencyCapOverride?: string | null;
  sourceTemplateId?: string | null;
  category?: string | null;
  createdAt: string;
}

/** MessageVariant as returned by GET /api/variants (includes the message join shape). */
export type VariantWithMessage = MessageVariant & {
  message: { channel: string; name: string };
};

export interface SchedulingRule {
  id: string;
  agentId: string;
  frequencyCap: FrequencyCap;
  quietHours: QuietHours;
  blackoutDates: string[];
  smartSuppress: boolean;
  suppressThresh: number;
  prioritizeLastSeen: boolean;
}

export interface FrequencyCap {
  maxSends: number;
  period: "day" | "week" | "biweek" | "month";
}

export type QuietHoursMode = "none" | "suppress" | "schedule";

export interface QuietHours {
  mode: QuietHoursMode;
  /** suppress mode: window start in HH:mm */
  start?: string;
  /** suppress mode: window end in HH:mm */
  end?: string;
  /** suppress mode: IANA tz fallback for users without a stored timezone */
  timezone?: string;
  /** schedule mode: 0–23 hour to deliver in each user's local timezone via Braze in_local_time */
  deliverAtHour?: number;
  /** Days of the week on which sends are suppressed (0=Sunday, 6=Saturday). Empty array = no day suppression. */
  quietDays?: number[];
}
