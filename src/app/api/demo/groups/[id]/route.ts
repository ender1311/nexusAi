import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ ok: boolean }> | NextResponse<{ error: string }>> {
  const { id } = await params;
  try {
    await prisma.demoUserGroup.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }
}
