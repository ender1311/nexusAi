import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type CronRunData = {
  id: string;
  cronName: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  sent: number;
  suppressed: number;
  errors: number;
  agentCount: number;
  errorMsg: string | null;
};

export async function GET(): Promise<NextResponse<{ data: CronRunData[] }>> {
  const runs = await prisma.cronRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  const res = NextResponse.json({
    data: runs.map((r) => ({
      id: r.id,
      cronName: r.cronName,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      status: r.status,
      sent: r.sent,
      suppressed: r.suppressed,
      errors: r.errors,
      agentCount: r.agentCount,
      errorMsg: r.errorMsg,
    })),
  });
  res.headers.set("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
  return res;
}
