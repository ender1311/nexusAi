export interface ControlAgent {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  defaultEnabled: boolean;
  impactWeights: {
    responseRate: number;
    revenue: number;
    churnReduction: number;
    funnelProgression: number;
  };
}

export interface OptimizationParam {
  id: string;
  label: string;
  description: string;
  direction: "maximize" | "minimize";
  unit: string;
  baseline: number;
  bestCase: number;
  format: (v: number) => string;
}

export interface ScanningPhase {
  label: string;
  durationMs: number;
}

export interface PredictionResult {
  paramId: string;
  label: string;
  direction: "maximize" | "minimize";
  unit: string;
  current: number;
  predicted: number;
  confidenceLow: number;
  confidenceHigh: number;
  format: (v: number) => string;
  isPrimary: boolean;
  guardrailThreshold?: number;
  guardrailSafe?: boolean;
}

export interface OptimizationConfig {
  primaryObjective: string;
  guardrails: Record<string, number>;
}

export const controlAgents: ControlAgent[] = [
  {
    id: "content-optimizer",
    name: "Content Optimizer",
    description: "Personalizes message content per user behavioral profile",
    icon: "Sparkles",
    color: "#ff3d4d",
    defaultEnabled: true,
    impactWeights: { responseRate: 0.7, revenue: 0.4, churnReduction: 0.3, funnelProgression: 0.5 },
  },
  {
    id: "send-time-predictor",
    name: "Send-Time Predictor",
    description: "Finds optimal delivery windows for each user timezone",
    icon: "Clock",
    color: "#1ab7c9",
    defaultEnabled: true,
    impactWeights: { responseRate: 0.6, revenue: 0.2, churnReduction: 0.2, funnelProgression: 0.3 },
  },
  {
    id: "channel-router",
    name: "Channel Router",
    description: "Selects best channel — push, email, or SMS — per user",
    icon: "Radio",
    color: "#1ac980",
    defaultEnabled: true,
    impactWeights: { responseRate: 0.5, revenue: 0.3, churnReduction: 0.4, funnelProgression: 0.4 },
  },
  {
    id: "churn-sentinel",
    name: "Churn Sentinel",
    description: "Detects early churn signals and triggers preventive actions",
    icon: "ShieldCheck",
    color: "#ff801a",
    defaultEnabled: true,
    impactWeights: { responseRate: 0.2, revenue: 0.3, churnReduction: 0.9, funnelProgression: 0.2 },
  },
  {
    id: "revenue-maximizer",
    name: "Revenue Maximizer",
    description: "Optimizes messaging sequences for monetization events",
    icon: "DollarSign",
    color: "#801aff",
    defaultEnabled: false,
    impactWeights: { responseRate: 0.3, revenue: 0.9, churnReduction: 0.1, funnelProgression: 0.6 },
  },
  {
    id: "funnel-accelerator",
    name: "Funnel Accelerator",
    description: "Moves users to the next engagement tier faster",
    icon: "Rocket",
    color: "#ff3d4d",
    defaultEnabled: false,
    impactWeights: { responseRate: 0.4, revenue: 0.5, churnReduction: 0.2, funnelProgression: 0.9 },
  },
];

export const optimizationParams: OptimizationParam[] = [
  {
    id: "responseRate",
    label: "Response Rate",
    description: "Percentage of users who engage with messages",
    direction: "maximize",
    unit: "%",
    baseline: 6.2,
    bestCase: 14.8,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: "revenue",
    label: "Revenue per User",
    description: "Average revenue generated per active user",
    direction: "maximize",
    unit: "$/user",
    baseline: 0.42,
    bestCase: 1.18,
    format: (v) => `$${v.toFixed(2)}`,
  },
  {
    id: "churnReduction",
    label: "Churn Rate",
    description: "Monthly percentage of users who disengage",
    direction: "minimize",
    unit: "%",
    baseline: 8.4,
    bestCase: 2.1,
    format: (v) => `${v.toFixed(1)}%`,
  },
  {
    id: "funnelProgression",
    label: "Funnel Upgrade",
    description: "Users advancing to next engagement tier",
    direction: "maximize",
    unit: "%",
    baseline: 3.8,
    bestCase: 11.2,
    format: (v) => `${v.toFixed(1)}%`,
  },
];

export const scanningPhases: ScanningPhase[] = [
  { label: "Initializing neural inference engine...", durationMs: 700 },
  { label: "Analyzing 2.5M user behavioral vectors...", durationMs: 900 },
  { label: "Running Thompson sampling simulations...", durationMs: 800 },
  { label: "Optimizing delivery windows across 12 timezones...", durationMs: 700 },
  { label: "Computing persona-level impact projections...", durationMs: 600 },
  { label: "Calibrating confidence intervals...", durationMs: 500 },
  { label: "Assembling prediction matrix...", durationMs: 800 },
];

export function buildDefaultConfig(): OptimizationConfig {
  return {
    primaryObjective: "responseRate",
    guardrails: {
      revenue: 0.35,
      churnReduction: 10.0,
      funnelProgression: 2.0,
    },
  };
}

export function computePredictions(
  enabledAgentIds: string[],
  config: OptimizationConfig,
  realBaselines?: { convRate?: number },
  agentPool?: ControlAgent[]
): PredictionResult[] {
  const pool = agentPool ?? controlAgents;
  const enabledAgents = pool.filter((a) => enabledAgentIds.includes(a.id));

  // Substitute real baseline for responseRate when available
  const params = optimizationParams.map((p) =>
    p.id === "responseRate" && realBaselines?.convRate !== undefined && realBaselines.convRate > 0
      ? { ...p, baseline: parseFloat(realBaselines.convRate.toFixed(2)), bestCase: Math.max(p.bestCase, realBaselines.convRate * 2) }
      : p
  );

  return params.map((param) => {
    const isPrimary = param.id === config.primaryObjective;

    // Sum impact weights of all enabled agents for this parameter
    const totalImpact = enabledAgents.reduce(
      (sum, agent) => sum + agent.impactWeights[param.id as keyof typeof agent.impactWeights],
      0
    );

    // Normalize impact (max possible is pool.length agents × 1.0)
    const normalizedImpact = Math.min(totalImpact / Math.max(pool.length, 1), 1);

    // Primary gets full optimization weight; non-primary metrics get passive spillover (0.2)
    const effectiveImpact = normalizedImpact * (isPrimary ? 1.0 : 0.2);

    // Interpolate between baseline and best case
    const range = param.bestCase - param.baseline;
    const predicted = param.baseline + range * effectiveImpact;

    // Confidence band: ±(5-15)% of predicted value
    const confBand = Math.abs(predicted) * (0.05 + (1 - effectiveImpact) * 0.1);

    // Check guardrail
    const threshold = config.guardrails[param.id];
    let guardrailSafe: boolean | undefined;
    if (!isPrimary && threshold !== undefined) {
      guardrailSafe =
        param.direction === "minimize" ? predicted <= threshold : predicted >= threshold;
    }

    return {
      paramId: param.id,
      label: param.label,
      direction: param.direction,
      unit: param.unit,
      current: param.baseline,
      predicted,
      confidenceLow: predicted - confBand,
      confidenceHigh: predicted + confBand,
      format: param.format,
      isPrimary,
      guardrailThreshold: threshold,
      guardrailSafe,
    };
  });
}
