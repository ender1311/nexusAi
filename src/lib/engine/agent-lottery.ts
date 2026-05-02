/**
 * Assigns each eligible user to exactly one agent for a single cron run.
 *
 * For users eligible for only one agent: assigned to that agent.
 * For users eligible for multiple agents: randomly assigned to one,
 * producing an approximately uniform distribution across agents.
 *
 * @param eligibleUsersByAgent  Map of agentId → array of externalUserIds
 * @returns                     Map of externalUserId → agentId
 */
export function buildAgentLottery(
  eligibleUsersByAgent: Map<string, string[]>,
): Map<string, string> {
  // Invert: user → list of agents that want them
  const candidatesByUser = new Map<string, string[]>();
  for (const [agentId, userIds] of eligibleUsersByAgent) {
    for (const userId of userIds) {
      const existing = candidatesByUser.get(userId) ?? [];
      existing.push(agentId);
      candidatesByUser.set(userId, existing);
    }
  }

  // Assign each user to one agent at random
  const result = new Map<string, string>();
  for (const [userId, candidates] of candidatesByUser) {
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    result.set(userId, chosen);
  }

  return result;
}
