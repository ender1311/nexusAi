/**
 * Prod diagnostic: compare agents' caps, personas, overlap, today's sends.
 * Usage: bun scripts/trace-agent-send-gates.ts Neo Morpheus
 */
import { prisma } from "@/lib/db";

const names = process.argv.slice(2);
if (names.length < 2) {
  console.error("Usage: bun scripts/trace-agent-send-gates.ts <agentA> <agentB>");
  process.exit(1);
}

function todayStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function main() {
  const agents = await prisma.agent.findMany({
    where: { name: { in: names, mode: "insensitive" } },
    include: {
      personaTargets: { include: { persona: { select: { id: true, name: true } } } },
      schedulingRule: true,
      _count: { select: { decisions: true } },
    },
  });

  if (agents.length !== names.length) {
    const found = new Set(agents.map((a) => a.name.toLowerCase()));
    const missing = names.filter((n) => !found.has(n.toLowerCase()));
    console.error("Missing agents:", missing.join(", "));
    process.exit(1);
  }

  const todayStart = todayStartUtc();
  const ids = agents.map((a) => a.id);
  const [a, b] = agents;

  const [
    sentTodayRows,
    uniqueUsersRows,
    lockedRows,
    activeAssignmentRows,
    sentTodayDistinctUsers,
  ] = await Promise.all([
    prisma.userDecision.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: ids },
        sentAt: { gte: todayStart },
        brazeSendId: { not: null },
      },
      _count: { id: true },
    }),
    prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
      SELECT "agentId", COUNT(DISTINCT "userId")::bigint AS cnt
      FROM "UserDecision"
      WHERE "agentId" = ANY(${ids}::text[])
      GROUP BY "agentId"
    `,
    prisma.trackedUser.groupBy({
      by: ["lockedByAgentId"],
      where: { lockedByAgentId: { in: ids } },
      _count: { id: true },
    }),
    prisma.userAgentAssignment.groupBy({
      by: ["agentId"],
      where: { agentId: { in: ids }, releasedAt: null },
      _count: { id: true },
    }),
    prisma.$queryRaw<Array<{ agentId: string; cnt: bigint }>>`
      SELECT "agentId", COUNT(DISTINCT "userId")::bigint AS cnt
      FROM "UserDecision"
      WHERE "agentId" = ANY(${ids}::text[])
        AND "sentAt" >= ${todayStart}
        AND "brazeSendId" IS NOT NULL
      GROUP BY "agentId"
    `,
  ]);

  // Segment sizes (fast — UserSegment is smaller than TrackedUser)
  async function segmentSize(segmentName: string | null): Promise<number | null> {
    if (!segmentName) return null;
    return prisma.userSegment.count({ where: { segmentName } });
  }

  const segmentCounts = await Promise.all(
    agents.map(async (agent) => {
      const seg = agent.segmentTargeting as { includes?: string[]; excludes?: string[] } | null;
      const includes = seg?.includes?.length
        ? seg.includes
        : agent.targetSegmentName
          ? [agent.targetSegmentName]
          : [];
      const sizes: Record<string, number> = {};
      for (const s of includes) sizes[s] = await prisma.userSegment.count({ where: { segmentName: s } });
      return { agentId: agent.id, includes, sizes };
    }),
  );

  // Overlap: users both agents have ever sent to (competition proxy)
  const overlapSentUsers = await prisma.$queryRaw<[{ cnt: bigint }]>`
    SELECT COUNT(*)::bigint AS cnt FROM (
      SELECT "userId" FROM "UserDecision" WHERE "agentId" = ${a.id}
      INTERSECT
      SELECT "userId" FROM "UserDecision" WHERE "agentId" = ${b.id}
    ) t
  `;

  const sentTodayByAgent = new Map(sentTodayRows.map((r) => [r.agentId, r._count.id]));
  const sentTodayUsersByAgent = new Map(
    sentTodayDistinctUsers.map((r) => [r.agentId, Number(r.cnt)]),
  );
  const uniqueByAgent = new Map(uniqueUsersRows.map((r) => [r.agentId, Number(r.cnt)]));
  const lockedByAgent = new Map(lockedRows.map((r) => [r.lockedByAgentId!, r._count.id]));
  const activeAssignByAgent = new Map(
    activeAssignmentRows.map((r) => [r.agentId, r._count.id]),
  );

  const personaIdsA = new Set(a.personaTargets.map((pt) => pt.personaId));
  const personaIdsB = new Set(b.personaTargets.map((pt) => pt.personaId));
  const sharedPersonas = a.personaTargets.filter((pt) => personaIdsB.has(pt.personaId));

  console.log("\n=== Agent config ===\n");
  for (const agent of agents) {
    const seg = segmentCounts.find((s) => s.agentId === agent.id)!;
    console.log(`--- ${agent.name} (${agent.id}) ---`);
    console.log(
      JSON.stringify(
        {
          status: agent.status,
          funnelStage: agent.funnelStage,
          targetSegmentName: agent.targetSegmentName,
          segmentTargeting: agent.segmentTargeting,
          segmentIncludeSizes: seg.sizes,
          dailySendCap: agent.dailySendCap,
          uniqueUsersCap: agent.uniqueUsersCap,
          staleFunnelStageDays: agent.staleFunnelStageDays,
          languageFilter: agent.languageFilter,
          localizePush: agent.localizePush,
          personas: agent.personaTargets.map((pt) => pt.persona.name),
          algorithm: agent.algorithm,
          lifetimeDecisions: agent._count.decisions,
          lifetimeUniqueUsers: uniqueByAgent.get(agent.id) ?? 0,
          sentTodayConfirmed: sentTodayByAgent.get(agent.id) ?? 0,
          sentTodayDistinctUsers: sentTodayUsersByAgent.get(agent.id) ?? 0,
          dailyCapRemaining:
            agent.dailySendCap != null
              ? Math.max(0, agent.dailySendCap - (sentTodayByAgent.get(agent.id) ?? 0))
              : null,
          lockedUsers: lockedByAgent.get(agent.id) ?? 0,
          activeAssignments: activeAssignByAgent.get(agent.id) ?? 0,
          scheduling: agent.schedulingRule
            ? {
                frequencyCap: agent.schedulingRule.frequencyCap,
                prioritizeLastSeen: agent.schedulingRule.prioritizeLastSeen,
                smartSuppress: agent.schedulingRule.smartSuppress,
              }
            : null,
          fallbackSendHour: agent.fallbackSendHour,
        },
        null,
        2,
      ),
    );
    console.log("");
  }

  console.log("=== Neo vs Morpheus overlap ===\n");
  console.log(
    JSON.stringify(
      {
        sharedPersonas: sharedPersonas.map((pt) => pt.persona.name),
        sameFunnelStage: a.funnelStage === b.funnelStage,
        usersEverTouchedByBothAgents: Number(overlapSentUsers[0]?.cnt ?? 0),
      },
      null,
      2,
    ),
  );

  console.log("\n=== Binding gate (today UTC since", todayStart.toISOString(), ") ===\n");
  for (const agent of agents) {
    const sentToday = sentTodayByAgent.get(agent.id) ?? 0;
    const sentTodayUsers = sentTodayUsersByAgent.get(agent.id) ?? 0;
    const cap = agent.dailySendCap;
    const unique = uniqueByAgent.get(agent.id) ?? 0;
    const locked = lockedByAgent.get(agent.id) ?? 0;
    const gates: string[] = [];

    if (agent.status !== "active") gates.push(`BINDING: status=${agent.status}`);
    if (cap != null && sentToday >= cap)
      gates.push(`BINDING: dailySendCap reached (${sentToday}/${cap})`);
    else if (cap != null)
      gates.push(`NOT binding: dailySendCap headroom ${cap - sentToday} (${sentToday}/${cap})`);

    if (agent.uniqueUsersCap != null && unique >= agent.uniqueUsersCap)
      gates.push(`BINDING: uniqueUsersCap (${unique}/${agent.uniqueUsersCap})`);
    else if (agent.uniqueUsersCap != null)
      gates.push(`NOT binding: uniqueUsersCap (${unique}/${agent.uniqueUsersCap})`);

    if (unique < (cap ?? 500))
      gates.push(
        `SUPPLY: only ${unique} lifetime unique users — global 1-push/user/day caps daily max near ${unique}`,
      );

    if (sentTodayUsers < sentToday)
      gates.push(`note: ${sentToday - sentTodayUsers} duplicate-user sends today (unusual)`);

    const other = agent.id === a.id ? b : a;
    const otherLocked = lockedByAgent.get(other.id) ?? 0;
    if (a.funnelStage === b.funnelStage && sharedPersonas.length > 0)
      gates.push(
        `COMPETITION: shares ${sharedPersonas.length} persona(s) + funnel ${agent.funnelStage} with ${other.name}; ${other.name} locks ${otherLocked} users vs this agent ${locked}`,
      );

    console.log(`${agent.name}:\n  ${gates.join("\n  ")}\n`);
  }

  const lastCron = await prisma.cronRun.findFirst({
    orderBy: { startedAt: "desc" },
  });
  if (lastCron) {
    console.log("=== Latest CronRun ===\n", {
      startedAt: lastCron.startedAt,
      sent: lastCron.sent,
      suppressed: lastCron.suppressed,
      errors: lastCron.errors,
      agentCount: lastCron.agentCount,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
