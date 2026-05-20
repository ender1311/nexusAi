import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { accumulateUserStats } from "@/lib/engine/user-stats";
import { upsertArmStats, upsertUserArmStats } from "@/lib/arm-stats";

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

  // Guard against oversized batches that could exhaust memory or DB connections
  if (events.length > 1000) {
    return NextResponse.json(
      { error: "Batch too large: maximum 1000 events per request" },
      { status: 400 }
    );
  }

  const invalid = events.filter((e) => !e.event_id || !e.event_name || !e.external_user_id || !e.occurred_at);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Each event must have event_id, event_name, external_user_id, occurred_at", invalid_count: invalid.length },
      { status: 400 }
    );
  }

  const invalidDates = events.filter((e) => isNaN(new Date(e.occurred_at).getTime()));
  if (invalidDates.length > 0) {
    return NextResponse.json(
      { error: "Each event must have a valid ISO 8601 occurred_at", invalid_count: invalidDates.length },
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

  const matched: string[] = [];
  const unmatched: string[] = [];

  for (const event of deduped) {
    const occurredAt = new Date(event.occurred_at);

    // push_disabled is a permanent opt-out signal — no attribution window needed.
    // Apply a hard penalty to arm stats for all agents this user recently received
    // decisions from, then move on. Do not try to match a specific UserDecision.
    // 14-day window: attributing a send from 89 days ago to a today opt-out is causally wrong.
    if (event.event_name === "push_disabled") {
      // Idempotency: skip if Hightouch already delivered this event in a previous batch
      const alreadyProcessedOptOut = await prisma.processedEventId.findUnique({
        where: { eventId: event.event_id },
      });
      if (alreadyProcessedOptOut) { unmatched.push(event.event_id); continue; }

      const user = await prisma.trackedUser.findFirst({
        where: { externalId: event.external_user_id },
        select: { personaId: true },
      });
      if (user?.personaId) {
        const recentCutoff = new Date(occurredAt.getTime() - 14 * 24 * 60 * 60 * 1000);
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
          await Promise.all([
            upsertArmStats({
              personaId: user.personaId,
              agentId: d.agentId,
              variantId: d.messageVariantId,
              deltaAlpha: 0,
              deltaBeta: 1,
              deltaWins: 0,
            }).catch((err) => {
              console.error("[ingest/events] Failed to update PersonaArmStats for push_disabled:", err);
            }),
            upsertUserArmStats({
              userId: event.external_user_id,
              agentId: d.agentId,
              variantId: d.messageVariantId,
              deltaAlpha: 0,
              deltaBeta: 1,
              deltaWins: 0,
            }).catch((err) => {
              console.error("[ingest/events] Failed to update UserArmStats for push_disabled:", err);
            }),
          ]);
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
      await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch((err: unknown) => {
        if ((err as { code?: string }).code !== "P2002") {
          console.error("[ingest/events] processedEventId.create failed:", err);
        }
      });
      matched.push(event.event_id);
      continue;
    }

    // Idempotency: skip if already processed in a previous batch
    const alreadyProcessed = await prisma.processedEventId.findUnique({
      where: { eventId: event.event_id },
    });
    if (alreadyProcessed) { unmatched.push(event.event_id); continue; }

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
      // Mark as processed so Hightouch retries don't re-attempt (unmatched is usually permanent)
      await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch((err: unknown) => {
        if ((err as { code?: string }).code !== "P2002") {
          console.error("[ingest/events] processedEventId.create failed:", err);
        }
      });
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

    // Update arm stats to close the learning loop: both persona-level (shared prior) and
    // user-level (individual posterior). Both use the same decay formula (~0.99/update).
    if (decision.messageVariantId) {
      const user = await prisma.trackedUser.findFirst({
        where: { externalId: event.external_user_id },
        select: { personaId: true },
      });
      // Beta parameter safety invariant: deltaAlpha and deltaBeta are always >= 0 by
      // construction, so they can never push alpha or beta below 1.
      // deltaAlpha = reward when reward > 0, else 0 — non-negative.
      // deltaBeta  = 1 when reward <= 0, else 0 — non-negative.
      // If this logic ever changes to allow negative deltas, add Math.max(0, delta)
      // guards here; otherwise alpha_new or beta_new could drop below 1, invalidating
      // the Beta distribution parameterisation (alpha, beta must be >= 1).
      const deltaAlpha = reward > 0 ? reward : 0;
      const deltaBeta  = reward <= 0 ? 1 : 0;
      const deltaWins  = reward > 0 ? 1 : 0;
      await Promise.all([
        // Persona-level prior: shared across all users in the same persona
        user?.personaId
          ? upsertArmStats({
              personaId: user.personaId,
              agentId: decision.agentId,
              variantId: decision.messageVariantId,
              deltaAlpha, deltaBeta, deltaWins,
            }).catch((err) => {
              console.error("[ingest/events] Failed to update PersonaArmStats:", err);
            })
          : Promise.resolve(),
        // User-level posterior: individual learning blended with persona prior at decision time
        upsertUserArmStats({
          userId: event.external_user_id,
          agentId: decision.agentId,
          variantId: decision.messageVariantId,
          deltaAlpha, deltaBeta, deltaWins,
        }).catch((err) => {
          console.error("[ingest/events] Failed to update UserArmStats:", err);
        }),
      ]);
    }

    // Mark as processed after successful handling
    await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch((err: unknown) => {
      if ((err as { code?: string }).code !== "P2002") {
        console.error("[ingest/events] processedEventId.create failed:", err);
      }
    });
    matched.push(event.event_id);
  }

  // Invalidate dashboard/performance caches once per batch if any conversions landed.
  // Called once (not per event) to avoid hammering the cache invalidation API.
  if (matched.length > 0) {
    revalidateTag("dashboard-stats", "max");
    revalidateTag("performance", "max");
  }

  // Persist aggregate throughput without emitting one billable Vercel log event
  // per Hightouch batch or per attributed event.
  await prisma.ingestSyncLog.create({
    data: {
      syncKind: "conversion_events",
      received: deduped.length,
      matched: matched.length,
      unmatched: unmatched.length,
      details: {
        deduplicated: events.length - deduped.length,
        event_types: [...new Set(deduped.map((e) => e.event_name))],
      },
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    received: deduped.length,
    deduplicated: events.length - deduped.length,
    matched: matched.length,
    unmatched: unmatched.length,
  });
}
