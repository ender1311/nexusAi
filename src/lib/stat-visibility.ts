// Per-user stat-card visibility: a stable catalog of toggleable stats across the
// two surfaces that render stat cards (the /agents list cards and the dashboard
// metric cards). Preferences only ever HIDE a stat — an unset/new user sees all.
//
// Pure module: no DB, no IO. The DB-backed read/write lives in user-preferences.ts.

export type StatKey =
  // Agent list cards (src/components/agents/agent-card.tsx)
  | "agent.algorithm"
  | "agent.decisions"
  | "agent.dailyCap"
  | "agent.uniqueUsers"
  | "agent.convergence"
  | "agent.conversionRate"
  | "agent.pushOpenRate"
  // Dashboard metric cards (src/app/page.tsx)
  | "dashboard.trackedUsers"
  | "dashboard.activeAgents"
  | "dashboard.messagesSent24h"
  | "dashboard.avgConversionRate"
  | "dashboard.totalSends"
  | "dashboard.pushOpenRate";

export type StatGroup = {
  surface: "agent" | "dashboard";
  label: string;
  stats: { key: StatKey; label: string }[];
};

export const STAT_CATALOG: StatGroup[] = [
  {
    surface: "agent",
    label: "Agent cards",
    stats: [
      { key: "agent.algorithm", label: "Algorithm" },
      { key: "agent.decisions", label: "Decisions" },
      { key: "agent.dailyCap", label: "Daily cap" },
      { key: "agent.uniqueUsers", label: "Unique users" },
      { key: "agent.convergence", label: "Convergence status" },
      { key: "agent.conversionRate", label: "Conversion rate" },
      { key: "agent.pushOpenRate", label: "Push open rate" },
    ],
  },
  {
    surface: "dashboard",
    label: "Dashboard metrics",
    stats: [
      { key: "dashboard.trackedUsers", label: "Tracked users" },
      { key: "dashboard.activeAgents", label: "Active agents" },
      { key: "dashboard.messagesSent24h", label: "Messages sent (24h)" },
      { key: "dashboard.avgConversionRate", label: "Avg conversion rate" },
      { key: "dashboard.totalSends", label: "Total sends" },
      { key: "dashboard.pushOpenRate", label: "Push open rate" },
    ],
  },
];

const ALL_KEYS: ReadonlySet<string> = new Set(STAT_CATALOG.flatMap((g) => g.stats.map((s) => s.key)));

export function isKnownStatKey(value: unknown): value is StatKey {
  return typeof value === "string" && ALL_KEYS.has(value);
}

export function isStatHidden(hidden: readonly string[], key: StatKey): boolean {
  return hidden.includes(key);
}

// Parse the DB-stored JSON string into a clean, deduped list of known keys.
// Tolerant by design: malformed JSON or unknown keys collapse to "nothing hidden"
// rather than throwing, so a corrupt row can never blank out a user's UI.
export function parseHiddenStats(raw: string | null | undefined): StatKey[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter(isKnownStatKey))];
}

// Validate an incoming list (from the API client) down to known keys, deduped.
export function sanitizeHiddenStats(values: unknown): StatKey[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter(isKnownStatKey))];
}
