import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type ArmStatRow = {
  personaId: string;
  personaName: string;
  personaColor: string;
  personaIcon: string;
  variantId: string;
  variantName: string;
  variantBody: string;
  variantTitle: string | null;
  alpha: number;
  beta: number;
  tries: number;
  wins: number;
};

export type ArmStatsResponse = {
  agentId: string;
  agentName: string;
  armStats: ArmStatRow[];
};

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json<{ error: string }>({ error: "agentId is required" }, { status: 400 });
  }

  try {
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      return NextResponse.json<{ error: string }>({ error: "Agent not found" }, { status: 404 });
    }

    // PersonaArmStats has no Prisma @relation — join in memory via separate queries.
    const rawStats = await prisma.personaArmStats.findMany({ where: { agentId } });

    const personaIds = [...new Set(rawStats.map((s) => s.personaId))];
    const [variants, personas] = await Promise.all([
      prisma.messageVariant.findMany({
        where: {
          message: { agentId },
          status: "active",
        },
        select: { id: true, name: true, body: true, title: true },
      }),
      prisma.persona.findMany({
        where: { id: { in: personaIds } },
        select: { id: true, name: true, color: true, icon: true },
      }),
    ]);

    const variantMap = new Map(variants.map((v) => [v.id, v]));
    const personaMap = new Map(personas.map((p) => [p.id, p]));

    const armStats: ArmStatRow[] = rawStats
      .map((stat) => {
        const v = variantMap.get(stat.variantId);
        const p = personaMap.get(stat.personaId);
        if (!v || !p) return null;
        return {
          personaId: p.id,
          personaName: p.name,
          personaColor: p.color,
          personaIcon: p.icon,
          variantId: v.id,
          variantName: v.name,
          variantBody: v.body,
          variantTitle: v.title ?? null,
          alpha: stat.alpha,
          beta: stat.beta,
          tries: stat.tries,
          wins: stat.wins,
        };
      })
      .filter((s): s is ArmStatRow => s !== null);

    return NextResponse.json<ArmStatsResponse>({ agentId, agentName: agent.name, armStats });
  } catch (error) {
    console.error("GET /api/demo/arm-stats error:", error);
    return NextResponse.json<{ error: string }>({ error: "Failed to fetch arm stats" }, { status: 500 });
  }
}
