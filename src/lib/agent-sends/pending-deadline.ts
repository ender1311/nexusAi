import type { SendRow } from "./types";

// 12 hours in ms — the max offset between the UTC schedule anchor and the latest
// possible local delivery (a UTC-12 recipient). When Braze sends in_local_time,
// scheduledFor is a UTC date anchor (e.g. 8am UTC) but each user receives it at
// 8am *their* local time, so the true delivery window extends up to 12h past the anchor.
export const LOCAL_TIME_DELIVERY_BUFFER_MS = 12 * 60 * 60 * 1000;

/** The effective wall-clock ms by which a scheduled send is considered delivered. */
export function effectiveDeliveryDeadlineMs(
  scheduledFor: string,
  inLocalTime: boolean | undefined,
): number {
  const scheduledMs = Date.parse(scheduledFor);
  return inLocalTime ? scheduledMs + LOCAL_TIME_DELIVERY_BUFFER_MS : scheduledMs;
}

/** True when the row has a future-dated delivery (still pending, not yet sent). */
export function isPendingDelivery(
  row: Pick<SendRow, "scheduledFor" | "decisionContext">,
  nowMs: number,
): boolean {
  if (!row.scheduledFor) return false;
  return effectiveDeliveryDeadlineMs(row.scheduledFor, row.decisionContext?.inLocalTime) > nowMs;
}
