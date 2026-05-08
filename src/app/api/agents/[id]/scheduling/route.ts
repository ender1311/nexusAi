import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  try {
    const body = await req.json();
    const { frequencyCap, quietHours, blackoutDates, smartSuppress, suppressThresh } = body;

    if (
      !frequencyCap ||
      typeof frequencyCap.maxSends !== "number" ||
      frequencyCap.maxSends < 1 ||
      !["day", "week", "biweek", "month"].includes(frequencyCap.period)
    ) {
      return NextResponse.json({ error: "Invalid frequencyCap" }, { status: 400 });
    }

    if (
      !quietHours ||
      typeof quietHours.start !== "string" ||
      typeof quietHours.end !== "string" ||
      typeof quietHours.timezone !== "string"
    ) {
      return NextResponse.json({ error: "Invalid quietHours" }, { status: 400 });
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
      },
      update: {
        frequencyCap,
        quietHours,
        blackoutDates,
        smartSuppress: smartSuppress ?? false,
        suppressThresh: suppressThresh ?? 0.5,
      },
    });

    return NextResponse.json(rule);
  } catch (error) {
    console.error(`PUT /api/agents/${id}/scheduling error:`, error);
    return NextResponse.json({ error: "Failed to save scheduling rules" }, { status: 500 });
  }
}
