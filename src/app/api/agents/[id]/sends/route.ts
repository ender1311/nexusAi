import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { SendRow, SendRowContext } from "@/lib/agent-sends/types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: SendRow[] }> | NextResponse<{ error: string }>> {
  const { id } = await params;

  try {
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = searchParams.get("limit");
    const limit = rawLimit
      ? Math.min(Math.max(1, parseInt(rawLimit, 10) || DEFAULT_LIMIT), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const rawStatus = searchParams.get("status") ?? "all";
    const statusFilter = ["all", "success", "failed", "converted", "pending"].includes(rawStatus)
      ? (rawStatus as "all" | "success" | "failed" | "converted" | "pending")
      : "all";
    const rawChannel = searchParams.get("channel") ?? "all";
    const channelFilter = rawChannel !== "all" && rawChannel.length > 0 ? rawChannel : "all";

    const failedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    // For status=failed or status=success we need failed IDs first (sequential),
    // so we can use them in the UserDecision where clause.
    // For status=all and status=converted, keep the parallel approach.
    let preloadedFailedIds: Set<string> | null = null;
    if (statusFilter === "failed" || statusFilter === "success") {
      const failedSendRecords = await prisma.failedBrazeSend.findMany({
        where: { agentId: id, failedAt: { gte: failedCutoff } },
        select: { decisionIds: true },
      });
      preloadedFailedIds = new Set<string>();
      for (const f of failedSendRecords) {
        for (const did of f.decisionIds as string[]) {
          preloadedFailedIds.add(did);
        }
      }

      // No failures means no results for status=failed
      if (statusFilter === "failed" && preloadedFailedIds.size === 0) {
        return NextResponse.json({ data: [] });
      }
    }

    // Build additional where clause conditions based on filters
    type WhereExtra = {
      id?: { in: string[] } | { notIn: string[] };
      channel?: string;
      conversionAt?: { not: null };
      scheduledFor?: { gt: Date } | { lte: Date };
      OR?: Array<{ scheduledFor: null } | { scheduledFor: { lte: Date } }>;
    };
    const whereExtra: WhereExtra = {};

    if (statusFilter === "failed" && preloadedFailedIds !== null) {
      whereExtra.id = { in: [...preloadedFailedIds] };
    } else if (statusFilter === "success" && preloadedFailedIds !== null) {
      if (preloadedFailedIds.size > 0) {
        whereExtra.id = { notIn: [...preloadedFailedIds] };
      }
      whereExtra.OR = [{ scheduledFor: null }, { scheduledFor: { lte: now } }];
    } else if (statusFilter === "converted") {
      whereExtra.conversionAt = { not: null };
    } else if (statusFilter === "pending") {
      whereExtra.scheduledFor = { gt: now };
    }

    if (channelFilter !== "all") {
      whereExtra.channel = channelFilter;
    }

    const [decisions, failedSendRecords] =
      preloadedFailedIds !== null
        ? // Already fetched failures — skip the parallel fetch
          await Promise.all([
            prisma.userDecision.findMany({
              where: { agentId: id, ...whereExtra },
              include: {
                variant: { select: { id: true, name: true, body: true, title: true, deeplink: true } },
              },
              orderBy: [{ sentAt: "desc" }, { id: "desc" }],
              take: limit,
              ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
            Promise.resolve(null),
          ])
        : await Promise.all([
            prisma.userDecision.findMany({
              where: { agentId: id, ...whereExtra },
              include: {
                variant: { select: { id: true, name: true, body: true, title: true, deeplink: true } },
              },
              orderBy: [{ sentAt: "desc" }, { id: "desc" }],
              take: limit,
              ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
            }),
            // Only surface failures from the last 24 h — older records are stale noise.
            // The [agentId, failedAt] index makes this fast.
            prisma.failedBrazeSend.findMany({
              where: { agentId: id, failedAt: { gte: failedCutoff } },
              select: { decisionIds: true },
            }),
          ]);

    // Build set of failed decision IDs from FailedBrazeSend.decisionIds JSON arrays
    const failedDecisionIds: Set<string> = preloadedFailedIds ?? new Set<string>();
    if (failedSendRecords !== null) {
      for (const f of failedSendRecords) {
        for (const did of f.decisionIds as string[]) {
          failedDecisionIds.add(did);
        }
      }
    }

    // Batch-fetch persona info for all unique user IDs in this page
    const uniqueUserIds = [...new Set(decisions.map((d) => d.userId))];
    const trackedUsers = uniqueUserIds.length > 0
      ? await prisma.trackedUser.findMany({
          where: { externalId: { in: uniqueUserIds } },
          select: {
            externalId: true,
            persona: { select: { name: true, color: true } },
          },
        })
      : [];

    const personaByUserId = new Map(
      trackedUsers.map((u) => [u.externalId, u.persona]),
    );

    const rows: SendRow[] = decisions.map((d) => {
      const persona = personaByUserId.get(d.userId) ?? null;
      // When server has filtered to only failed/success rows, we can set failed
      // definitively without re-checking the set for every row.
      const failed =
        statusFilter === "failed"
          ? true
          : statusFilter === "success"
            ? false
            : failedDecisionIds.has(d.id);
      return {
        id: d.id,
        userId: d.userId,
        channel: d.channel,
        sentAt: d.sentAt.toISOString(),
        scheduledFor: d.scheduledFor ? d.scheduledFor.toISOString() : null,
        brazeScheduleId: d.brazeScheduleId ?? null,
        variantId: d.variant?.id ?? null,
        variantName: d.variant?.name ?? null,
        variantTitle: d.variant?.title ?? null,
        variantBody: d.variant?.body ?? "",
        variantDeeplink: d.variant?.deeplink ?? null,
        brazeSendId: d.brazeSendId ?? null,
        personaName: persona?.name ?? null,
        personaColor: persona?.color ?? null,
        conversionAt: d.conversionAt ? d.conversionAt.toISOString() : null,
        reward: d.reward ?? null,
        decisionContext: (d.decisionContext ?? null) as SendRowContext | null,
        failed,
      };
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error(`GET /api/agents/${id}/sends error:`, error);
    return NextResponse.json({ error: "Failed to fetch sends" }, { status: 500 });
  }
}
