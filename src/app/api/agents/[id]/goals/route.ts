import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goals = await prisma.goal.findMany({ where: { agentId: id } });
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const goal = await prisma.goal.create({
    data: {
      agentId: id,
      eventName: body.eventName,
      tier: body.tier,
      valueWeight: body.valueWeight ?? 1.0,
      weightMode: body.weightMode ?? "fixed",
      weightProperty: body.weightProperty ?? null,
      weightDefault: body.weightDefault ?? 1.0,
      description: body.description,
    },
  });
  return NextResponse.json(goal, { status: 201 });
}

/**
 * PUT /api/agents/[id]/goals
 * Replace all goals for an agent (delete + recreate pattern).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Expected array of goals" }, { status: 400 });
  }

  await prisma.goal.deleteMany({ where: { agentId: id } });

  if (body.length > 0) {
    await prisma.goal.createMany({
      data: body.map((g: {
        eventName: string;
        tier: string;
        valueWeight?: number;
        weightMode?: string;
        weightProperty?: string | null;
        weightDefault?: number;
        description?: string | null;
      }) => ({
        agentId: id,
        eventName: g.eventName,
        tier: g.tier,
        valueWeight: g.valueWeight ?? 1.0,
        weightMode: g.weightMode ?? "fixed",
        weightProperty: g.weightProperty ?? null,
        weightDefault: g.weightDefault ?? 1.0,
        description: g.description ?? null,
      })),
    });
  }

  const goals = await prisma.goal.findMany({ where: { agentId: id } });
  return NextResponse.json(goals);
}
