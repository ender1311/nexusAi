export interface ArmStats {
  alpha: number; // successes (Thompson)
  beta: number;  // failures (Thompson)
  tries: number;
  wins: number;
}

export interface DecisionContext {
  userId: string;
  agentId: string;
  features?: Record<string, number | string | boolean>;
}

export interface DecisionResult {
  variantId: string;
  channel: string;
  explore: boolean;
  predictedReward: number;
}

export interface BanditArm {
  id: string;
  stats: ArmStats;
}

// --- LinUCB types ---

export interface LinUCBStats {
  /** Inverse of the design matrix A, stored flattened row-major (d×d floats).
   *  Maintained incrementally via the Sherman-Morrison rank-1 update. */
  aInv: number[];
  /** Accumulated reward vector b (d floats): Σ r_t * x_t */
  b: number[];
  tries: number;
}

export interface LinUCBArm {
  id: string;
  linucbStats: LinUCBStats;
}
