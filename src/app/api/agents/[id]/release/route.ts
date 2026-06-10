import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: { released: number } } | { error: string }>> {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let userId: string | undefined;
  try {
    const text = await req.text();
    if (text.trim()) {
      const body = JSON.parse(text) as { userId?: unknown };
      if (body.userId !== undefined) {
        if (typeof body.userId !== "string" || !body.userId.trim()) {
          return fail("userId must be a non-empty string", 400);
        }
        userId = body.userId.trim();
      }
    }
  } catch {
    return fail("Invalid JSON body", 400);
  }

  try {
    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) return fail("Agent not found", 404);

    // Clear the user lock alongside the release — eligibility queries require
    // lockedByAgentId null/own, so a retained lock would keep the released user
    // out of every other agent's pool forever.
    const [result] = await prisma.$transaction([
      prisma.userAgentAssignment.updateMany({
        where: {
          agentId: id,
          releasedAt: null,
          ...(userId ? { externalUserId: userId } : {}),
        },
        data: { releasedAt: new Date(), releaseReason: "manual" },
      }),
      prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id, ...(userId ? { externalId: userId } : {}) },
        data: { lockedByAgentId: null },
      }),
    ]);
    return ok({ released: result.count });
  } catch (err) {
    return handleRouteError(`POST /api/agents/${id}/release`, err);
  }
}
