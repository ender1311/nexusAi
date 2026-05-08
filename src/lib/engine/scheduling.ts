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
/**
 * Computes the scheduled delivery time for a push notification.
 *
 * When the user has a preferred send time, schedules 10 minutes before that UTC time today.
 * The 10-minute offset accounts for last_seen_at being session-end (sessions ~3-10 min),
 * so we arrive just before the user's next typical session start.
 * If that time has already passed, falls back to the agent's fallbackSendHour delivered in
 * local time via Braze in_local_time.
 *
 * @param preferredHour    User's preferred send hour (UTC), or null for fallback.
 * @param preferredMinute  User's preferred send minute (UTC), or null (treated as 0).
 * @param agentFallbackHour Agent-configured fallback hour (UTC) used when preferred is absent/past.
 * @param now              Current time (pass explicitly in tests to avoid real-clock dependency).
 */
export function computeScheduledAt(
  preferredHour: number | null,
  preferredMinute: number | null,
  agentFallbackHour: number,
  now: Date,
): { scheduledAt: Date; inLocalTime: boolean } {
  if (preferredHour !== null) {
    const candidate = new Date(now);
    // Computes a 10-minute offset using total-minutes arithmetic to handle cross-hour boundaries correctly
    const totalMinutes = preferredHour * 60 + (preferredMinute ?? 0) - 10;
    const offsetHour   = Math.floor(totalMinutes / 60);
    const offsetMinute = ((totalMinutes % 60) + 60) % 60;
    candidate.setUTCHours(offsetHour, offsetMinute, 0, 0);
    if (candidate > now) {
      return { scheduledAt: candidate, inLocalTime: false };
    }
  }
  // Fallback: deliver at the agent's configured hour in each user's local timezone via Braze in_local_time.
  // We pass today's date — do NOT advance to tomorrow based on UTC clock.
  // Braze's in_local_time re-interprets the hour in each user's local timezone and automatically
  // moves to the next day for users whose local 8am has already passed.
  // Advancing server-side would push ALL users to tomorrow, which is wrong for US timezones
  // when the cron runs after 8am UTC but before 8am local time.
  const fallback = new Date(now);
  fallback.setUTCHours(agentFallbackHour, 0, 0, 0);
  return { scheduledAt: fallback, inLocalTime: true };
}

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
