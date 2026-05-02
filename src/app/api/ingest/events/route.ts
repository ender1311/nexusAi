import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { accumulateUserStats } from "@/lib/engine/user-stats";

/**
 * POST /api/ingest/events
 *
 * Hightouch Event Streaming destination for near-real-time conversion events.
 * Used to close the reward loop: match events to UserDecision records.
 *
 * Expected payload shape:
 * {
 *   event_id: string,              // idempotency key
 *   event_name: string,            // e.g. "plan_started", "app_open"
 *   external_user_id: string,      // user ID
 *   occurred_at: string,           // ISO 8601 timestamp
 *   properties?: {
 *     [key: string]: string | number | boolean | null
 *   }
 * }
 *
 * Or batch:
 * { events: Array<above> }
 */

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.HIGHTOUCH_API_KEY ?? process.env.INGEST_API_KEY;
  if (!expected) return false; // Require key to be configured — never open to all
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return token === expected;
}

type EventRecord = {
  event_id: string;
  event_name: string;
  external_user_id: string;
  occurred_at: string;
  properties?: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Normalize to array
  let events: EventRecord[];
  if (Array.isArray(body)) {
    events = body;
  } else if (typeof body === "object" && body !== null && "events" in body && Array.isArray((body as Record<string, unknown>).events)) {
    events = (body as { events: EventRecord[] }).events;
  } else if (typeof body === "object" && body !== null && "event_name" in body) {
    events = [body as EventRecord];
  } else {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const invalid = events.filter((e) => !e.event_id || !e.event_name || !e.external_user_id || !e.occurred_at);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Each event must have event_id, event_name, external_user_id, occurred_at", invalid_count: invalid.length },
      { status: 400 }
    );
  }

  // Deduplicate by event_id within this batch
  const seen = new Set<string>();
  const deduped = events.filter((e) => {
    if (seen.has(e.event_id)) return false;
    seen.add(e.event_id);
    return true;
  });

  console.log(`[ingest/events] Received ${deduped.length} events`, {
    event_types: [...new Set(deduped.map((e) => e.event_name))],
  });

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const event of deduped) {
    const occurredAt = new Date(event.occurred_at);

    // push_disabled is a permanent opt-out signal — no attribution window needed.
    // Apply a hard penalty to arm stats for all agents this user recently received
    // decisions from, then move on. Do not try to match a specific UserDecision.
    if (event.event_name === "push_disabled") {
      const user = await prisma.trackedUser.findFirst({
        where: { externalId: event.external_user_id },
        select: { personaId: true },
      });
      if (user?.personaId) {
        const recentCutoff = new Date(occurredAt.getTime() - 90 * 24 * 60 * 60 * 1000);
        const recentDecisions = await prisma.userDecision.findMany({
          where: {
            userId: event.external_user_id,
            sentAt: { gte: recentCutoff },
            messageVariantId: { not: null },
          },
          distinct: ["agentId", "messageVariantId"],
          select: { agentId: true, messageVariantId: true },
        });
        // Hard negative reward: -1.0 (the max negative in the normalized [-1, 1] range)
        const pushOptOutReward = -1.0;
        for (const d of recentDecisions) {
          if (!d.messageVariantId) continue;
          const existing = await prisma.personaArmStats.findUnique({
            where: {
              personaId_agentId_variantId: {
                personaId: user.personaId,
                agentId: d.agentId,
                variantId: d.messageVariantId,
              },
            },
          });
          const decayedAlpha = existing ? 1 + (existing.alpha - 1) * 0.99 : 1;
          const decayedBeta = existing ? 1 + (existing.beta - 1) * 0.99 : 30;
          await prisma.personaArmStats.upsert({
            where: {
              personaId_agentId_variantId: {
                personaId: user.personaId,
                agentId: d.agentId,
                variantId: d.messageVariantId,
              },
            },
            update: {
              alpha: decayedAlpha,
              beta: decayedBeta + 1,
              tries: { increment: 1 },
            },
            create: {
              personaId: user.personaId,
              agentId: d.agentId,
              variantId: d.messageVariantId,
              alpha: 1,
              beta: 31,
              tries: 1,
              wins: 0,
            },
          });
        }
        await accumulateUserStats({
          externalId: event.external_user_id,
          channel: "push",
          reward: pushOptOutReward,
          occurredAt,
        }).catch((err) => {
          console.error("[ingest/events] Failed to accumulate user stats for push_disabled:", err);
        });
      }
      matched.push(event.event_id);
      continue;
    }

    // For plan_completed and other long-horizon events, extend the attribution window to 30 days.
    // Standard short-horizon events use the default 48h window.
    const LONG_HORIZON_EVENTS = new Set(["plan_completed", "plan_read_day_3", "plan_read_day_7"]);
    const attributionHours = LONG_HORIZON_EVENTS.has(event.event_name) ? 30 * 24 : 48;
    const windowStart = new Date(occurredAt.getTime() - attributionHours * 60 * 60 * 1000);

    const decision = await prisma.userDecision.findFirst({
      where: {
        userId: event.external_user_id,
        conversionAt: null,
        sentAt: { gte: windowStart, lte: occurredAt },
      },
      orderBy: { sentAt: "desc" },
      include: { agent: { include: { goals: true } } },
    });

    if (!decision) {
      unmatched.push(event.event_id);
      continue;
    }

    // Use shared reward calculator (supports dynamic property-based weights)
    const reward = calculateReward(
      event.event_name,
      decision.agent.goals as Parameters<typeof calculateReward>[1],
      event.properties
    );

    await prisma.userDecision.update({
      where: { id: decision.id },
      data: {
        conversionEvent: event.event_name,
        conversionAt: occurredAt,
        reward: reward !== 0 ? reward : null,
      },
    });

    // Accumulate per-user behavioral stats
    if (reward !== 0) {
      await accumulateUserStats({
        externalId: event.external_user_id,
        channel: decision.channel,
        reward,
        occurredAt,
      }).catch((err) => {
        console.error("[ingest/events] Failed to accumulate user stats:", err);
      });
    }

    // Update PersonaArmStats to close the learning loop.
    // Apply temporal decay before adding reward to prevent old data locking in winners.
    // Decay formula: alpha = 1 + (alpha - 1) * 0.99, same for beta. (Industry practice: ~0.99/update)
    // We update even when reward=0 — neutral events still count as a "try" (tightens variance).
    if (decision.messageVariantId) {
      const user = await prisma.trackedUser.findFirst({
        where: { externalId: event.external_user_id },
        select: { personaId: true },
      });
      if (user?.personaId) {
        const existing = await prisma.personaArmStats.findUnique({
          where: {
            personaId_agentId_variantId: {
              personaId: user.personaId,
              agentId: decision.agentId,
              variantId: decision.messageVariantId,
            },
          },
        });
        // Apply temporal decay then update
        const decayedAlpha = existing ? 1 + (existing.alpha - 1) * 0.99 : 1;
        const decayedBeta = existing ? 1 + (existing.beta - 1) * 0.99 : 30;
        await prisma.personaArmStats.upsert({
          where: {
            personaId_agentId_variantId: {
              personaId: user.personaId,
              agentId: decision.agentId,
              variantId: decision.messageVariantId,
            },
          },
          update: {
            alpha: decayedAlpha + (reward > 0 ? reward : 0),
            beta: decayedBeta + (reward <= 0 ? 1 : 0),
            tries: { increment: 1 },
            wins: { increment: reward > 0 ? 1 : 0 },
          },
          create: {
            personaId: user.personaId,
            agentId: decision.agentId,
            variantId: decision.messageVariantId,
            alpha: 1 + (reward > 0 ? reward : 0),
            beta: 30 + (reward <= 0 ? 1 : 0),
            tries: 1,
            wins: reward > 0 ? 1 : 0,
          },
        }).catch((err) => {
          console.error("[ingest/events] Failed to update PersonaArmStats:", err);
        });
      }
    }

    matched.push(event.event_id);
  }

  return NextResponse.json({
    ok: true,
    received: deduped.length,
    deduplicated: events.length - deduped.length,
    matched: matched.length,
    unmatched: unmatched.length,
  });
}
