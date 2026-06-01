/**
 * Pure funnel-recovery rule. No DB/API — unit-testable in isolation.
 *
 * A recovery = a user climbing from a lapsed stage back to an active stage whose
 * engagement rank is >= the lapsed stage's counterpart rank. Engagement order is
 * mau(1) < wau(2) < dau4(3). `new` is never a recovery target.
 */

const ACTIVE_RANK: Record<string, number> = { mau: 1, wau: 2, dau4: 3 };
const LAPSED_COUNTERPART_RANK: Record<string, number> = {
  lapsed_mau: 1,
  lapsed_wau: 2,
  lapsed_dau4: 3,
};

/** True when `from` is a lapsed stage and `to` is an active stage at least as engaged as the pre-lapse tier. */
export function isRecovery(from: string, to: string): boolean {
  const counterpart = LAPSED_COUNTERPART_RANK[from];
  const reached = ACTIVE_RANK[to];
  if (counterpart === undefined || reached === undefined) return false;
  return reached >= counterpart;
}

/** Reached active engagement rank (1=mau, 2=wau, 3=dau4); 0 for non-active stages. */
export function recoveryRank(to: string): number {
  return ACTIVE_RANK[to] ?? 0;
}
