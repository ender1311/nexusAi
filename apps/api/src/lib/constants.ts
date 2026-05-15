export const LIBRARY_AGENT_NAME = "Push Copy Library";

export const FUNNEL_STAGES = [
  "new",
  "dau4",
  "wau",
  "mau",
  "lapsed_dau4",
  "lapsed_wau",
  "lapsed_mau",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];
