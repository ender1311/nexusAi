import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/types/agent";
import { isPlainObject } from "@/lib/utils";
import { requireAdmin } from "@/lib/auth";
import { fail, handleRouteError } from "@/lib/api/respond";

const VALID_STAGES = new Set(FUNNEL_STAGES);
const VALID_STATUSES = new Set(["draft", "active", "paused"]);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        goals: true,
        messages: { include: { variants: true } },
        schedulingRule: true,
        _count: { select: { decisions: true } },
      },
    });
    if (!agent) return fail("Not found", 404);
    const res = NextResponse.json(agent);
    res.headers.set("Cache-Control", "private, max-age=30");
    return res;
  } catch (err) {
    return handleRouteError(`GET /api/agents/${id}`, err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  try {
    if (body.funnelStage !== undefined && !VALID_STAGES.has(body.funnelStage)) {
      return fail("Invalid funnelStage", 400);
    }

    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return fail("Invalid status", 400);
    }

    if (body.targetFilter !== undefined && body.targetFilter !== null && !isPlainObject(body.targetFilter)) {
      return fail("targetFilter must be a plain object", 400);
    }

    if (body.fallbackSendHour !== undefined) {
      if (
        body.fallbackSendHour !== null &&
        (!Number.isInteger(body.fallbackSendHour) ||
          body.fallbackSendHour < 0 ||
          body.fallbackSendHour > 23)
      ) {
        return fail("fallbackSendHour must be null or an integer 0–23", 400);
      }
    }

    if (body.dailySendCap !== undefined) {
      if (body.dailySendCap !== null && (!Number.isInteger(body.dailySendCap) || body.dailySendCap < 1)) {
        return fail("dailySendCap must be null or a positive integer", 400);
      }
    }

    if (body.languageFilter !== undefined && body.languageFilter !== null) {
      if (typeof body.languageFilter !== "string" || body.languageFilter.trim() === "") {
        return fail("languageFilter must be a non-empty string or null", 400);
      }
    }

    if (body.localizePush !== undefined && typeof body.localizePush !== "boolean") {
      return fail("localizePush must be a boolean", 400);
    }

    if (body.deeplinkOverride !== undefined && body.deeplinkOverride !== null) {
      if (typeof body.deeplinkOverride !== "string" || body.deeplinkOverride.trim().length === 0) {
        return fail("deeplinkOverride must be null or a non-empty string", 400);
      }
    }

    if (body.sendingPaused !== undefined && typeof body.sendingPaused !== "boolean") {
      return fail("Invalid sendingPaused", 400);
    }

    if (body.color !== undefined) {
      if (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        return fail("color must be a 6-digit hex value", 400);
      }
    }

    if (body.targetSegmentName !== undefined && body.targetSegmentName !== null) {
      if (typeof body.targetSegmentName !== "string" || body.targetSegmentName.trim().length === 0) {
        return fail("targetSegmentName must be null or a non-empty string", 400);
      }
      const trimmed = body.targetSegmentName.trim();
      const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: trimmed, id: { not: id } }, select: { name: true } });
      if (conflict) {
        return fail(`Segment "${trimmed}" is already assigned to agent "${conflict.name}"`, 409);
      }
    }

    if (body.segmentTargeting !== undefined && body.segmentTargeting !== null) {
      if (
        typeof body.segmentTargeting !== "object" ||
        Array.isArray(body.segmentTargeting) ||
        !Array.isArray(body.segmentTargeting.includes) ||
        !Array.isArray(body.segmentTargeting.excludes) ||
        body.segmentTargeting.includes.some((s: unknown) => typeof s !== "string" || !s.trim()) ||
        body.segmentTargeting.excludes.some((s: unknown) => typeof s !== "string" || !s.trim())
      ) {
        return fail(
          "segmentTargeting must be null or { includes: string[], excludes: string[] } with non-empty strings",
          400,
        );
      }
      const overlap = body.segmentTargeting.includes.filter((s: string) =>
        body.segmentTargeting.excludes.includes(s)
      );
      if (overlap.length > 0) {
        return fail(`Segment(s) cannot appear in both includes and excludes: ${overlap.join(", ")}`, 400);
      }
    }

    // Release user locks when agent is stopped, paused, or targeting criteria change.
    // The cohort is tied to those locks, so also release this agent's active
    // assignments and clear cohortAssignedAt → it re-materializes a fresh cohort
    // on the next active cron tick.
    const releasesCohort =
      body.status === "paused" ||
      body.status === "draft" ||
      body.targetSegmentName !== undefined ||
      body.funnelStage !== undefined ||
      body.segmentTargeting !== undefined;
    if (releasesCohort) {
      await prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id },
        data:  { lockedByAgentId: null },
      });
      await prisma.userAgentAssignment.updateMany({
        where: { agentId: id, releasedAt: null },
        data:  { releasedAt: new Date(), releaseReason: "manual" },
      });
    }

    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        status: body.status,
        algorithm: body.algorithm,
        epsilon: body.epsilon,
        ...(body.funnelStage !== undefined ? { funnelStage: body.funnelStage } : {}),
        ...(body.targetFilter !== undefined ? { targetFilter: body.targetFilter } : {}),
        ...(body.fallbackSendHour !== undefined ? { fallbackSendHour: body.fallbackSendHour } : {}),
        ...(body.dailySendCap !== undefined ? { dailySendCap: body.dailySendCap } : {}),
        ...(body.languageFilter !== undefined ? { languageFilter: body.languageFilter } : {}),
        ...(body.localizePush !== undefined ? { localizePush: body.localizePush } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.targetSegmentName !== undefined ? { targetSegmentName: typeof body.targetSegmentName === "string" ? body.targetSegmentName.trim() : null } : {}),
        ...(body.segmentTargeting !== undefined ? {
          segmentTargeting: body.segmentTargeting === null
            ? body.segmentTargeting
            : { includes: body.segmentTargeting.includes.map((s: string) => s.trim()), excludes: body.segmentTargeting.excludes.map((s: string) => s.trim()) },
        } : {}),
        ...(body.deeplinkOverride !== undefined ? { deeplinkOverride: typeof body.deeplinkOverride === "string" ? body.deeplinkOverride.trim() : null } : {}),
        ...(body.sendingPaused !== undefined ? { sendingPaused: body.sendingPaused } : {}),
        ...(releasesCohort ? { cohortAssignedAt: null } : {}),
      },
    });
    revalidatePath(`/agents/${id}`);
    revalidatePath("/agents");
    revalidateTag(`agent-${id}`, "max");
    revalidateTag("agents", "max");
    revalidateTag("performance", "max"); // status change affects performance page
    return NextResponse.json(agent);
  } catch (err) {
    return handleRouteError(`PATCH /api/agents/${id}`, err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    // All writes run atomically: the agent.delete cascades FK-linked children, but
    // bandit arm state, the failed-send log, and per-user assignments key on agentId
    // with NO foreign key and must be cleared explicitly. If the process dies between
    // statements outside a transaction, those rows orphan and skew fleet-wide stats.
    await prisma.$transaction([
      prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id },
        data:  { lockedByAgentId: null },
      }),
      // Deleting the agent cascades goals, messages/variants, decisions, scheduling
      // rule, metrics, and persona targets via FK ON DELETE CASCADE.
      prisma.agent.delete({ where: { id } }),
      prisma.personaArmStats.deleteMany({ where: { agentId: id } }),
      prisma.userArmStats.deleteMany({ where: { agentId: id } }),
      prisma.linUCBArm.deleteMany({ where: { agentId: id } }),
      prisma.failedBrazeSend.deleteMany({ where: { agentId: id } }),
      prisma.userAgentAssignment.deleteMany({ where: { agentId: id } }),
    ]);
    revalidatePath("/agents");
    revalidateTag(`agent-${id}`, "max");
    revalidateTag("agents", "max");
    revalidateTag("performance", "max");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(`DELETE /api/agents/${id}`, err);
  }
}
