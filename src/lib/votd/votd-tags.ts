// src/lib/votd/votd-tags.ts
export const GUIDED_SCRIPTURE_LABEL_TAG = "{{guided_scripture_label}}";
export const GUIDED_PRAYER_LABEL_TAG = "{{guided_prayer_label}}";
export const VOTD_REFERENCE_TAG = "{{votd_reference}}";
export const VOTD_TEXT_TAG = "{{votd_text}}";

const ALL_TAGS = [
  GUIDED_SCRIPTURE_LABEL_TAG,
  GUIDED_PRAYER_LABEL_TAG,
  VOTD_REFERENCE_TAG,
  VOTD_TEXT_TAG,
] as const;

export function hasVotdTags(title: string | null | undefined, body: string | null | undefined): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  return ALL_TAGS.some((tag) => text.includes(tag));
}

export type VotdSubstitutions = {
  guidedScriptureLabel: string;
  guidedPrayerLabel: string;
  votdReference: string;
  votdText: string;
};

export function substituteVotdTags(text: string, subs: VotdSubstitutions): string {
  return text
    .replaceAll(GUIDED_SCRIPTURE_LABEL_TAG, subs.guidedScriptureLabel)
    .replaceAll(GUIDED_PRAYER_LABEL_TAG, subs.guidedPrayerLabel)
    .replaceAll(VOTD_REFERENCE_TAG, subs.votdReference)
    .replaceAll(VOTD_TEXT_TAG, subs.votdText);
}
