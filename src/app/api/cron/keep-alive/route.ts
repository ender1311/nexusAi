import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";

function isAuthorized(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "") ?? null;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.$queryRaw`SELECT 1`;
  return NextResponse.json({ ok: true });
}
