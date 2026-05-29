import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/types/agent";
import { isPlainObject } from "@/lib/utils";
import { requireAdmin } from "@/lib/auth";

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
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const res = NextResponse.json(agent);
    res.headers.set("Cache-Control", "private, max-age=30");
    return res;
  } catch (error) {
    console.error(`GET /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const body = await req.json();

    if (body.funnelStage !== undefined && !VALID_STAGES.has(body.funnelStage)) {
      return NextResponse.json({ error: "Invalid funnelStage" }, { status: 400 });
    }

    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    if (body.targetFilter !== undefined && body.targetFilter !== null && !isPlainObject(body.targetFilter)) {
      return NextResponse.json({ error: "targetFilter must be a plain object" }, { status: 400 });
    }

    if (body.fallbackSendHour !== undefined) {
      if (
        body.fallbackSendHour !== null &&
        (!Number.isInteger(body.fallbackSendHour) ||
          body.fallbackSendHour < 0 ||
          body.fallbackSendHour > 23)
      ) {
        return NextResponse.json(
          { error: "fallbackSendHour must be null or an integer 0–23" },
          { status: 400 },
        );
      }
    }

    if (body.audienceCap !== undefined) {
      if (body.audienceCap !== null && (!Number.isInteger(body.audienceCap) || body.audienceCap < 1)) {
        return NextResponse.json({ error: "audienceCap must be null or a positive integer" }, { status: 400 });
      }
    }

    if (body.dailySendCap !== undefined) {
      if (body.dailySendCap !== null && (!Number.isInteger(body.dailySendCap) || body.dailySendCap < 1)) {
        return NextResponse.json({ error: "dailySendCap must be null or a positive integer" }, { status: 400 });
      }
    }

    if (body.languageFilter !== undefined && body.languageFilter !== null) {
      if (typeof body.languageFilter !== "string" || body.languageFilter.trim() === "") {
        return NextResponse.json({ error: "languageFilter must be a non-empty string or null" }, { status: 400 });
      }
    }

    if (body.color !== undefined) {
      if (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        return NextResponse.json({ error: "color must be a 6-digit hex value" }, { status: 400 });
      }
    }

    if (body.targetSegmentName !== undefined && body.targetSegmentName !== null) {
      if (typeof body.targetSegmentName !== "string" || body.targetSegmentName.trim().length === 0) {
        return NextResponse.json({ error: "targetSegmentName must be null or a non-empty string" }, { status: 400 });
      }
      const trimmed = body.targetSegmentName.trim();
      const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: trimmed, id: { not: id } }, select: { name: true } });
      if (conflict) {
        return NextResponse.json({ error: `Segment "${trimmed}" is already assigned to agent "${conflict.name}"` }, { status: 409 });
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
        return NextResponse.json(
          { error: "segmentTargeting must be null or { includes: string[], excludes: string[] } with non-empty strings" },
          { status: 400 },
        );
      }
      const overlap = body.segmentTargeting.includes.filter((s: string) =>
        body.segmentTargeting.excludes.includes(s)
      );
      if (overlap.length > 0) {
        return NextResponse.json(
          { error: `Segment(s) cannot appear in both includes and excludes: ${overlap.join(", ")}` },
          { status: 400 },
        );
      }
    }

    // Release user locks when agent is stopped, paused, or targeting criteria change
    if (body.status === "paused" || body.status === "draft" || body.targetSegmentName !== undefined || body.funnelStage !== undefined || body.segmentTargeting !== undefined) {
      await prisma.trackedUser.updateMany({
        where: { lockedByAgentId: id },
        data:  { lockedByAgentId: null },
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
        ...(body.audienceCap !== undefined ? { audienceCap: body.audienceCap } : {}),
        ...(body.dailySendCap !== undefined ? { dailySendCap: body.dailySendCap } : {}),
        ...(body.languageFilter !== undefined ? { languageFilter: body.languageFilter } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.targetSegmentName !== undefined ? { targetSegmentName: typeof body.targetSegmentName === "string" ? body.targetSegmentName.trim() : null } : {}),
        ...(body.segmentTargeting !== undefined ? {
          segmentTargeting: body.segmentTargeting === null
            ? body.segmentTargeting
            : { includes: body.segmentTargeting.includes.map((s: string) => s.trim()), excludes: body.segmentTargeting.excludes.map((s: string) => s.trim()) },
        } : {}),
      },
    });
    revalidatePath(`/agents/${id}`);
    revalidatePath("/agents");
    revalidateTag(`agent-${id}`, "max");
    revalidateTag("agents", "max");
    revalidateTag("performance", "max"); // status change affects performance page
    return NextResponse.json(agent);
  } catch (error) {
    console.error(`PATCH /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    await prisma.trackedUser.updateMany({
      where: { lockedByAgentId: id },
      data:  { lockedByAgentId: null },
    });
    await prisma.agent.delete({ where: { id } });
    revalidatePath("/agents");
    revalidateTag(`agent-${id}`, "max");
    revalidateTag("agents", "max");
    revalidateTag("performance", "max");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`DELETE /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
