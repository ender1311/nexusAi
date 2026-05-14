import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const metrics = await prisma.modelMetric.findMany({
      where: { agentId: id },
      orderBy: { timestamp: "desc" },
      take: 100,
    });
    return NextResponse.json(metrics);
  } catch (error) {
    console.error("GET /api/agents/[id]/metrics error:", error);
    return NextResponse.json({ error: "Failed to fetch metrics" }, { status: 500 });
  }
}
