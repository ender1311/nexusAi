import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
    return NextResponse.json(agent);
  } catch (error) {
    console.error(`GET /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to fetch agent" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description,
        status: body.status,
        algorithm: body.algorithm,
        epsilon: body.epsilon,
      },
    });
    return NextResponse.json(agent);
  } catch (error) {
    console.error(`PATCH /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.agent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`DELETE /api/agents/${id} error:`, error);
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }
}
