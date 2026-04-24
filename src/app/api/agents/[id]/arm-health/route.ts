import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

type VariantHealthEntry = {
  variantId: string;
  variantName: string;
  hasStats: boolean;
  totalTries: number;
  inWarmup: boolean;
};

type HealthStatus = "healthy" | "warning" | "critical";

type ArmHealthData = {
  agentId: string;
  totalActiveVariants: number;
  variantsWithStats: number;
  variantsInWarmup: number;
  variantsWithNoStats: number;
  healthStatus: HealthStatus;
  variants: VariantHealthEntry[];
};

type ArmHealthSuccessResponse = { data: ArmHealthData };
type ArmHealthErrorResponse = { error: string };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ArmHealthSuccessResponse | ArmHealthErrorResponse>> {
  const { id } = await params;

  try {
    // Fetch agent with active variants
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        messages: { include: { variants: true } },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Collect all active variants
    const activeVariants = agent.messages.flatMap((message) =>
      message.variants
        .filter((v) => v.status === "active")
        .map((v) => ({ id: v.id, name: v.name, warmupUntil: v.warmupUntil })),
    );

    // Fetch all PersonaArmStats for this agent, ordered by id DESC (newest first)
    const allArmStats = await prisma.personaArmStats.findMany({
      where: { agentId: id },
      orderBy: { id: "desc" },
    });

    // Group by variantId — accumulate max tries across all personas
    const triesByVariant = new Map<string, number>();
    for (const row of allArmStats) {
      const current = triesByVariant.get(row.variantId) ?? 0;
      if (row.tries > current) {
        triesByVariant.set(row.variantId, row.tries);
      }
    }

    const now = new Date();

    const variants: VariantHealthEntry[] = activeVariants.map((variant) => {
      const totalTries = triesByVariant.get(variant.id) ?? 0;
      const hasStats = totalTries > 0;
      const inWarmup = variant.warmupUntil !== null && variant.warmupUntil > now;
      return {
        variantId: variant.id,
        variantName: variant.name,
        hasStats,
        totalTries,
        inWarmup,
      };
    });

    const totalActiveVariants = variants.length;
    const variantsWithStats = variants.filter((v) => v.hasStats).length;
    const variantsInWarmup = variants.filter((v) => v.inWarmup).length;
    const variantsWithNoStats = totalActiveVariants - variantsWithStats;

    let healthStatus: HealthStatus;
    if (totalActiveVariants === 0 || variantsWithStats === 0) {
      healthStatus = "critical";
    } else if (variantsWithStats / totalActiveVariants < 0.5) {
      healthStatus = "warning";
    } else {
      healthStatus = "healthy";
    }

    return NextResponse.json({
      data: {
        agentId: id,
        totalActiveVariants,
        variantsWithStats,
        variantsInWarmup,
        variantsWithNoStats,
        healthStatus,
        variants,
      },
    });
  } catch (error) {
    console.error(`GET /api/agents/${id}/arm-health error:`, error);
    return NextResponse.json({ error: "Failed to fetch arm health" }, { status: 500 });
  }
}
