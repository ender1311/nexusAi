/**
 * Nexus campaign attribution. Every web link Nexus sends (push deeplinks,
 * content-card / slideup links) carries:
 *   - utm_campaign=nexus
 *   - utm_source=<channel>   (push | email | content-card | in-app)
 * Giving deeplinks additionally carry utm_content=<handle> (e.g. "25handle"),
 * set by buildGivingDeeplink where the per-user ask amount is resolved — this
 * helper preserves it.
 *
 * Only http(s) URLs are tagged. App-scheme deeplinks (e.g. youversion://bible?
 * reference=JHN.3.16) are returned unchanged — a query param there would corrupt
 * the in-app reference parser (see parseUsfmFromDeeplink), and UTM is meaningless
 * for an app-scheme open anyway.
 */
export const NEXUS_UTM_CAMPAIGN = "nexus";

/** Canonical utm_source values, one per outbound channel. */
export type NexusUtmSource = "push" | "email" | "content-card" | "in-app" | "modal-iam";

/**
 * Set utm_campaign=nexus and utm_source=<source> on an http(s) URL, preserving
 * any other existing query params (including a utm_content set upstream).
 * Idempotent. Non-http(s) values (app-scheme deeplinks, null/empty, unparseable)
 * are returned unchanged.
 */
export function withNexusUtm(
  url: string | null | undefined,
  source: NexusUtmSource,
): string | null | undefined {
  if (typeof url !== "string" || url.length === 0) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("utm_campaign", NEXUS_UTM_CAMPAIGN);
    u.searchParams.set("utm_source", source);
    // buildGivingDeeplink seeds a legacy utm_medium=push; when this link is sent on
    // a non-push channel that "push" is a lie. Realign medium to the channel when
    // present (don't add one to links that never had it).
    if (u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", source);
    return u.toString();
  } catch {
    return url;
  }
}
