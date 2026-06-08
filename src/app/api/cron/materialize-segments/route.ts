import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";
import { materializeAllSegments, type MaterializeSummary } from "@/lib/segments/materialize";

// Allow up to 300s execution time on Vercel.
export const maxDuration = 300;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<{ data: MaterializeSummary } | { error: string }>> {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runStart = new Date();
  try {
    const summary = await materializeAllSegments({ runStart });
    await prisma.cronRun.create({
      data: {
        cronName: "materialize-segments",
        startedAt: runStart,
        finishedAt: new Date(),
        status: "completed",
        agentCount: summary.segmentsProcessed,
        errors: summary.segmentsFailed,
      },
    });
    return NextResponse.json({ data: summary }, { status: 200 });
  } catch (err) {
    await prisma.cronRun
      .create({
        data: {
          cronName: "materialize-segments",
          startedAt: runStart,
          finishedAt: new Date(),
          status: "failed",
          errorMsg: err instanceof Error ? err.message : "unknown error",
        },
      })
      .catch(() => {});
    return NextResponse.json({ error: "Materialization failed" }, { status: 500 });
  }
}
