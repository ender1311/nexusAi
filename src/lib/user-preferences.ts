import { cache } from "react";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { parseHiddenStats, type StatKey } from "@/lib/stat-visibility";

/**
 * Stats the current user has chosen to hide, deduped and validated.
 * Defensive by design: returns [] on any failure (no session, missing table,
 * malformed JSON) so render paths never crash if the UserPreference table is
 * absent in an environment. Cached per request to dedup across server components.
 */
export const getHiddenStatsForCurrentUser = cache(async (): Promise<StatKey[]> => {
  try {
    const { user } = await getAuth();
    if (!user) return [];
    const pref = await prisma.userPreference.findUnique({
      where: { workosUserId: user.id },
    });
    return parseHiddenStats(pref?.hiddenStats);
  } catch {
    return [];
  }
});
