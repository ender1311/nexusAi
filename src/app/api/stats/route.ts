import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCachedControlTowerStats } from "@/lib/cache/dashboard";

export type StatsData = {
  trackedUsers: number;
  personas: number;
  agents: number;
  totalDecisions: number;
  totalConversions: number;
};

export async function GET(): Promise<NextResponse<StatsData | { error: string }>> {
  try {
    // trackedUsers/personas/decisions/conversions come from the DAY-cached helper —
    // it shares the 19M-row TrackedUser + UserDecision full-table scans with the
    // dashboard so they run at most once/day instead of on every request here.
    const [base, agents] = await Promise.all([
      getCachedControlTowerStats(),
      prisma.agent.count({ where: { status: "active" } }),
    ]);

    const res = NextResponse.json({
      trackedUsers: base.trackedUsers,
      personas: base.personas,
      agents,
      totalDecisions: base.totalDecisions,
      totalConversions: base.totalConversions,
    });
    res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res;
  } catch {
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
