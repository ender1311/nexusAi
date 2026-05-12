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
};

export function getAgentSendDeliveryStatus(row: Row, nowMs: number): AgentSendDeliveryStatus {
  if (row.failed) return "failed";
  if (row.scheduledFor && Date.parse(row.scheduledFor) > nowMs) return "pending";
  return "delivered";
}
