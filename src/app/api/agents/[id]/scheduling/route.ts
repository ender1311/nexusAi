import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

/** Lean GET — returns only what the scheduling UI needs (name + rule).
 *  Avoids fetching the full agent payload (messages, variants, goals). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        name: true,
        schedulingRule: true,
      },
    });
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(agent);
  } catch (error) {
    console.error(`GET /api/agents/${id}/scheduling error:`, error);
    return NextResponse.json({ error: "Failed to fetch scheduling" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { frequencyCap, quietHours, blackoutDates, smartSuppress, suppressThresh, prioritizeLastSeen } = body;

    if (
      !frequencyCap ||
      typeof frequencyCap.maxSends !== "number" ||
      frequencyCap.maxSends < 1 ||
      !["day", "week", "biweek", "month"].includes(frequencyCap.period)
    ) {
      return NextResponse.json({ error: "Invalid frequencyCap" }, { status: 400 });
    }

    if (!quietHours || !["none", "suppress", "schedule"].includes(quietHours.mode)) {
      return NextResponse.json({ error: "quietHours.mode must be none | suppress | schedule" }, { status: 400 });
    }
    if (quietHours.mode === "suppress" && (typeof quietHours.start !== "string" || typeof quietHours.end !== "string" || typeof quietHours.timezone !== "string")) {
      return NextResponse.json({ error: "quietHours suppress mode requires start, end, timezone" }, { status: 400 });
    }
    if (quietHours.mode === "schedule" && (typeof quietHours.deliverAtHour !== "number" || quietHours.deliverAtHour < 0 || quietHours.deliverAtHour > 23)) {
      return NextResponse.json({ error: "quietHours schedule mode requires deliverAtHour 0–23" }, { status: 400 });
    }

    if (!Array.isArray(blackoutDates)) {
      return NextResponse.json({ error: "blackoutDates must be an array" }, { status: 400 });
    }

    if (typeof suppressThresh !== "number" || suppressThresh < 0 || suppressThresh > 1) {
      return NextResponse.json({ error: "suppressThresh must be 0–1" }, { status: 400 });
    }

    const agent = await prisma.agent.findUnique({ where: { id }, select: { id: true } });
    if (!agent) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const rule = await prisma.schedulingRule.upsert({
      where: { agentId: id },
      create: {
        agentId: id,
        frequencyCap,
        quietHours,
        blackoutDates,
        smartSuppress: smartSuppress ?? false,
        suppressThresh: suppressThresh ?? 0.5,
        prioritizeLastSeen: prioritizeLastSeen ?? true,
      },
      update: {
        frequencyCap,
        quietHours,
        blackoutDates,
        smartSuppress: smartSuppress ?? false,
        suppressThresh: suppressThresh ?? 0.5,
        prioritizeLastSeen: prioritizeLastSeen ?? true,
      },
    });

    revalidatePath(`/agents/${id}`);
    revalidateTag(`agent-${id}`, "max");
    return NextResponse.json(rule);
  } catch (error) {
    console.error(`PUT /api/agents/${id}/scheduling error:`, error);
    return NextResponse.json({ error: "Failed to save scheduling rules" }, { status: 500 });
  }
}
