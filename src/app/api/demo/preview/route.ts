import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export type DemoPersona = {
  id: string;
  name: string;
  color: string;
  icon: string;
};

export type DemoVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  cta: string | null;
  deeplink: string | null;
};

export type DemoGoal = {
  eventName: string;
  tier: string;
};

export type DemoAssignment = {
  userId: string;
  persona: DemoPersona;
  variant: DemoVariant;
  goal: DemoGoal | null;
  predictedReward: number;
};

export type DemoPreviewResponse = {
  agentId: string;
  agentName: string;
  assignments: DemoAssignment[];
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agentId, userIds } = body as { agentId?: unknown; userIds?: unknown };

    if (typeof agentId !== "string" || !agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
    }
    if (userIds.length > 20) {
      return NextResponse.json({ error: "Maximum 20 user IDs per demo" }, { status: 400 });
    }
    const ids = userIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    if (ids.length === 0) {
      return NextResponse.json({ error: "No valid user IDs provided" }, { status: 400 });
    }

    // Fetch agent with push messages + variants + goals + persona targets
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        messages: {
          where: { channel: "push" },
          include: {
            variants: {
              where: { status: "active" },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        goals: { orderBy: { tier: "asc" } },
        personaTargets: { include: { persona: true } },
      },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Collect active push variants across all messages
    const allVariants = agent.messages.flatMap((m) => m.variants);
    if (allVariants.length === 0) {
      return NextResponse.json(
        { error: "Agent has no active push variants to demo" },
        { status: 400 }
      );
    }

    // Determine persona pool (agent targets → all active)
    let personas: DemoPersona[] = agent.personaTargets.map((pt) => ({
      id: pt.persona.id,
      name: pt.persona.name,
      color: pt.persona.color,
      icon: pt.persona.icon,
    }));

    if (personas.length === 0) {
      const allPersonas = await prisma.persona.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        take: 8,
      });
      personas = allPersonas.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        icon: p.icon,
      }));
    }

    if (personas.length === 0) {
      return NextResponse.json({ error: "No personas configured" }, { status: 400 });
    }

    // Fetch PersonaArmStats for this agent to select best variants per persona
    const armStats = await prisma.personaArmStats.findMany({
      where: { agentId },
    });

    // Build lookup: personaId → variantId → { alpha, beta }
    const statsByPersonaVariant: Record<string, Record<string, { alpha: number; beta: number }>> =
      {};
    for (const stat of armStats) {
      if (!statsByPersonaVariant[stat.personaId]) {
        statsByPersonaVariant[stat.personaId] = {};
      }
      statsByPersonaVariant[stat.personaId][stat.variantId] = {
        alpha: stat.alpha,
        beta: stat.beta,
      };
    }

    // Primary goal for display
    const primaryGoal: DemoGoal | null =
      agent.goals.length > 0
        ? { eventName: agent.goals[0].eventName, tier: agent.goals[0].tier }
        : null;

    // Build assignments: round-robin personas, pick best variant per persona
    const assignments: DemoAssignment[] = ids.map((userId, i) => {
      const persona = personas[i % personas.length];

      // Find variant with highest deterministic mean (alpha / (alpha + beta)).
      // Use mean rather than sampling so the preview is stable and explainable.
      // When a persona has no arm stats yet, all variants share the same default
      // prior (Beta(1,30) ≈ 3.2%) so every persona would tie-break to variant[0].
      // Instead, rotate through variants by user index so the demo shows the
      // concept that different users get different messages.
      const personaStats = statsByPersonaVariant[persona.id] ?? {};
      const hasAnyStats = Object.keys(personaStats).length > 0;

      let bestVariant: (typeof allVariants)[0];
      let bestMean: number;

      if (!hasAnyStats) {
        bestVariant = allVariants[i % allVariants.length];
        bestMean = 1 / 31; // pessimistic Beta(1,30) prior
      } else {
        bestVariant = allVariants[0];
        bestMean = -1;
        for (const variant of allVariants) {
          const stats = personaStats[variant.id];
          const mean = stats
            ? stats.alpha / (stats.alpha + stats.beta)
            : 1 / 31; // default pessimistic init Beta(1,30)
          if (mean > bestMean) {
            bestMean = mean;
            bestVariant = variant;
          }
        }
      }

      const predictedReward = bestMean > 0 ? bestMean : 1 / 31;

      return {
        userId,
        persona,
        variant: {
          id: bestVariant.id,
          name: bestVariant.name,
          title: bestVariant.title ?? null,
          body: bestVariant.body,
          cta: bestVariant.cta ?? null,
          deeplink: bestVariant.deeplink ?? null,
        },
        goal: primaryGoal,
        predictedReward,
      };
    });

    return NextResponse.json<DemoPreviewResponse>({
      agentId,
      agentName: agent.name,
      assignments,
    });
  } catch (error) {
    console.error("POST /api/demo/preview error:", error);
    return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 });
  }
}
