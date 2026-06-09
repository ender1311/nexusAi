// Canonical list of Hightouch-synced "has ever interacted" boolean flags.
// Pinned by tests/regression/ingest-users-preferred-channel-flag-fields.test.ts.
export const INTERACTION_FLAGS = [
  "guided_scripture_interaction_has_ever_flag",
  "guided_prayer_interaction_has_ever_flag",
  "plan_audio_interaction_has_ever_flag",
  "plan_interaction_has_ever_flag",
  "plan_subscribed_has_ever_flag",
  "plan_day_completion_has_ever_flag",
  "pmt_participation_has_ever_flag",
  "votd_interaction_has_ever_flag",
  "votd_share_has_ever_flag",
] as const;

export type InteractionFlag = (typeof INTERACTION_FLAGS)[number];

const FLAG_SET = new Set<string>(INTERACTION_FLAGS);
export function isInteractionFlag(id: string): id is InteractionFlag {
  return FLAG_SET.has(id);
}

// Hightouch may send bool, "true"/"false" string, or 0/1 depending on the
// warehouse column type. Bi-state by design: absent/unrecognized → false,
// because conversion detection only ever acts on a confirmed true.
export function normalizeFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "t";
  }
  return false;
}

/**
 * Build the enrollment-time snapshot of interaction flags from a user's stored attributes.
 * Used as the Type-A baseline for first_interaction conversion detection.
 */
export function snapshotEnrollmentFlags(attrs: Record<string, unknown>): Record<string, boolean> {
  return INTERACTION_FLAGS.reduce<Record<string, boolean>>((acc, f) => {
    acc[f] = normalizeFlag(attrs[f]);
    return acc;
  }, {});
}

export const INTERACTION_FLAG_LABELS: Record<InteractionFlag, string> = {
  guided_scripture_interaction_has_ever_flag:
    "Guided Scripture (first interaction)",
  guided_prayer_interaction_has_ever_flag: "Guided Prayer (first interaction)",
  plan_audio_interaction_has_ever_flag: "Plan Audio (first interaction)",
  plan_interaction_has_ever_flag: "Plan (first interaction)",
  plan_subscribed_has_ever_flag: "Plan Subscribed (first time)",
  plan_day_completion_has_ever_flag: "Plan Day Completed (first time)",
  pmt_participation_has_ever_flag: "PMT Participation (first time)",
  votd_interaction_has_ever_flag: "Verse of the Day (first interaction)",
  votd_share_has_ever_flag: "Verse of the Day Share (first time)",
};
