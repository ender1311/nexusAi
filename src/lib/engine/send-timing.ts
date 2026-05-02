/** Index of the maximum value in an array. Returns 0 for all-zero or empty arrays. */
function argmax(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

/**
 * Index of the second-largest value (skipping `primary` index).
 * When all values tie, returns the lowest index that is not `primary`.
 */
function argSecondMax(arr: number[], primary: number): number {
  // Start from the first index that is not `primary`
  let best = primary === 0 ? 1 : 0;
  for (let i = 0; i < arr.length; i++) {
    if (i === primary) continue;
    if (arr[i] > arr[best]) best = i;
  }
  return best;
}

const FALLBACK = { hour: 9, dayOfWeek: 0 } as const;

/**
 * Returns true if the current time (ET hour + day-of-week) is within the
 * target send window for a user's Nth exploration send.
 *
 * Always returns true when either stats array is all-zero (fallback path:
 * no behavioral data → send any time).
 *
 * @param hourlyStats   24-element array (index = hour 0–23)
 * @param dailyStats    7-element array (0 = Sunday)
 * @param sendIndex     0–3 (which exploration send this is)
 * @param currentHour   Current hour in ET (0–23)
 * @param currentDay    Current day-of-week in ET (0 = Sunday)
 */
export function isTimingMatch(
  hourlyStats: number[],
  dailyStats: number[],
  sendIndex: number,
  currentHour: number,
  currentDay: number,
): boolean {
  const allZeroHourly = hourlyStats.every((v) => v === 0);
  const allZeroDaily  = dailyStats.every((v) => v === 0);
  if (allZeroHourly || allZeroDaily) return true;

  const target = computeSendTime(hourlyStats, dailyStats, sendIndex);
  const hourDiff = Math.abs(currentHour - target.hour);
  const hourMatch = hourDiff <= 1 || hourDiff >= 23;  // wrap-around (e.g. 23 and 0)
  return hourMatch && currentDay === target.dayOfWeek;
}

/**
 * Returns the target send time for a user's Nth exploration send.
 *
 * sendIndex 0, 2 → primary peak (highest value in hourlyStats × highest in dailyStats)
 * sendIndex 1, 3 → secondary peak (second-highest in each array)
 *
 * Falls back to { hour: 9, dayOfWeek: 0 } (Sunday 9 AM) when either array
 * is all-zero — covers lapsed users with no prior behavioral data.
 *
 * @param hourlyStats  24-element array from TrackedUser.hourlyStats (index = hour 0–23)
 * @param dailyStats   7-element array from TrackedUser.dailyStats (0 = Sunday)
 * @param sendIndex    0–3 (which of the 4 exploration sends this is)
 */
export function computeSendTime(
  hourlyStats: number[],
  dailyStats: number[],
  sendIndex: number,
): { hour: number; dayOfWeek: number } {
  const allZeroHourly = hourlyStats.every((v) => v === 0);
  const allZeroDaily  = dailyStats.every((v) => v === 0);
  if (allZeroHourly || allZeroDaily) return FALLBACK;

  const isPrimary = sendIndex % 2 === 0;  // 0, 2 → primary; 1, 3 → secondary

  const primaryHour = argmax(hourlyStats);
  const primaryDay  = argmax(dailyStats);

  if (isPrimary) {
    return { hour: primaryHour, dayOfWeek: primaryDay };
  }

  return {
    hour:       argSecondMax(hourlyStats, primaryHour),
    dayOfWeek:  argSecondMax(dailyStats,  primaryDay),
  };
}
