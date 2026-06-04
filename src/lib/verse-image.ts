// Pure helpers for verse-push images. A MessageVariant whose iconImageUrl equals
// VERSE_IMAGE_SENTINEL resolves a per-verse image at send time from the chosen
// verse's image_id; a literal https URL is used as-is. No I/O.

/** iconImageUrl marker: resolve a per-verse image from the chosen verse's image_id. */
export const VERSE_IMAGE_SENTINEL = "__NEXUS_VERSE_IMAGE__";

/** Fallback image_id when a verse has no curated image (the Canvas default). */
export const DEFAULT_VERSE_IMAGE_ID = "1012";

const PROXY = "https://imageproxy-cdn.youversionapi.com";
const MASTER = "https://s3.amazonaws.com/static-youversionapi-com/images/base";

/** Build a YouVersion imageproxy URL: {W}x{H} crop of the square 1280x1280 master. */
export function buildVerseImageUrl(imageId: string, w: number, h: number): string {
  return `${PROXY}/${w}x${h}/${MASTER}/${imageId}/1280x1280.jpg`;
}

/** Per-platform verse image URLs: 320x320 square for iOS, 1024x512 (2:1) for Android. */
export function buildVerseImageUrls(imageId: string): { ios: string; android: string } {
  return {
    ios: buildVerseImageUrl(imageId, 320, 320),
    android: buildVerseImageUrl(imageId, 1024, 512),
  };
}

/** Braze iOS asset_file_type from a URL extension. Defaults to "jpg". */
export function assetFileTypeFromUrl(url: string): string {
  const m = url.split("?")[0].match(/\.([a-zA-Z0-9]+)$/);
  const ext = m?.[1]?.toLowerCase();
  return ext && ["jpg", "jpeg", "png", "gif", "mp4"].includes(ext)
    ? (ext === "jpeg" ? "jpg" : ext)
    : "jpg";
}
