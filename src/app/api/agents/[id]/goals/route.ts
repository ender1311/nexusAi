import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const goals = await prisma.goal.findMany({ where: { agentId: id } });
    return NextResponse.json(goals);
  } catch (error) {
    console.error("GET /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to fetch goals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
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
    revalidatePath(`/agents/${id}`);
    revalidateTag(`agent-${id}`, "max");
    return NextResponse.json(goal, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to create goal" }, { status: 500 });
  }
}

/**
 * PUT /api/agents/[id]/goals
 * Replace all goals for an agent (delete + recreate pattern).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
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
    revalidatePath(`/agents/${id}`);
    revalidateTag(`agent-${id}`, "max");
    return NextResponse.json(goals);
  } catch (error) {
    console.error("PUT /api/agents/[id]/goals error:", error);
    return NextResponse.json({ error: "Failed to update goals" }, { status: 500 });
  }
}
