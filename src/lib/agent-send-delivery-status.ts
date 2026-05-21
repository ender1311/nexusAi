/**
 * Braze delivery status for an agent send row (UserDecision + FailedBrazeSend).
 *
 * - failed: recorded in FailedBrazeSend (Braze HTTP error path).
 * - pending: scheduled delivery is still in the future (Braze schedule created or queued).
 * - delivered: not failed — Braze accepted the request (immediate send 200 or schedule created).
 */
export type AgentSendDeliveryStatus = "failed" | "pending" | "delivered";

type Row = {
  failed: boolean;
  scheduledFor: string | null;
  decisionContext?: unknown;
};

// 12 hours in ms — max offset between UTC anchor and latest local delivery (UTC-12 timezone).
const LOCAL_TIME_DELIVERY_BUFFER_MS = 12 * 60 * 60 * 1000;

export function getAgentSendDeliveryStatus(row: Row, nowMs: number): AgentSendDeliveryStatus {
  if (row.failed) return "failed";
  if (row.scheduledFor) {
    const scheduledMs = Date.parse(row.scheduledFor);
    const ctx = row.decisionContext as { inLocalTime?: boolean } | null | undefined;
    // For in_local_time=true sends, scheduledFor is a UTC date anchor (e.g. 8am UTC), but
    // Braze delivers at 8am local to each user — up to 12h later for UTC-12 users.
    const effectiveDeadline = ctx?.inLocalTime ? scheduledMs + LOCAL_TIME_DELIVERY_BUFFER_MS : scheduledMs;
    if (effectiveDeadline > nowMs) return "pending";
  }
  return "delivered";
}
