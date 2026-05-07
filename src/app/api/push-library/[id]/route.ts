import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { isAdmin } = await getAuth();
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const variant = await prisma.messageVariant.findUnique({
    where: { id },
    include: { message: { include: { agent: { select: { name: true } } } } },
  });

  if (!variant) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  if (variant.message.agent.name !== LIBRARY_AGENT_NAME) {
    return NextResponse.json({ error: "Not a library template" }, { status: 400 });
  }

  await prisma.messageVariant.update({
    where: { id },
    data: { status: "archived" },
  });

  return NextResponse.json({ data: { id } });
}
