import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export type DemoUserGroupRecord = {
  id: string;
  name: string;
  userIds: string[];
  createdAt: string;
  updatedAt: string;
};

export async function GET(): Promise<NextResponse<{ data: DemoUserGroupRecord[] }> | NextResponse<{ error: string }>> {
  try {
    const groups = await prisma.demoUserGroup.findMany({
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({
      data: groups.map((g) => ({
        id: g.id,
        name: g.name,
        userIds: g.userIds as string[],
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<{ data: DemoUserGroupRecord }> | NextResponse<{ error: string }>> {
  const denied = await requireAdmin();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, userIds } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
  }

  const ids = userIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  try {
    const group = await prisma.demoUserGroup.upsert({
      where: { name: name.trim() },
      create: { id: `grp_${Date.now()}`, name: name.trim(), userIds: ids },
      update: { userIds: ids, updatedAt: new Date() },
    });
    return NextResponse.json({
      data: {
        id: group.id,
        name: group.name,
        userIds: group.userIds as string[],
        createdAt: group.createdAt.toISOString(),
        updatedAt: group.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to save group" }, { status: 500 });
  }
}
