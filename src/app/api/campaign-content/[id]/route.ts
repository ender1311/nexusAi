import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { title, body: msgBody, usfmHuman, status } = body as Record<string, unknown>;
  const data: Record<string, string | null> = {};
  if (typeof title === "string") data.title = title.trim() || null;
  if (typeof msgBody === "string") data.body = (msgBody as string).trim() || null;
  if (typeof usfmHuman === "string") data.usfmHuman = usfmHuman.trim() || null;
  if (typeof status === "string") {
    if (!["active", "archived"].includes(status)) {
      return NextResponse.json({ error: "status must be active or archived" }, { status: 400 });
    }
    data.status = status;
  }

  try {
    const row = await prisma.campaignContent.update({ where: { id }, data });
    return NextResponse.json({ data: row });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("PATCH /api/campaign-content/[id] error:", error);
    return NextResponse.json({ error: "Failed to update content" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { user } = await getAuth();
  if (!user) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const row = await prisma.campaignContent.update({
      where: { id },
      data: { status: "archived" },
    });
    return NextResponse.json({ data: { id: row.id } });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/campaign-content/[id] error:", error);
    return NextResponse.json({ error: "Failed to archive content" }, { status: 500 });
  }
}
