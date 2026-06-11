// src/lib/votd/local-date.ts
const FALLBACK_TZ = "America/Chicago";

function format(timeZone: string, at: Date): string {
  // en-CA renders YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

/** The user's local calendar date ("YYYY-MM-DD") at the given instant.
 *  Missing or invalid timezones fall back to America/Chicago. */
export function userLocalDate(timezone: string | null | undefined, at: Date): string {
  const tz = timezone && timezone.trim() ? timezone.trim() : FALLBACK_TZ;
  try {
    return format(tz, at);
  } catch {
    return format(FALLBACK_TZ, at);
  }
}
