import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireLibraryEditor } from "@/lib/auth";

import { fail, handleRouteError } from "@/lib/api/respond";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const forbidden = await requireLibraryEditor();
  if (forbidden) return forbidden;

  const { id } = await params;
  try {
    const variant = await prisma.messageVariant.findUnique({
      where: { id },
      select: { id: true, message: { select: { agentId: true } } },
    });

    if (!variant) {
      return fail("Template not found", 404);
    }

    if (variant.message.agentId !== null) {
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
