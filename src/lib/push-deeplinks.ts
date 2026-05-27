export const GENERIC_BIBLE_DEEPLINK = "youversion://bible";
export const SPECIFIC_VERSE_DEEPLINK_PREFIX = "youversion://bible?reference=";

export type SpecificVerseDeeplinkMode = "generic" | "specific";

export function buildSpecificVerseDeeplink(usfm: string): string {
  return `${SPECIFIC_VERSE_DEEPLINK_PREFIX}${usfm}`;
}

export function parseUsfmFromDeeplink(
  deeplink: string | null | undefined,
): string | null {
  if (!deeplink || typeof deeplink !== "string") {
    return null;
  }

  if (!deeplink.startsWith(SPECIFIC_VERSE_DEEPLINK_PREFIX)) {
    return null;
  }

  const reference = deeplink.slice(SPECIFIC_VERSE_DEEPLINK_PREFIX.length);
  return reference.length > 0 ? reference : null;
}

export function isSpecificVerseDeeplink(
  deeplink: string | null | undefined,
): boolean {
  if (!deeplink || typeof deeplink !== "string") {
    return false;
  }

  if (!deeplink.startsWith(SPECIFIC_VERSE_DEEPLINK_PREFIX)) {
    return false;
  }

  const reference = deeplink.slice(SPECIFIC_VERSE_DEEPLINK_PREFIX.length);
  return reference.length > 0;
}

export function resolveSpecificVerseDeeplink(
  storedDeeplink: string | null | undefined,
  mode: SpecificVerseDeeplinkMode,
): string {
  if (mode === "generic") {
    return GENERIC_BIBLE_DEEPLINK;
  }

  return storedDeeplink ?? GENERIC_BIBLE_DEEPLINK;
}
