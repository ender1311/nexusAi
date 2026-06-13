import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";

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
  /** All active push variants for this agent — used by the variant override picker. */
  allVariants: DemoVariant[];
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agentId, userIds, variantOverrideId } = body as { agentId?: unknown; userIds?: unknown; variantOverrideId?: unknown };

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

    // If a variant override is specified, all users see that variant.
    const overrideVariant = typeof variantOverrideId === "string"
      ? allVariants.find((v) => v.id === variantOverrideId)
      : undefined;

    // Build assignments: round-robin personas, Thompson-sample variant per persona
    const ts = new ThompsonSampling();
    const assignments: DemoAssignment[] = ids.map((userId, i) => {
      const persona = personas[i % personas.length];
      const personaStats = statsByPersonaVariant[persona.id] ?? {};

      let bestVariant = overrideVariant;
      let predictedReward = 0;

      if (!bestVariant) {
        // Build arms for Thompson sampling — fall back to pessimistic Beta(1,30) prior
        const arms = allVariants.map((v) => {
          const s = personaStats[v.id];
          const stats = s ? { ...s, tries: 0, wins: 0 } : { alpha: 1, beta: 30, tries: 0, wins: 0 };
          return { id: v.id, stats };
        });
        const result = ts.select(arms);
        bestVariant = allVariants.find((v) => v.id === result.variantId) ?? allVariants[0];
        predictedReward = result.predictedReward > 0 ? result.predictedReward : 1 / 31;
      }

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

    const allVariantsList: DemoVariant[] = allVariants.map((v) => ({
      id: v.id,
      name: v.name,
      title: v.title ?? null,
      body: v.body,
      cta: v.cta ?? null,
      deeplink: v.deeplink ?? null,
    }));

    return NextResponse.json<DemoPreviewResponse>({
      agentId,
      agentName: agent.name,
      assignments,
      allVariants: allVariantsList,
    });
  } catch (error) {
    console.error("POST /api/demo/preview error:", error);
    return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 });
  }
}
