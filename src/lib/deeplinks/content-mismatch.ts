const GENERIC_VOTD_LINKS = new Set([
  "https://www.bible.com/verse-of-the-day",
  "youversion://votd",
]);

export function isGenericVotdLink(url: string | null | undefined): boolean {
  if (!url) return false;
  return GENERIC_VOTD_LINKS.has(url.trim());
}

export function warnVerseOverride(input: {
  hasVerseVariants: boolean;
  override: string | null | undefined;
}): boolean {
  return input.hasVerseVariants && isGenericVotdLink(input.override);
}

export const CONTENT_MISMATCH_WARNING =
  "This agent quotes a specific verse, but the override opens today's Verse of the Day — the tap won't land on the quoted verse.";
