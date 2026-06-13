// src/lib/votd/votd-tags.ts
export const GUIDED_SCRIPTURE_LABEL_TAG = "{{guided_scripture_label}}";
export const GUIDED_PRAYER_LABEL_TAG = "{{guided_prayer_label}}";
export const VOTD_REFERENCE_TAG = "{{votd_reference}}";
export const VOTD_TEXT_TAG = "{{votd_text}}";
// Guided Prayer content tags — resolved from prayer.youversionapi.com (not VOTD)
export const GP_REFERENCE_TAG = "{{gp_verse_ref}}";
export const GP_TEXT_TAG = "{{gp_verse_text}}";

// GUIDED_PRAYER_LABEL_TAG is intentionally excluded — GP variants use GP_REFERENCE_TAG /
// GP_TEXT_TAG as their primary content signals. Including the prayer label here caused
// false positives that routed GP variants into the VOTD content-fetch path.
const VOTD_TAGS = [
  GUIDED_SCRIPTURE_LABEL_TAG,
  VOTD_REFERENCE_TAG,
  VOTD_TEXT_TAG,
] as const;

const GP_TAGS = [GP_REFERENCE_TAG, GP_TEXT_TAG] as const;

export function hasVotdTags(title: string | null | undefined, body: string | null | undefined): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  return VOTD_TAGS.some((tag) => text.includes(tag));
}

export function hasGpTags(title: string | null | undefined, body: string | null | undefined): boolean {
  const text = `${title ?? ""} ${body ?? ""}`;
  return GP_TAGS.some((tag) => text.includes(tag));
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

export type GpSubstitutions = {
  guidedPrayerLabel: string;
  gpReference: string;
  gpText: string;
};

export function substituteGpTags(text: string, subs: GpSubstitutions): string {
  return text
    .replaceAll(GUIDED_PRAYER_LABEL_TAG, subs.guidedPrayerLabel)
    .replaceAll(GP_REFERENCE_TAG, subs.gpReference)
    .replaceAll(GP_TEXT_TAG, subs.gpText);
}
