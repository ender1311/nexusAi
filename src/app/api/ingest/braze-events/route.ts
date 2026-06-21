import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { upsertArmStats, upsertUserArmStats } from "@/lib/arm-stats";
import { verifyIngestAuth } from "@/lib/ingest-auth";
import { ingestRateLimited } from "@/lib/rate-limit";

/**
 * POST /api/ingest/braze-events
 *
 * Braze Currents HTTP connector — receives real-time engagement events and
 * immediately applies click rewards to the matching UserDecision + PersonaArmStats.
 *
 * Braze Currents setup (in Braze dashboard → Currents → Create New Current):
 *   Destination: Generic HTTP endpoint
 *   Endpoint URL: https://<your-domain>/api/ingest/braze-events
 *   Authorization: Bearer <INGEST_API_KEY>
 *   Events to stream: Push Opens, Email Clicks, Content Card Clicks, In-App Message Clicks
 *
 * Payload format (Braze Currents HTTP, batched):
 * {
 *   "events": [
 *     {
 *       "event_type": "users.messages.pushnotification.Open",
 *       "id": "uuid",
 *       "time": 1234567890,
 *       "user": { "user_id": "external_user_id" },
 *       "properties": {
 *         "send_id": "send_id",
 *         "campaign_id": "campaign_id",
 *         "message_variation_id": "variant_id"
 *       }
 *     }
 *   ]
 * }
 *
 * Reward strategy:
 * - Click/tap events → immediate reward 0.8, mark decision processed
 * - Non-click events → ignored here; analytics cron handles open-no-click penalty
 * - Setting brazeAnalyticsFetchedAt prevents the analytics cron from double-processing
 */

// Push "Open" = user tapped the notification (equivalent to a click)
// Email/ContentCard/IAM "Click" = explicit link click
const CLICK_EVENTS = new Set([
  "users.messages.pushnotification.Open",
  "users.messages.email.Click",
  "users.messages.contentcard.Click",
  "users.messages.inappmessage.Click",
]);

const CLICK_REWARD = 0.8;

function verifyAuth(req: NextRequest): boolean {
  return verifyIngestAuth(req.headers);
}

type BrazeEvent = {
  id?: string;
  event_type?: string;
  name?: string;           // some Currents versions use "name" instead of "event_type"
  time?: number;
  user?: { user_id?: string };
  data?: {                 // older Currents format
    external_user_id?: string;
    send_id?: string;
    message_variation_id?: string;
    campaign_id?: string;
  };
  properties?: {           // current Currents format
    send_id?: string;
    message_variation_id?: string;
    campaign_id?: string;
  };
};

function extractFields(event: BrazeEvent): {
  eventType: string;
  userId: string;
  sendId: string;
  variantId: string;
} {
  return {
    eventType:  event.event_type ?? event.name ?? "",
    userId:     event.user?.user_id ?? event.data?.external_user_id ?? "",
    sendId:     event.properties?.send_id ?? event.data?.send_id ?? "",
    variantId:  event.properties?.message_variation_id ?? event.data?.message_variation_id ?? "",
  };
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await ingestRateLimited(req, req.headers)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let rawEvents: BrazeEvent[];
  if (Array.isArray(body)) {
    rawEvents = body as BrazeEvent[];
  } else if (
    typeof body === "object" && body !== null && "events" in body &&
    Array.isArray((body as { events: unknown }).events)
  ) {
    rawEvents = (body as { events: BrazeEvent[] }).events;
  } else if (typeof body === "object" && body !== null) {
    rawEvents = [body as BrazeEvent];
  } else {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Guard against oversized batches that could exhaust memory or DB connections
  if (rawEvents.length > 1000) {
    return NextResponse.json(
      { error: "Batch too large: maximum 1000 events per request" },
      { status: 400 }
    );
  }

  // Deduplicate by event id within the batch
  const seen = new Set<string>();
  const events = rawEvents.filter((e) => {
    if (!e.id) return true;
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Only process click/tap events — opens without clicks are handled by the analytics cron
  const clickEvents = events.filter((e) => CLICK_EVENTS.has(extractFields(e).eventType));

  if (clickEvents.length === 0) {
    await prisma.ingestSyncLog.create({
      data: {
        syncKind: "braze_events",
        received: events.length,
        matched: 0,
        unmatched: events.length,
        details: { clickable: 0, rewarded: 0 },
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, received: events.length, matched: 0, rewarded: 0 });
  }

  const now = new Date();
  // Match window: Braze Currents events fire within seconds to minutes of delivery,
  // but we allow 48h to cover delayed delivery and Hightouch sync lag.
  const matchWindowStart = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // 1. Batch: persona IDs + already-processed event IDs + unresolved decisions — all upfront
  const allUserIds = [...new Set(clickEvents.map((e) => extractFields(e).userId).filter(Boolean))];
  const allEventKeys = clickEvents.map((e) => e.id).filter((id): id is string => !!id);

  const [trackedUsers, processedRows, decisionRows] = await Promise.all([
    prisma.trackedUser.findMany({
      where: { externalId: { in: allUserIds } },
      select: { externalId: true, personaId: true },
    }),
    allEventKeys.length > 0
      ? prisma.processedEventId.findMany({
          where: { eventId: { in: allEventKeys } },
          select: { eventId: true },
        })
      : Promise.resolve([]),
    prisma.userDecision.findMany({
      where: {
        userId: { in: allUserIds },
        reward: null,
        brazeAnalyticsFetchedAt: null,
        sentAt: { gte: matchWindowStart },
      },
      orderBy: { sentAt: "desc" },
    }),
  ]);

  const personaByUserId = new Map(
    trackedUsers
      .filter((u): u is { externalId: string; personaId: string } => u.personaId !== null)
      .map((u) => [u.externalId, u.personaId])
  );
  const processedSet = new Set(processedRows.map((r) => r.eventId));
  // Most-recent unresolved decision per userId (rows already sorted desc by sentAt)
  const decisionByUserId = new Map<string, typeof decisionRows[number]>();
  for (const d of decisionRows) {
    if (!decisionByUserId.has(d.userId)) decisionByUserId.set(d.userId, d);
  }

  let matched = 0;
  let rewarded = 0;
  const newEventKeys: string[] = [];

  // 2. Process all events in parallel — per-row updates are inherently different per decision
  await Promise.all(clickEvents.map(async (event) => {
    const { eventType, userId, sendId } = extractFields(event);
    if (!userId) return;

    // Skip already-processed (idempotency)
    const eventKey = event.id;
    if (eventKey && processedSet.has(eventKey)) return;

    const decision = decisionByUserId.get(userId);
    if (!decision?.messageVariantId) {
      if (eventKey) newEventKeys.push(eventKey);
      return;
    }
    matched++;

    // Apply immediate click reward; store Braze's send_id for analytics cron compatibility
    await prisma.userDecision.update({
      where: { id: decision.id },
      data: {
        ...(sendId && { brazeSendId: sendId }),
        reward: CLICK_REWARD,
        conversionEvent: eventType,
        conversionAt: now,
        brazeAnalyticsFetchedAt: now, // prevents analytics cron from double-processing
      },
    });

    const personaId = personaByUserId.get(userId);
    await Promise.all([
      personaId
        ? upsertArmStats({
            personaId,
            agentId:    decision.agentId,
            variantId:  decision.messageVariantId,
            deltaAlpha: CLICK_REWARD,
            deltaBeta:  0,
            deltaWins:  1,
          }).catch((err) => {
            console.error("[ingest/braze-events] Failed to update PersonaArmStats:", err);
          })
        : Promise.resolve(),
      upsertUserArmStats({
        userId,
        agentId:    decision.agentId,
        variantId:  decision.messageVariantId,
        deltaAlpha: CLICK_REWARD,
        deltaBeta:  0,
        deltaWins:  1,
      }).catch((err) => {
        console.error("[ingest/braze-events] Failed to update UserArmStats:", err);
      }),
    ]);

    if (eventKey) newEventKeys.push(eventKey);
    rewarded++;
  }));

  // 3. Batch-insert all processed event IDs at once
  if (newEventKeys.length > 0) {
    await prisma.processedEventId.createMany({
      data: newEventKeys.map((eventId) => ({ eventId })),
      skipDuplicates: true,
    }).catch(() => {});
  }

  await prisma.ingestSyncLog.create({
    data: {
      syncKind: "braze_events",
      received: events.length,
      matched,
      unmatched: clickEvents.length - matched,
      details: {
        clickable: clickEvents.length,
        rewarded,
        deduplicated: rawEvents.length - events.length,
      },
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    received: events.length,
    matched,
    rewarded,
  });
}
