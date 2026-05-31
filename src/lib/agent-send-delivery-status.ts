/**
 * Braze delivery status for an agent send row (UserDecision + FailedBrazeSend).
 *
 * - failed: recorded in FailedBrazeSend (Braze HTTP error path).
 * - pending: scheduled delivery is still in the future (Braze schedule created or queued).
 * - delivered: not failed — Braze accepted the request (immediate send 200 or schedule created).
 */
import { effectiveDeliveryDeadlineMs } from "@/lib/agent-sends/pending-deadline";

export type AgentSendDeliveryStatus = "failed" | "pending" | "delivered";

type Row = {
  failed: boolean;
  scheduledFor: string | null;
  decisionContext?: unknown;
};

export function getAgentSendDeliveryStatus(row: Row, nowMs: number): AgentSendDeliveryStatus {
  if (row.failed) return "failed";
  if (row.scheduledFor) {
    const ctx = row.decisionContext as { inLocalTime?: boolean } | null | undefined;
    if (effectiveDeliveryDeadlineMs(row.scheduledFor, ctx?.inLocalTime) > nowMs) return "pending";
  }
  return "delivered";
}
