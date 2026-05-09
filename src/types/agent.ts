export type FunnelStage =
  | "new"          // First-time users, installed < N days ago
  | "dau4"         // Daily active — opens 4+ days/week
  | "wau"          // Weekly active — opens 1–3 days/week
  | "mau"          // Monthly active — opens at least once/month
  | "lapsed_dau4"  // Previously DAU4, now inactive
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

export const FUNNEL_STAGE_META: Record<FunnelStage, { label: string; description: string }> = {
  new:         { label: "New",          description: "New users — installed recently" },
  dau4:        { label: "DAU4",         description: "Daily active — opens 4+ days/week" },
  wau:         { label: "WAU",          description: "Weekly active — opens 1–3 days/week" },
  mau:         { label: "MAU",          description: "Monthly active — opens at least once/month" },
  lapsed_dau4: { label: "Lapsed DAU4",  description: "Was DAU4 — now gone quiet" },
  lapsed_wau:  { label: "Lapsed WAU",   description: "Was WAU — now gone quiet" },
  lapsed_mau:  { label: "Lapsed MAU",   description: "Was MAU — now gone quiet" },
};

export type AgentStatus = "draft" | "active" | "paused";
export type Algorithm = "thompson" | "epsilon_greedy" | "contextual";

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  status: AgentStatus;
  algorithm: Algorithm;
  epsilon: number;
  funnelStage: FunnelStage;
  targetFilter?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  goals?: Goal[];
  messages?: Message[];
  schedulingRule?: SchedulingRule | null;
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
}

export interface FrequencyCap {
  maxSends: number;
  period: "day" | "week" | "biweek" | "month";
}

export interface QuietHours {
  start: string;
  end: string;
  timezone: string;
}
