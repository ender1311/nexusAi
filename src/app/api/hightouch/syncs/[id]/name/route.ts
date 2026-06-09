import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";

const MAX_NAME_LEN = 100;

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: { syncId: string; displayName: string } } | { error: string }>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body", 400);
  }

  const raw = (body as Record<string, unknown> | null)?.displayName;
  if (typeof raw !== "string") return fail("displayName must be a string", 400);
  const displayName = raw.trim();
  if (displayName.length === 0) return fail("displayName must not be empty", 400);
  if (displayName.length > MAX_NAME_LEN) return fail(`displayName must be ${MAX_NAME_LEN} characters or fewer`, 400);

  try {
    await prisma.syncNameOverride.upsert({
      where: { syncId: id },
      create: { syncId: id, displayName },
      update: { displayName },
    });
    return ok({ syncId: id, displayName });
  } catch (err) {
    return handleRouteError(`PUT /api/hightouch/syncs/${id}/name`, err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<{ data: { syncId: string } } | { error: string }>> {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  const { id } = await params;
  try {
    await prisma.syncNameOverride.deleteMany({ where: { syncId: id } });
    return ok({ syncId: id });
  } catch (err) {
    return handleRouteError(`DELETE /api/hightouch/syncs/${id}/name`, err);
  }
}
