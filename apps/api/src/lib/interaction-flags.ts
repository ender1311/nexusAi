// Mirror of src/lib/constants/interaction-flags.ts for use in apps/api/
// (apps/api cannot import from src/). Keep in sync with the canonical list.
// Drift is pinned by tests/unit/interaction-flags-mirror.test.ts.
export const INTERACTION_FLAGS = [
  "guided_scripture_interaction_has_ever_flag",
  "guided_prayer_interaction_has_ever_flag",
  "audio_bible_interaction_has_ever_flag",
  "plan_audio_interaction_has_ever_flag",
  "plan_interaction_has_ever_flag",
  "plan_subscribed_has_ever_flag",
  "plan_day_completion_has_ever_flag",
  "pmt_participation_has_ever_flag",
  "votd_interaction_has_ever_flag",
  "votd_share_has_ever_flag",
] as const;

const FLAG_SET = new Set<string>(INTERACTION_FLAGS);
export function isInteractionFlag(id: string): boolean {
  return FLAG_SET.has(id);
}
