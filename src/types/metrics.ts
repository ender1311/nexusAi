export interface TimeSeriesPoint {
  date: string;
  conversions: number;
  sends: number;
  conversionRate: number;
}

export interface VariantMetric {
  variantId: string;
  variantName: string;
  channel: string;
  sends: number;
  conversions: number;
  conversionRate: number;
  ciLow: number;
  ciHigh: number;
  reward: number;
}

export interface AgentMetric {
  agentId: string;
  agentName: string;
  status: string;
  sends: number;
  conversions: number;
  conversionRate: number;
  liftVsControl: number;
  /** True when the lift is statistically significant (p < 0.05, n >= 200) */
  liftSignificant: boolean;
  /** True when there are fewer than 200 sends — significance verdict withheld */
  liftInsufficient: boolean;
  exploreRatio: number;
  pushSends?: number;
  pushOpenRate?: number;
}

export interface TimingHeatmapCell {
  hour: number;
  day: number;
  value: number;
}

export interface DashboardKPIs {
  activeAgents: number;
  sentLast24h: number;
  avgConversionRate: number;
  activeUsers: number;
}

export interface DecisionLog {
  id: string;
  userId: string;
  agentName: string;
  channel: string;
  variantName: string;
  sentAt: string;
  converted: boolean;
  reward?: number;
}
