import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function POST(req: NextRequest): Promise<NextResponse<{ data: { updated: number } } | { error: string }>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("orderedIds" in body) ||
    !Array.isArray((body as { orderedIds: unknown }).orderedIds) ||
    !(body as { orderedIds: unknown[] }).orderedIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json({ error: "orderedIds must be an array of strings" }, { status: 400 });
  }

  const orderedIds = (body as { orderedIds: string[] }).orderedIds;

  try {
    await prisma.$transaction(async (tx) => {
      await Promise.all(
        orderedIds.map((id, index) =>
          tx.agent.update({
            where: { id },
            data: { sortOrder: index },
          }),
        ),
      );
    });

    revalidateTag("agents", "max");

    return NextResponse.json({ data: { updated: orderedIds.length } });
  } catch (error) {
    console.error("POST /api/agents/reorder error:", error);
    return NextResponse.json({ error: "Failed to reorder agents" }, { status: 500 });
  }
}
