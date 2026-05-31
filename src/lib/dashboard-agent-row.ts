/**
 * Decides what the dashboard Agents sidebar shows on the right of each row:
 * a "Draft" badge or a sends count. The badge must follow the agent's real
 * `status`, NOT whether it has sends yet — an active agent that hasn't sent
 * anything is still active, not a draft.
 */
export type AgentRowBadge = { kind: "draft" } | { kind: "sends"; decisions: number };

export function agentRowBadge(status: string, decisions: number): AgentRowBadge {
  return status === "draft" ? { kind: "draft" } : { kind: "sends", decisions };
}
