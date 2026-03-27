export type AgentStatus = "draft" | "active" | "paused";
export type Algorithm = "thompson" | "epsilon_greedy" | "contextual";

export interface Agent {
  id: string;
  name: string;
  description?: string | null;
  status: AgentStatus;
  algorithm: Algorithm;
  epsilon: number;
  createdAt: string;
  updatedAt: string;
  goals?: Goal[];
  messages?: Message[];
  schedulingRule?: SchedulingRule | null;
  targetPersonaIds?: string[];
  _count?: {
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
  createdAt: string;
}

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
