import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: agentId } = await params;

  let body: { personaId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.personaId !== "string" || !body.personaId.trim()) {
    return NextResponse.json({ error: "personaId required" }, { status: 400 });
  }

  const [agent, persona] = await Promise.all([
    prisma.agent.findUnique({ where: { id: agentId }, select: { id: true } }),
    prisma.persona.findUnique({ where: { id: body.personaId }, select: { id: true } }),
  ]);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  try {
    const target = await prisma.agentPersonaTarget.create({
      data: { agentId, personaId: body.personaId },
    });
    return NextResponse.json({ data: target }, { status: 201 });
  } catch {
    // Unique constraint = already linked
    return NextResponse.json({ error: "Already linked" }, { status: 409 });
  }
}
