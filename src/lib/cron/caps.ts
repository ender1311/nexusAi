/**
 * Pure audience-capping helpers for the select-and-send cron. No DB access —
 * the orchestrator supplies counts (sent-today, unique-users) and applies the
 * returned trims.
 */

/** Fisher-Yates shuffle in place. RNG injectable for deterministic tests. */
function shuffle<T>(arr: T[], random: () => number = Math.random): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** True when two clock hours are within ±1, wrapping across midnight. */
function hoursAdjacent(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return Math.min(diff, 24 - diff) <= 1;
}

export type AudienceSelection = { kept: string[]; suppressed: number };

/**
 * Apply an agent's audience cap.
 *
 * When `prioritizeLastSeen` is on, users whose preferred send hour is within ±1
 * of the current UTC hour go first (shuffled for fairness), then users with no
 * preference; users whose preferred hour is far from now are deferred to their
 * matching hourly run (NOT counted as suppressed). Otherwise a plain Fisher-Yates
 * lottery is applied across all eligible users.
 */
export function selectAudience(
  userIds: string[],
  opts: {
    audienceCap: number;
    prioritizeLastSeen: boolean;
    currentHour: number;
    preferredHourByUser: Map<string, number | null>;
    random?: () => number;
  },
): AudienceSelection {
  const { audienceCap, prioritizeLastSeen, currentHour, preferredHourByUser, random = Math.random } = opts;

  if (prioritizeLastSeen) {
    const timeMatch: string[] = [];
    const noPreference: string[] = [];
    for (const uid of userIds) {
      const h = preferredHourByUser.get(uid);
      if (h !== null && h !== undefined) {
        if (hoursAdjacent(h, currentHour)) timeMatch.push(uid);
        // else: deferred to the matching hourly run — not suppressed
      } else {
        noPreference.push(uid);
      }
    }
    shuffle(timeMatch, random);
    shuffle(noPreference, random);
    const eligible = [...timeMatch, ...noPreference];
    const kept = eligible.slice(0, audienceCap);
    return { kept, suppressed: eligible.length - kept.length };
  }

  const pool = [...userIds];
  shuffle(pool, random);
  const kept = pool.slice(0, audienceCap);
  return { kept, suppressed: pool.length - kept.length };
}

/**
 * Trim a list to a remaining quota. `remaining <= 0` drops everything; otherwise
 * keeps the first `remaining`. Returns the kept ids and how many were dropped.
 */
export function trimToCap(userIds: string[], remaining: number): { kept: string[]; suppressed: number } {
  if (remaining <= 0) return { kept: [], suppressed: userIds.length };
  if (userIds.length > remaining) return { kept: userIds.slice(0, remaining), suppressed: userIds.length - remaining };
  return { kept: userIds, suppressed: 0 };
}
