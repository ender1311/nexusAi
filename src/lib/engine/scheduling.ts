/**
 * Returns the start of the current calendar day (midnight) in the given
 * IANA timezone, expressed as a UTC Date.
 *
 * Example: at 14:00 UTC on 2026-05-02, getTodayStartUTC("America/New_York")
 * returns 2026-05-02T04:00:00.000Z  (midnight ET = 04:00 UTC in EDT).
 *
 * @param timezone  Any IANA timezone string (e.g. "America/New_York", "UTC")
 * @param now       Optional — current time. Defaults to new Date(). Pass an
 *                  explicit value in tests to avoid real-clock dependency.
 */
export function getTodayStartUTC(timezone: string, now: Date = new Date()): Date {
  // Step 1: What date is "today" in the target timezone? (en-CA gives YYYY-MM-DD)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  }).format(now);  // e.g. "2026-05-02"

  // Step 2: Anchor to UTC midnight of that date string.
  //   At this UTC moment, what local time does the timezone show?
  const anchorUtc = new Date(`${todayStr}T00:00:00Z`);

  // Step 3: Format that anchor in the target timezone to read the local hour/minute.
  const localTimeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour:     "2-digit",
    minute:   "2-digit",
    hour12:   false,
  }).format(anchorUtc);  // e.g. "20:00" for ET (UTC-4 offset → shows prior evening)

  const [hourStr, minStr] = localTimeStr.split(":");
  const localHour = parseInt(hourStr, 10);
  const localMin  = parseInt(minStr,  10);

  const localMinutes = localHour * 60 + localMin;

  // Step 4: Compute the offset between anchor UTC and true local midnight.
  //   - If local shows e.g. 20:00 when UTC is 00:00, timezone is UTC-4:
  //       true midnight = anchor + (24*60 - 20*60) minutes = anchor + 4 hours
  //   - If local shows e.g. 05:30 when UTC is 00:00, timezone is UTC+5:30:
  //       true midnight = anchor - 5*60 - 30 minutes
  let offsetMs: number;
  if (localMinutes === 0) {
    offsetMs = 0;
  } else if (localMinutes <= 12 * 60) {
    // Timezone is ahead of UTC (local time is morning when UTC is midnight)
    offsetMs = -localMinutes * 60_000;
  } else {
    // Timezone is behind UTC (local time is evening when UTC is midnight)
    offsetMs = (24 * 60 - localMinutes) * 60_000;
  }

  return new Date(anchorUtc.getTime() + offsetMs);
}
