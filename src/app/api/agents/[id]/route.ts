import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/types/agent";
import { isPlainObject } from "@/lib/utils";
import { requireAdmin } from "@/lib/auth";

const VALID_STAGES = new Set(FUNNEL_STAGES);

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

    if (body.targetFilter !== undefined && !isPlainObject(body.targetFilter)) {
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

    if (body.uniqueUsersCap !== undefined) {
      if (body.uniqueUsersCap !== null && (!Number.isInteger(body.uniqueUsersCap) || body.uniqueUsersCap < 1)) {
        return NextResponse.json({ error: "uniqueUsersCap must be null or a positive integer" }, { status: 400 });
      }
    }

    if (body.languageFilter !== undefined) {
      if (typeof body.languageFilter !== "string" || body.languageFilter.trim() === "") {
        return NextResponse.json({ error: "languageFilter must be a non-empty string" }, { status: 400 });
      }
    }

    if (body.color !== undefined) {
      if (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color)) {
        return NextResponse.json({ error: "color must be a 6-digit hex value" }, { status: 400 });
      }
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
        ...(body.uniqueUsersCap !== undefined ? { uniqueUsersCap: body.uniqueUsersCap } : {}),
        ...(body.languageFilter !== undefined ? { languageFilter: body.languageFilter } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
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
