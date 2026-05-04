import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  variantId: string | null;
  variantName: string | null;
  variantBody: string;
  brazeSendId: string | null;
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

    const decisions = await prisma.userDecision.findMany({
      where: { agentId: id },
      include: { variant: { select: { id: true, name: true, body: true } } },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: limit,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const rows: SendRow[] = decisions.map((d) => ({
      id: d.id,
      userId: d.userId,
      channel: d.channel,
      sentAt: d.sentAt.toISOString(),
      scheduledFor: d.scheduledFor ? d.scheduledFor.toISOString() : null,
      variantId: d.variant?.id ?? null,
      variantName: d.variant?.name ?? null,
      variantBody: d.variant?.body ?? "",
      brazeSendId: d.brazeSendId ?? null,
    }));

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error(`GET /api/agents/${id}/sends error:`, error);
    return NextResponse.json({ error: "Failed to fetch sends" }, { status: 500 });
  }
}
