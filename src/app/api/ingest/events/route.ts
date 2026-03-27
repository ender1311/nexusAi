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
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return true;
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
    const windowStart = new Date(occurredAt.getTime() - 48 * 60 * 60 * 1000);

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
