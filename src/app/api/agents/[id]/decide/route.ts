import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ThompsonSampling } from "@/lib/engine/thompson-sampling";
import { EpsilonGreedy } from "@/lib/engine/epsilon-greedy";
import type { BanditArm, DecisionResult } from "@/lib/engine/types";

type DecideResponseData = DecisionResult & {
  warmupForced: boolean;
};

type DecideSuccessResponse = { data: DecideResponseData };
type DecideErrorResponse = { error: string };

// Pessimistic Beta prior for arms with no historical stats
const PESSIMISTIC_PRIOR: { alpha: number; beta: number; tries: number; wins: number } = {
  alpha: 1,
  beta: 30,
  tries: 0,
  wins: 0,
};

// Probability of forcing a warmup variant when any are still in warmup period
const WARMUP_FORCE_PROBABILITY = 0.1;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<DecideSuccessResponse | DecideErrorResponse>> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("userId" in body) ||
    typeof (body as Record<string, unknown>).userId !== "string" ||
    !(body as Record<string, unknown>).userId
  ) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { userId, channel } = body as { userId: string; channel?: unknown };
  const channelFilter = typeof channel === "string" && channel ? channel : undefined;

  try {
    // Resolve user
    const user = await prisma.user.findUnique({ where: { externalId: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Resolve agent (not deleted — allow active, paused, draft)
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        messages: { include: { variants: true } },
        schedulingRule: true,
      },
    });

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Collect active variants, optionally filtered by channel
    type VariantWithChannel = {
      id: string;
      name: string;
      status: string;
      warmupUntil: Date | null;
      channel: string;
    };

    const activeVariants: VariantWithChannel[] = [];
    for (const message of agent.messages) {
      if (channelFilter && message.channel !== channelFilter) continue;
      for (const variant of message.variants) {
        if (variant.status === "active") {
          activeVariants.push({
            id: variant.id,
            name: variant.name,
            status: variant.status,
            warmupUntil: variant.warmupUntil,
            channel: message.channel,
          });
        }
      }
    }

    if (activeVariants.length === 0) {
      return NextResponse.json({ error: "No active variants" }, { status: 400 });
    }

    // Determine persona key — fall back to "global" when user has no persona
    const personaKey = user.personaId ?? "global";

    // Load PersonaArmStats for all active variants in one query
    const armStatRows = await prisma.personaArmStats.findMany({
      where: {
        agentId: id,
        personaId: personaKey,
        variantId: { in: activeVariants.map((v) => v.id) },
      },
    });

    const statsMap = new Map(armStatRows.map((row) => [row.variantId, row]));

    // Build BanditArm array with pessimistic priors for unseen arms
    const arms: BanditArm[] = activeVariants.map((variant) => {
      const row = statsMap.get(variant.id);
      return {
        id: variant.id,
        stats: row
          ? { alpha: row.alpha, beta: row.beta, tries: row.tries, wins: row.wins }
          : { ...PESSIMISTIC_PRIOR },
      };
    });

    // Forced exploration: with 10% probability, force-select a warmup variant
    const now = new Date();
    const warmupVariants = activeVariants.filter(
      (v) => v.warmupUntil !== null && v.warmupUntil > now,
    );

    let selectedVariantId: string;
    let warmupForced = false;
    let explore = false;
    let predictedReward = 0;

    if (warmupVariants.length > 0 && Math.random() < WARMUP_FORCE_PROBABILITY) {
      // Force-select a warmup variant uniformly at random
      const forced = warmupVariants[Math.floor(Math.random() * warmupVariants.length)];
      selectedVariantId = forced.id;
      warmupForced = true;
      explore = true;
      const forcedArm = arms.find((a) => a.id === selectedVariantId);
      predictedReward =
        forcedArm && forcedArm.stats.tries > 0
          ? forcedArm.stats.wins / forcedArm.stats.tries
          : 0;
    } else {
      // Run the bandit algorithm
      let result: DecisionResult;
      if (agent.algorithm === "epsilon") {
        result = new EpsilonGreedy(agent.epsilon).select(arms);
      } else {
        // Default to thompson
        result = new ThompsonSampling().select(arms);
      }
      selectedVariantId = result.variantId;
      explore = result.explore;
      predictedReward = result.predictedReward;
    }

    // Resolve channel from the selected variant
    const selectedVariant = activeVariants.find((v) => v.id === selectedVariantId);
    // selectedVariant is always found because selectedVariantId comes from activeVariants
    const selectedChannel = selectedVariant!.channel;

    // Record the decision
    await prisma.userDecision.create({
      data: {
        agentId: agent.id,
        userId: user.externalId,
        messageVariantId: selectedVariantId,
        channel: selectedChannel,
        sentAt: new Date(),
      },
    });

    return NextResponse.json({
      data: {
        variantId: selectedVariantId,
        channel: selectedChannel,
        explore,
        warmupForced,
        predictedReward,
      },
    });
  } catch (error) {
    console.error(`POST /api/agents/${id}/decide error:`, error);
    return NextResponse.json({ error: "Failed to process decision" }, { status: 500 });
  }
}
