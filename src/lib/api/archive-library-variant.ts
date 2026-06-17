import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/api/respond";

/**
 * Soft-delete (archive) a library template variant. Library templates are
 * MessageVariant rows whose Message has agentId === null; refuse to touch
 * agent-attached variants. Mirrors DELETE /api/push-library/[id].
 */
export async function archiveLibraryVariant(id: string | null): Promise<NextResponse> {
  if (!id) return fail("Missing template id", 400);

  const variant = await prisma.messageVariant.findUnique({
    where: { id },
    select: { id: true, message: { select: { agentId: true } } },
  });
  if (!variant) return fail("Template not found", 404);
  if (variant.message.agentId !== null) return fail("Not a library template", 400);

  await prisma.messageVariant.update({
    where: { id },
    data: { status: "archived" },
  });

  revalidateTag("agents", "max");
  return NextResponse.json({ data: { id } });
}
