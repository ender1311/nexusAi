export type EngagementLevel = "daily" | "regular" | "moderate" | "sporadic" | "weekly" | "dormant";
export type ContentMode = "text" | "audio" | "video" | "plans" | "cross-refs" | "short-video" | "intro-video" | "multi-translation";
export type AgeRange = "14-17" | "16-22" | "18-24" | "22-28" | "25-32" | "28-34" | "30-39" | "35-44" | "35-45" | "40-55" | "45-55" | "55-65";

export interface PersonaMetrics {
  userCount: number;
  percentOfTotal: number;
  avgSessionsPerWeek: number;
  conversionRate: number;
  churnRisk: number; // percentage
  ltv: number; // score 1-10
  avgSessionMinutes: number;
  streakDays: number;
}

export interface PersonaColorConfig {
  bg: string;
  text: string;
  border: string;
  dot: string;
  iconBg: string;
  ring: string;
}

// DB-backed persona shape (returned by API)
export interface Persona {
  id: string;
  name: string;
  label: string | null;
  icon: string;
  color: string;
  description: string | null;
  source: "manual" | "discovered";
  isActive: boolean;
  tags: string[];
  clusterSize: number;
  silhouetteScore: number | null;
  discoveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { trackedUsers: number };

  // Rich fields (present for seeded/manual personas, may be absent for discovered)
  lifeContext?: string;
  demographics?: {
    ageRange: AgeRange | string;
    gender: "M" | "F" | "Mixed";
  };
  engagement?: {
    level: EngagementLevel;
    label: string;
  };
  contentModes?: ContentMode[];
  features?: string[];
  channels?: Array<"push" | "email" | "sms" | "in-app">;
  metrics?: PersonaMetrics;

  // Discovered persona fields
  discoveredTraits?: {
    dominantChannel?: string;
    peakHour?: number;
    engagementLevel?: string;
    conversionRate?: number;
    avgReward?: number;
  };
}
