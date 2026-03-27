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
