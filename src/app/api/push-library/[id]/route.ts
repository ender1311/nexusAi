import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { LIBRARY_AGENT_NAME } from "@/lib/engine/template-sync";
import { fail, handleRouteError } from "@/lib/api/respond";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;
  try {
    const variant = await prisma.messageVariant.findUnique({
      where: { id },
      include: { message: { include: { agent: { select: { name: true } } } } },
    });

    if (!variant) {
      return fail("Template not found", 404);
    }

    if (variant.message.agent.name !== LIBRARY_AGENT_NAME) {
      return fail("Not a library template", 400);
    }

    await prisma.messageVariant.update({
      where: { id },
      data: { status: "archived" },
    });

    revalidateTag("agents", "max");
    return NextResponse.json({ data: { id } });
  } catch (err) {
    return handleRouteError(`DELETE /api/push-library/${id}`, err);
  }
}
