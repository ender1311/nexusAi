export type TimelineEvent = {
  id: string;
  decisionId: string;
  type: "sent" | "open" | "conversion";
  time: string;
  channel: string;
  agentName: string | null;
  variantName: string | null;
  variantTitle: string | null;
  conversionEvent: string | null;
  reward: number | null;
};

export type DecisionForTimeline = {
  id: string;
  sentAt: Date | string;
  channel: string;
  pushOpenAt: Date | string | null;
  conversionAt: Date | string | null;
  conversionEvent: string | null;
  reward: number | null;
  variant: {
    name: string;
    title: string | null;
    message: { agent: { name: string } | null };
  } | null;
};

function iso(t: Date | string): string {
  return typeof t === "string" ? new Date(t).toISOString() : t.toISOString();
}

export function buildMessagingTimeline(decisions: DecisionForTimeline[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const d of decisions) {
    const base = {
      decisionId: d.id,
      channel: d.channel,
      agentName: d.variant?.message.agent?.name ?? null,
      variantName: d.variant?.name ?? null,
      variantTitle: d.variant?.title ?? null,
    };
    events.push({ ...base, id: `${d.id}:sent`, type: "sent", time: iso(d.sentAt), conversionEvent: null, reward: null });
    if (d.pushOpenAt) {
      events.push({ ...base, id: `${d.id}:open`, type: "open", time: iso(d.pushOpenAt), conversionEvent: null, reward: null });
    }
    if (d.conversionAt) {
      events.push({ ...base, id: `${d.id}:conversion`, type: "conversion", time: iso(d.conversionAt), conversionEvent: d.conversionEvent, reward: d.reward });
    }
  }
  return events.sort((a, b) => b.time.localeCompare(a.time));
}
