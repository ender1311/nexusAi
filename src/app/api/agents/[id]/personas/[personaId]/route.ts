import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; personaId: string }> }
) {
  const { id: agentId, personaId } = await params;

  const target = await prisma.agentPersonaTarget.findUnique({
    where: { agentId_personaId: { agentId, personaId } },
  });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.agentPersonaTarget.delete({ where: { id: target.id } });
  return NextResponse.json({ data: { ok: true } });
}
