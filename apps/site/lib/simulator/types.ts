export type AlgorithmId = "thompson" | "epsilon" | "linucb";

export type Segment = { id: string; label: string; share: number };

/** rates[i] is the true conversion rate for segments[i]. */
export type Variant = { id: string; label: string; copy: string; rates: number[] };

export type Preset = {
  id: string;
  title: string;
  description: string;
  segments: Segment[];
  variants: Variant[];
  days: number;
  usersPerDay: number;
  holdoutShare: number;
};

export type DecisionSample = {
  userNumber: number;
  segmentId: string;
  variantId: string;
  explore: boolean;
  /** Algorithm's estimated conversion rate for this user and variant. */
  estimate: number;
  /** ± half-width of the estimate (0 when the algorithm has no notion of uncertainty). */
  uncertainty: number;
};

export type DayState = {
  day: number;
  /** Share of today's non-holdout sends per variant id (sums to 1). */
  trafficShare: Record<string, number>;
  /** Per segment: the variant this algorithm sent most often today. */
  topVariantBySegment: Record<string, string>;
  cumulativeSends: number;
  cumulativeConversions: number;
  cumulativeRate: number;
  holdoutRate: number;
  /** null when the holdout had no conversions, so lift is undefined rather than zero. */
  liftVsHoldout: number | null;
  cumulativeRegret: number;
  samples: DecisionSample[];
};

export type SimulationResult = { presetId: string; algorithm: AlgorithmId; seed: number; days: DayState[] };
