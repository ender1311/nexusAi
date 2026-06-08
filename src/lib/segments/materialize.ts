import { parseSegmentTargeting } from "@/lib/agent-targeting";

type AgentTargetingFields = {
  segmentTargeting: unknown;
  targetSegmentName: string | null;
};

/** Deduped set of every segment name referenced by any agent (includes, excludes,
 *  and the legacy single-include `targetSegmentName`). Corrupt targeting JSON
 *  degrades to "no names" via the tolerant parser. */
export function collectReferencedSegmentNames(agents: AgentTargetingFields[]): Set<string> {
  const names = new Set<string>();
  for (const agent of agents) {
    const targeting = parseSegmentTargeting(agent.segmentTargeting);
    if (targeting) {
      for (const n of targeting.includes) names.add(n);
      for (const n of targeting.excludes) names.add(n);
    }
    if (agent.targetSegmentName) names.add(agent.targetSegmentName);
  }
  return names;
}
