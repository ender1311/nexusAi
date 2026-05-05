import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type TestUser = { externalId: string; name: string; personaId: string | null; createdAt: string };

export async function GET(): Promise<NextResponse<{ data: TestUser[] }> | NextResponse<{ error: string }>> {
  try {
    const users = await prisma.trackedUser.findMany({
      where: {
        attributes: { path: ["_is_test_user"], equals: true },
      },
      select: { externalId: true, attributes: true, personaId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const data: TestUser[] = users.map((u) => ({
      externalId: u.externalId,
      name: (u.attributes as Record<string, unknown>)?.name as string ?? u.externalId,
      personaId: u.personaId,
      createdAt: u.createdAt.toISOString(),
    }));

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Failed to fetch test users" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse<{ data: TestUser }> | NextResponse<{ error: string }>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, externalId } = (body ?? {}) as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof externalId !== "string" || !externalId.trim()) {
    return NextResponse.json({ error: "externalId is required" }, { status: 400 });
  }

  try {
    const user = await prisma.trackedUser.upsert({
      where: { externalId: externalId.trim() },
      create: {
        externalId: externalId.trim(),
        attributes: { name: name.trim(), _is_test_user: true },
      },
      update: {
        attributes: { name: name.trim(), _is_test_user: true },
      },
      select: { externalId: true, attributes: true, personaId: true, createdAt: true },
    });

    return NextResponse.json({
      data: {
        externalId: user.externalId,
        name: name.trim(),
        personaId: user.personaId,
        createdAt: user.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to add test user" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse<{ ok: boolean }> | NextResponse<{ error: string }>> {
  const { searchParams } = new URL(req.url);
  const externalId = searchParams.get("externalId");
  if (!externalId) {
    return NextResponse.json({ error: "externalId query param required" }, { status: 400 });
  }

  try {
    await prisma.trackedUser.delete({ where: { externalId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
