import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  brazeScheduleId: string | null;
  variantId: string | null;
  variantName: string | null;
  variantTitle: string | null;
  variantBody: string;
  variantDeeplink: string | null;
  brazeSendId: string | null;
  personaName: string | null;
  personaColor: string | null;
  conversionAt: string | null;
  reward: number | null;
  decisionContext: unknown | null;
  failed: boolean;
};

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

    const failedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [decisions, failedSendRecords] = await Promise.all([
      prisma.userDecision.findMany({
        where: { agentId: id },
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
    const failedDecisionIds = new Set<string>();
    for (const f of failedSendRecords) {
      for (const did of f.decisionIds as string[]) {
        failedDecisionIds.add(did);
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
        decisionContext: d.decisionContext ?? null,
        failed: failedDecisionIds.has(d.id),
      };
    });

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error(`GET /api/agents/${id}/sends error:`, error);
    return NextResponse.json({ error: "Failed to fetch sends" }, { status: 500 });
  }
}
