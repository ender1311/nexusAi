import { TimeSeriesPoint, VariantMetric, AgentMetric, TimingHeatmapCell, DecisionLog } from "@/types/metrics";

// Seeded PRNG (Mulberry32) — deterministic but varied data
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = seededRng(0xdeadbeef);

function rFloat(min: number, max: number) { return min + rng() * (max - min); }
function rInt(min: number, max: number) { return Math.floor(rFloat(min, max + 1)); }

// Realistic time series: weekday/weekend rhythm + gentle trend + spike events
function generateTimeSeries(days: number, baseSends: number, baseRate: number, trend: number): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  const now = new Date();
  const spikeDay = rInt(5, days - 5); // one campaign spike somewhere in the middle

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dow = date.getDay(); // 0=Sun 6=Sat
    const isWeekend = dow === 0 || dow === 6;

    // Sends drop ~25% on weekends
    const weekendFactor = isWeekend ? 0.75 : 1.0;
    // Campaign spike: +40% sends on spike day
    const spikeFactor = i === spikeDay ? 1.4 : 1.0;
    // Gentle day-over-day noise ±12%
    const sendNoise = 1 + (rng() - 0.5) * 0.24;
    const sends = Math.round(baseSends * weekendFactor * spikeFactor * sendNoise);

    // Conversion rate: upward trend + weekend dip + spike boost + noise
    const trendEffect = trend * (days - i) / days;
    const weekendRateDip = isWeekend ? -0.6 : 0;
    const spikeRateBoost = i === spikeDay ? 0.9 : 0;
    const rateNoise = (rng() - 0.5) * 1.2;
    const rate = Math.max(1.5, Math.min(16, baseRate + trendEffect + weekendRateDip + spikeRateBoost + rateNoise));
    const conversions = Math.round((sends * rate) / 100);

    points.push({
      date: date.toISOString().split("T")[0],
      sends,
      conversions,
      conversionRate: parseFloat(rate.toFixed(2)),
    });
  }
  return points;
}

export const globalTimeSeries = generateTimeSeries(30, 1080, 6.2, 1.8);

export const agentTimeSeries: Record<string, TimeSeriesPoint[]> = {
  agent_001: generateTimeSeries(30, 1420, 7.8, 2.4),
  agent_002: generateTimeSeries(30, 890, 5.1, 0.9),
  agent_003: generateTimeSeries(30, 380, 4.3, 3.2),
  agent_004: [],
};

export const variantMetrics: Record<string, VariantMetric[]> = {
  agent_001: [
    { variantId: "var_001", variantName: "V1 - Curiosity Hook",   channel: "push",  sends: 5240,  conversions: 423, conversionRate: 8.07, ciLow: 7.33, ciHigh: 8.81,  reward: 4230 },
    { variantId: "var_002", variantName: "V2 - Social Proof",     channel: "push",  sends: 5610,  conversions: 531, conversionRate: 9.47, ciLow: 8.70, ciHigh: 10.24, reward: 5310 },
    { variantId: "var_003", variantName: "V1 - Benefit Focused",  channel: "email", sends: 2780,  conversions: 186, conversionRate: 6.69, ciLow: 5.77, ciHigh: 7.61,  reward: 1860 },
  ],
  agent_002: [
    { variantId: "var_004", variantName: "V1 - Miss You",         channel: "push",  sends: 3640,  conversions: 169, conversionRate: 4.64, ciLow: 3.96, ciHigh: 5.32,  reward: 1352 },
    { variantId: "var_005", variantName: "V2 - Inspirational",    channel: "push",  sends: 3890,  conversions: 223, conversionRate: 5.73, ciLow: 5.01, ciHigh: 6.45,  reward: 1784 },
    { variantId: "var_006", variantName: "V3 - Streak Recovery",  channel: "push",  sends: 2140,  conversions: 64,  conversionRate: 2.99, ciLow: 2.29, ciHigh: 3.69,  reward: 384  },
  ],
  agent_003: [
    { variantId: "var_007", variantName: "V1 - Share Joy",        channel: "push",  sends: 3580,  conversions: 157, conversionRate: 4.38, ciLow: 3.72, ciHigh: 5.04,  reward: 1570 },
  ],
};

export const agentMetrics: AgentMetric[] = [
  { agentId: "agent_001", agentName: "Recommend Bible Plans",   status: "active", sends: 13630, conversions: 1140, conversionRate: 8.36, liftVsControl: 27.4, liftSignificant: true,  liftInsufficient: false, exploreRatio: 11 },
  { agentId: "agent_002", agentName: "Retention - Lapsed Users", status: "active", sends: 9670,  conversions: 456,  conversionRate: 4.72, liftVsControl: 16.8, liftSignificant: true,  liftInsufficient: false, exploreRatio: 14 },
  { agentId: "agent_003", agentName: "Referral Program",         status: "active", sends: 3580,  conversions: 157,  conversionRate: 4.38, liftVsControl: 34.1, liftSignificant: true,  liftInsufficient: false, exploreRatio: 22 },
];

export function generateTimingHeatmap(): TimingHeatmapCell[] {
  const cells: TimingHeatmapCell[] = [];
  // Morning peak 6–9am, lunch 12pm, evening 7–9pm. Weekend shifts to 9am/evening.
  for (let day = 0; day < 7; day++) {
    const isWeekend = day === 0 || day === 6;
    for (let hour = 0; hour < 24; hour++) {
      const isQuiet = hour < 5 || hour >= 23;
      if (isQuiet) { cells.push({ day, hour, value: 0 }); continue; }

      let base = 2;
      // Morning peak (weekday 6–9, weekend 8–10)
      if (!isWeekend && hour >= 6 && hour <= 9)  base += 4.5 + rng() * 2;
      if ( isWeekend && hour >= 8 && hour <= 10) base += 3.5 + rng() * 2;
      // Midday
      if (hour === 12) base += 1.5 + rng() * 1.5;
      // Evening peak (7–9pm universal)
      if (hour >= 19 && hour <= 21) base += 3 + rng() * 2.5;
      // Weekday bonus
      if (!isWeekend && hour >= 7 && hour <= 17) base += 0.8;
      // General noise
      base += (rng() - 0.5) * 1.4;

      cells.push({ day, hour, value: parseFloat(Math.max(0, Math.min(10, base)).toFixed(2)) });
    }
  }
  return cells;
}

export const timingHeatmap = generateTimingHeatmap();

const AGENT_NAMES = ["Recommend Bible Plans", "Retention - Lapsed Users", "Referral Program"];
const VARIANT_NAMES = [
  "V1 - Curiosity Hook", "V2 - Social Proof", "V1 - Benefit Focused",
  "V1 - Miss You", "V2 - Inspirational", "V3 - Streak Recovery", "V1 - Share Joy",
];
const CHANNELS = ["push", "push", "push", "email", "email", "sms"]; // push-weighted
const FIRST_NAMES = ["Jordan","Riley","Morgan","Alex","Casey","Taylor","Avery","Blake","Drew","Hayden","Quinn","Sage","Reese","Parker","Finley"];
const LAST_INIT  = "ABCDEFGHJKLMNPRSTW";

export const recentDecisions: DecisionLog[] = Array.from({ length: 30 }, (_, i) => {
  const converted = rng() < 0.09; // ~9% conversion rate
  // Decisions spread over last 6h, denser toward "now"
  const minutesAgo = Math.round(rng() * rng() * 360); // skewed toward recent
  const first = FIRST_NAMES[rInt(0, FIRST_NAMES.length - 1)];
  const last = LAST_INIT[rInt(0, LAST_INIT.length - 1)];
  const userId = `${first} ${last}.`;
  return {
    id: `dec_${String(i + 1).padStart(3, "0")}`,
    userId,
    agentName: AGENT_NAMES[rInt(0, AGENT_NAMES.length - 1)],
    channel: CHANNELS[rInt(0, CHANNELS.length - 1)],
    variantName: VARIANT_NAMES[rInt(0, VARIANT_NAMES.length - 1)],
    sentAt: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    converted,
    reward: converted ? parseFloat(rFloat(1.5, 12).toFixed(2)) : undefined,
  };
}).sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
