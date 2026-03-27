import { TimeSeriesPoint, VariantMetric, AgentMetric, TimingHeatmapCell, DecisionLog } from "@/types/metrics";

function generateTimeSeries(days: number, baseRate: number, trend: number = 0): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const noise = (Math.random() - 0.5) * 0.8;
    const trendEffect = trend * (days - i);
    const sends = Math.floor(800 + Math.random() * 400);
    const rate = Math.max(0.5, Math.min(15, baseRate + noise + trendEffect));
    const conversions = Math.floor((sends * rate) / 100);
    points.push({
      date: date.toISOString().split("T")[0],
      sends,
      conversions,
      conversionRate: parseFloat(rate.toFixed(2)),
    });
  }
  return points;
}

export const globalTimeSeries = generateTimeSeries(30, 6.2, 0.05);

export const agentTimeSeries: Record<string, TimeSeriesPoint[]> = {
  agent_001: generateTimeSeries(30, 7.8, 0.08),
  agent_002: generateTimeSeries(30, 5.2, 0.03),
  agent_003: generateTimeSeries(30, 4.1, 0.12),
  agent_004: [],
};

export const variantMetrics: Record<string, VariantMetric[]> = {
  agent_001: [
    { variantId: "var_001", variantName: "V1 - Curiosity Hook", channel: "push", sends: 4820, conversions: 398, conversionRate: 8.26, ciLow: 7.5, ciHigh: 9.0, reward: 3980 },
    { variantId: "var_002", variantName: "V2 - Social Proof", channel: "push", sends: 5130, conversions: 461, conversionRate: 8.99, ciLow: 8.2, ciHigh: 9.8, reward: 4610 },
    { variantId: "var_003", variantName: "V1 - Benefit Focused", channel: "email", sends: 2500, conversions: 175, conversionRate: 7.0, ciLow: 6.0, ciHigh: 8.0, reward: 1750 },
  ],
  agent_002: [
    { variantId: "var_004", variantName: "V1 - Miss You", channel: "push", sends: 3200, conversions: 160, conversionRate: 5.0, ciLow: 4.3, ciHigh: 5.7, reward: 1280 },
    { variantId: "var_005", variantName: "V2 - Inspirational", channel: "push", sends: 3450, conversions: 190, conversionRate: 5.51, ciLow: 4.8, ciHigh: 6.2, reward: 1520 },
    { variantId: "var_006", variantName: "V3 - Streak Recovery", channel: "push", sends: 2270, conversions: 82, conversionRate: 3.61, ciLow: 2.9, ciHigh: 4.3, reward: 328 },
  ],
  agent_003: [
    { variantId: "var_007", variantName: "V1 - Share Joy", channel: "push", sends: 3210, conversions: 131, conversionRate: 4.08, ciLow: 3.4, ciHigh: 4.8, reward: 1310 },
  ],
};

export const agentMetrics: AgentMetric[] = [
  { agentId: "agent_001", agentName: "Recommend Bible Plans", status: "active", sends: 12450, conversions: 1034, conversionRate: 8.31, liftVsControl: 24.7, exploreRatio: 12 },
  { agentId: "agent_002", agentName: "Retention - Lapsed Users", status: "active", sends: 8920, conversions: 432, conversionRate: 4.84, liftVsControl: 18.2, exploreRatio: 15 },
  { agentId: "agent_003", agentName: "Referral Program", status: "active", sends: 3210, conversions: 131, conversionRate: 4.08, liftVsControl: 31.5, exploreRatio: 20 },
];

export function generateTimingHeatmap(): TimingHeatmapCell[] {
  const cells: TimingHeatmapCell[] = [];
  const peakHours = [7, 8, 9, 12, 17, 18, 19, 20];
  const weekdays = [1, 2, 3, 4]; // Mon-Thu best
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const isQuiet = hour >= 22 || hour < 7;
      const isPeak = peakHours.includes(hour);
      const isWeekday = weekdays.includes(day);
      let value = 0;
      if (!isQuiet) {
        value = 2 + Math.random() * 3;
        if (isPeak) value *= 1.8;
        if (isWeekday) value *= 1.3;
        value += (Math.random() - 0.5) * 1.5;
        value = Math.max(0, Math.min(10, value));
      }
      cells.push({ day, hour, value: parseFloat(value.toFixed(2)) });
    }
  }
  return cells;
}

export const timingHeatmap = generateTimingHeatmap();

const channels = ["push", "email", "sms"];
const agents = ["Recommend Bible Plans", "Retention - Lapsed Users", "Referral Program"];
const variants = ["V1 - Curiosity Hook", "V2 - Social Proof", "V1 - Miss You", "V2 - Inspirational", "V1 - Share Joy"];

export const recentDecisions: DecisionLog[] = Array.from({ length: 20 }, (_, i) => {
  const converted = Math.random() > 0.92;
  const hoursAgo = Math.floor(Math.random() * 24);
  return {
    id: `dec_${i + 1}`,
    userId: `user_${Math.floor(100000 + Math.random() * 900000)}`,
    agentName: agents[Math.floor(Math.random() * agents.length)],
    channel: channels[Math.floor(Math.random() * channels.length)],
    variantName: variants[Math.floor(Math.random() * variants.length)],
    sentAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    converted,
    reward: converted ? parseFloat((Math.random() * 10).toFixed(2)) : undefined,
  };
}).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
