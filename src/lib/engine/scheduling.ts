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
  // Braze requires schedule.time to be a future UTC timestamp even with in_local_time: true —
  // it validates the absolute UTC time first, then re-interprets the hour per user's timezone.
  // If today's fallback hour has already passed in UTC, advance to tomorrow so the request is accepted.
  // Braze will then deliver at agentFallbackHour in each user's local timezone on that day,
  // and auto-advances to the day after for any user whose local hour has also passed.
  const fallback = new Date(now);
  fallback.setUTCHours(agentFallbackHour, 0, 0, 0);
  if (fallback <= now) {
    fallback.setUTCDate(fallback.getUTCDate() + 1);
  }
  return { scheduledAt: fallback, inLocalTime: true };
}


/**
 * Returns the UTC hour (0–23) with the highest cumulative conversion activity
 * from a user's hourlyStats array, or null when the array is all zeros (no data).
 *
 * Used as a secondary send-time fallback: when a user has no preferredSendHour
 * from last_seen_at, we use their historical peak engagement hour instead of the
 * agent-wide fallbackSendHour (which applies the same hour to all users).
 */
export function peakActivityHour(hourlyStats: unknown): number | null {
  const stats = Array.isArray(hourlyStats) ? (hourlyStats as number[]) : [];
  let maxVal = 0;
  let maxIdx = -1;
  for (let h = 0; h < Math.min(stats.length, 24); h++) {
    const v = stats[h] ?? 0;
    if (v > maxVal) { maxVal = v; maxIdx = h; }
  }
  return maxIdx === -1 ? null : maxIdx;
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

/**
 * Returns true if `now` falls within the quiet hours window [start, end) in the given timezone.
 *
 * Handles overnight windows (e.g. start="22:00", end="08:00") where start > end.
 *
 * @param start     "HH:MM" — window start (inclusive), e.g. "22:00"
 * @param end       "HH:MM" — window end (exclusive), e.g. "08:00"
 * @param timezone  IANA timezone string, e.g. "America/Los_Angeles", "UTC"
 * @param now       Current time as a Date object
 */
/**
 * Returns true if `now` falls on one of the suppressed days of the week in the given timezone.
 *
 * @param quietDays  Array of day-of-week numbers to suppress (0=Sunday, 6=Saturday)
 * @param timezone   IANA timezone string
 * @param now        Current time as a Date object
 */
export function isQuietDay(quietDays: number[], timezone: string, now: Date): boolean {
  if (quietDays.length === 0) return false;
  let dayOfWeek: number;
  try {
    // "Sunday"=0, "Monday"=1, ... "Saturday"=6
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value;
    const MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    dayOfWeek = MAP[weekday ?? ""] ?? now.getUTCDay();
  } catch {
    return false; // unknown timezone → don't suppress
  }
  return quietDays.includes(dayOfWeek);
}

/**
 * Returns true if the scheduled send lands on one of the agent's blackout dates.
 *
 * Blackout dates are global "YYYY-MM-DD" calendar dates on which no messages may
 * be sent, regardless of any other scheduling rule. We compare them against the
 * UTC calendar date of `scheduledAt` — the Braze schedule anchor — which is also
 * the delivery date for in_local_time sends. This matters because the fallback
 * path rolls a past send-hour forward to *tomorrow*, so a Friday cron run can
 * produce a Saturday delivery: checking `scheduledAt` (not `now`) is what catches
 * that rolled-forward date.
 *
 * @param scheduledAt    The computed UTC send time (from computeScheduledAt).
 * @param blackoutDates  Global blackout calendar dates as "YYYY-MM-DD" strings.
 */
export function isBlackoutDate(scheduledAt: Date, blackoutDates: string[]): boolean {
  if (blackoutDates.length === 0) return false;
  const ymd = scheduledAt.toISOString().slice(0, 10);
  return blackoutDates.includes(ymd);
}

/**
 * Returns the hour of day (0–23) that `utcTime` corresponds to in `timezone`.
 * Falls back to the UTC hour on invalid timezone strings.
 */
export function localHourOf(utcTime: Date, timezone: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(utcTime);
    const h = parseInt(s, 10);
    return Number.isNaN(h) ? utcTime.getUTCHours() : h % 24;
  } catch {
    return utcTime.getUTCHours();
  }
}

export function isInQuietHours(start: string, end: string, timezone: string, now: Date): boolean {
  let tzTime: string;
  try {
    tzTime = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
  } catch {
    return false; // unknown timezone → don't suppress
  }
  return start > end
    ? tzTime >= start || tzTime < end
    : tzTime >= start && tzTime < end;
}
