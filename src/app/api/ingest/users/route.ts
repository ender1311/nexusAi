import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyPersona, BrazeAttributes } from "@/lib/engine/plan-persona-classifier";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { accumulateUserStats } from "@/lib/engine/user-stats";
import { upsertArmStats, upsertUserArmStats } from "@/lib/arm-stats";

/**
 * POST /api/ingest/users
 *
 * Multiplex endpoint — handles two payload shapes from Hightouch:
 *
 * 1. User sync (Liquid template):
 *    { users: [{ external_user_id, braze_id, attributes }] }
 *    Upserts TrackedUser rows and assigns personas.
 *
 * 2a. Push open events (Liquid template):
 *    { events: [{ event_id, event_name, external_user_id, occurred_at, properties }] }
 *    Attributes a push_open reward to the matching UserDecision.
 *
 * 2b. Push open events (column-mapping / flat rows):
 *    { user_id, braze_user_id, campaign_id, event_timestamp, timezone }
 *    OR array of the above. Normalised internally to the events format.
 *
 * Unverified users (no external_user_id): use braze_id / braze_user_id as the
 * Nexus externalId — consistent with how select-and-send targets them via recipients[].
 */

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.HIGHTOUCH_API_KEY ?? process.env.INGEST_API_KEY;
  if (!expected) return false;
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return token === expected;
}

// ── Types ─────────────────────────────────────────────────────────────────

type UserRecord = {
  external_user_id?: string;
  braze_id?: string;
  idempotency_key?: string;
  funnel_stage?: string;
  attributes?: Record<string, unknown>;
};

type EventRecord = {
  event_id: string;
  event_name: string;
  external_user_id: string;
  occurred_at: string;
  properties?: Record<string, unknown>;
};

/** Flat push-open row from Hightouch column-mapping sync */
type PushOpenRow = {
  user_id?: string | null;
  braze_user_id?: string;
  braze_user_id_latest?: string;   // Hightouch audience sync without Liquid template
  last_updated_timestamp?: string | null; // present in push open rows; absent in user sync rows
  push_notification_event_id?: string;   // Hightouch primary key — use as idempotency key
  campaign_id?: string;
  event_timestamp?: string;
  event_type?: string;             // e.g. "push_open" — column from Hightouch model
  "User Last Seen"?: string;       // Hightouch audience sync column name
  timezone?: string;
};

/**
 * Flat Hightouch user sync row — raw column names when no Liquid template is applied.
 * Distinguishable from push open rows by the absence of last_updated_timestamp.
 * e.g. "Lapsed Habitual DAU4" sync sends: braze_user_id_latest, user_id,
 * language_tag, plan_locale_latest, push_enabled, "Email Enabled", "User Last Seen".
 */
type HtFlatUserRow = {
  user_id?: string | null;
  braze_user_id_latest?: string;
  "User Last Seen"?: string;
  language_tag?: string;
  plan_locale_latest?: string;
  push_enabled?: boolean;
  "Email Enabled"?: boolean;
  funnel_stage?: string;
  [key: string]: unknown;
};

function normalizeHtFlatUserRow(row: HtFlatUserRow): UserRecord {
  const attrs: Record<string, unknown> = {};
  if (row["User Last Seen"])          attrs.last_seen_at    = row["User Last Seen"];
  if (row.language_tag !== undefined) attrs.language_tag    = row.language_tag;
  if (row.plan_locale_latest !== undefined) attrs.plan_locale = row.plan_locale_latest;
  if (row.push_enabled !== undefined) attrs.push_enabled    = row.push_enabled;
  if (row["Email Enabled"] !== undefined) attrs.email_enabled = row["Email Enabled"];
  return {
    external_user_id: row.user_id?.trim() || undefined,
    braze_id: row.braze_user_id_latest?.trim() || undefined,
    attributes: attrs,
    ...(row.funnel_stage ? { funnel_stage: row.funnel_stage } : {}),
  };
}

// ── Payload kind detection ────────────────────────────────────────────────

type PayloadKind = "user_sync" | "events" | "push_open_rows";

function detectKind(body: unknown): PayloadKind | null {
  if (typeof body !== "object" || body === null) return null;

  if (Array.isArray(body)) {
    const first = body[0] as Record<string, unknown> | undefined;
    if (!first) return "user_sync"; // empty → treat as user sync no-op
    if ("event_name" in first || "event_id" in first) return "events";
    if (
      "event_timestamp" in first ||
      ("user_id" in first && "campaign_id" in first && !("external_user_id" in first))
    ) return "push_open_rows";
    return "user_sync";
  }

  const b = body as Record<string, unknown>;
  if ("users" in b && Array.isArray(b.users)) return "user_sync";
  if ("events" in b && Array.isArray(b.events)) return "events";

  // Single flat object
  if ("event_name" in b || "event_id" in b) return "events";
  if (
    "event_timestamp" in b ||
    // push open rows have last_updated_timestamp; user sync rows do not
    ("braze_user_id_latest" in b && "last_updated_timestamp" in b) ||
    ("user_id" in b && "campaign_id" in b && !("external_user_id" in b) && !("braze_id" in b))
  ) return "push_open_rows";
  if ("external_user_id" in b || "braze_id" in b || "braze_user_id_latest" in b) return "user_sync";

  return null;
}

// ── Push-open row → EventRecord normalisation ─────────────────────────────

function pushOpenToEvent(row: PushOpenRow): EventRecord | null {
  // Accept both field name variants from different Hightouch sync configs.
  const brazeId    = row.braze_user_id?.trim() || row.braze_user_id_latest?.trim();
  const occurredAt = row.event_timestamp?.trim() || row["User Last Seen"]?.trim();
  // Verified users: externalId = user_id. Unverified: externalId = brazeId.
  const externalId = row.user_id?.trim() || brazeId;
  if (!externalId || !occurredAt) return null;
  return {
    // Prefer the Hightouch primary key (push_notification_event_id) as the idempotency key.
    // Fall back to a synthetic composite for legacy flat rows that don't include it.
    event_id: row.push_notification_event_id?.trim() || `${brazeId ?? externalId}:${occurredAt}`,
    event_name: "push_open",
    external_user_id: externalId,
    occurred_at: occurredAt,
    properties: {
      ...(row.timezone && { timezone: row.timezone }),
      ...(row.campaign_id && { campaign_id: row.campaign_id }),
      ...(brazeId && { braze_user_id: brazeId }),
    },
  };
}

// ── Event attribution ─────────────────────────────────────────────────────
// Mirrors the logic in /api/ingest/events — matches each event to the most
// recent unattributed UserDecision within the attribution window, then
// updates arm stats to close the learning loop.
//
// push_open events are handled specially:
//   - Stamped on pushOpenAt (not conversionAt) so the attribution slot stays open
//     for a subsequent goal event (plan_started, etc.) from the same send.
//   - Arm stats are NOT updated for push_opens — they are pure engagement signals.
//     Goal events drive the learning loop.

async function attributeEvents(
  events: EventRecord[],
): Promise<{ matched: number; unmatched: number }> {
  const LONG_HORIZON = new Set(["plan_completed", "plan_read_day_3", "plan_read_day_7"]);
  let matched = 0;
  let unmatched = 0;

  for (const event of events) {
    const occurredAt = new Date(event.occurred_at);
    if (isNaN(occurredAt.getTime())) { unmatched++; continue; }

    const isPushOpen = event.event_name === "push_open";

    // ── Idempotency: skip if already processed in a previous batch ────────
    const alreadyProcessed = await prisma.processedEventId.findUnique({
      where: { eventId: event.event_id },
    });
    if (alreadyProcessed) { unmatched++; continue; }

    const attributionHours = LONG_HORIZON.has(event.event_name) ? 30 * 24 : 48;
    const windowStart = new Date(occurredAt.getTime() - attributionHours * 60 * 60 * 1000);

    // push_open: also require pushOpenAt: null so we don't double-stamp the same send
    const decision = await prisma.userDecision.findFirst({
      where: {
        userId: event.external_user_id,
        conversionAt: null,
        ...(isPushOpen ? { pushOpenAt: null } : {}),
        sentAt: { gte: windowStart, lte: occurredAt },
      },
      orderBy: { sentAt: "desc" },
      include: { agent: { include: { goals: true } } },
    });

    if (!decision) {
      // Mark as processed so Hightouch retries don't re-attempt (unmatched is usually permanent)
      await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch(() => {});
      unmatched++;
      continue;
    }

    if (isPushOpen) {
      // push_open: stamp pushOpenAt only — leave conversionAt null so a goal event can still claim this slot
      await prisma.userDecision.update({
        where: { id: decision.id },
        data: { pushOpenAt: occurredAt },
      });
    } else {
      // Goal event: stamp conversionAt and run the reward/arm-stats loop
      const reward = calculateReward(
        event.event_name,
        decision.agent.goals as Parameters<typeof calculateReward>[1],
        event.properties,
      );

      await prisma.userDecision.update({
        where: { id: decision.id },
        data: {
          conversionEvent: event.event_name,
          conversionAt: occurredAt,
          reward: reward !== 0 ? reward : null,
        },
      });

      if (reward !== 0) {
        await accumulateUserStats({
          externalId: event.external_user_id,
          channel: decision.channel,
          reward,
          occurredAt,
        }).catch((err) => {
          console.error("[ingest/users] Failed to accumulate user stats:", err);
        });
      }

      if (decision.messageVariantId) {
        const user = await prisma.trackedUser.findFirst({
          where: { externalId: event.external_user_id },
          select: { personaId: true },
        });
        const deltaAlpha = reward > 0 ? reward : 0;
        const deltaBeta  = reward <= 0 ? 1 : 0;
        const deltaWins  = reward > 0 ? 1 : 0;
        await Promise.all([
          user?.personaId
            ? upsertArmStats({
                personaId: user.personaId,
                agentId: decision.agentId,
                variantId: decision.messageVariantId,
                deltaAlpha, deltaBeta, deltaWins,
              }).catch((err) => {
                console.error("[ingest/users] Failed to update PersonaArmStats:", err);
              })
            : Promise.resolve(),
          upsertUserArmStats({
            userId: event.external_user_id,
            agentId: decision.agentId,
            variantId: decision.messageVariantId,
            deltaAlpha, deltaBeta, deltaWins,
          }).catch((err) => {
            console.error("[ingest/users] Failed to update UserArmStats:", err);
          }),
        ]);
        console.log(
          `[ingest/users] reward attributed: event=${event.event_name} userId=${event.external_user_id} deltaAlpha=${deltaAlpha} deltaBeta=${deltaBeta}`,
        );
      }
    }

    // Mark as processed after successful handling
    await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch(() => {});
    matched++;
  }

  return { matched, unmatched };
}

// ── Main handler ──────────────────────────────────────────────────────────

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

  const kind = detectKind(body);
  if (kind === null) {
    return NextResponse.json(
      { error: "Invalid payload: expected user sync ({ users: [...] }) or push open event ({ events: [...] } or flat row)" },
      { status: 400 },
    );
  }

  // ── Push open events ────────────────────────────────────────────────────
  if (kind === "events" || kind === "push_open_rows") {
    let rawItems: unknown[];
    if (Array.isArray(body)) rawItems = body;
    else if (typeof body === "object" && body !== null && "events" in body) {
      rawItems = (body as { events: unknown[] }).events;
    } else {
      rawItems = [body];
    }

    if (rawItems.length > 1000) {
      return NextResponse.json(
        { error: "Batch too large: maximum 1000 events per request" },
        { status: 400 },
      );
    }

    let events: EventRecord[];
    if (kind === "push_open_rows") {
      events = (rawItems as PushOpenRow[])
        .map(pushOpenToEvent)
        .filter((e): e is EventRecord => e !== null);
    } else {
      events = rawItems as EventRecord[];
    }

    // Deduplicate by event_id within this batch
    const seen = new Set<string>();
    const deduped = events.filter((e) => {
      if (!e.event_id || seen.has(e.event_id)) return false;
      seen.add(e.event_id);
      return true;
    });

    console.log(`[ingest/users] Attributing ${deduped.length} events (kind=${kind})`);
    const { matched, unmatched } = await attributeEvents(deduped);

    // Write sync log (non-critical — don't let a log failure break the response)
    await prisma.ingestSyncLog.create({
      data: {
        syncKind: "push_open_events",
        received: deduped.length,
        matched,
        unmatched,
        details: { kind, deduplicated: events.length - deduped.length },
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      received: deduped.length,
      deduplicated: events.length - deduped.length,
      matched,
      unmatched,
    });
  }

  // ── User sync ───────────────────────────────────────────────────────────

  type UserRecord_ = UserRecord;
  let users: UserRecord_[];
  if (Array.isArray(body)) {
    // Array may be flat HtFlatUserRow objects or standard UserRecord objects
    users = (body as HtFlatUserRow[]).map((row) =>
      "braze_user_id_latest" in row && !("external_user_id" in row) && !("braze_id" in row)
        ? normalizeHtFlatUserRow(row)
        : (row as unknown as UserRecord_)
    );
  } else if (
    typeof body === "object" && body !== null &&
    "users" in body && Array.isArray((body as Record<string, unknown>).users)
  ) {
    users = (body as { users: UserRecord_[] }).users;
  } else if (
    typeof body === "object" && body !== null &&
    ("external_user_id" in body || "braze_id" in body)
  ) {
    users = [body as UserRecord_];
  } else if (
    typeof body === "object" && body !== null &&
    "braze_user_id_latest" in body
  ) {
    // Flat Hightouch user sync row (e.g. Lapsed Habitual DAU4 audience)
    users = [normalizeHtFlatUserRow(body as HtFlatUserRow)];
  } else {
    return NextResponse.json(
      { error: "Invalid payload: expected { external_user_id, attributes }, { braze_id, attributes }, or { users: [...] }" },
      { status: 400 },
    );
  }

  if (users.length > 1000) {
    return NextResponse.json(
      { error: "Batch too large: maximum 1000 users per request" },
      { status: 400 },
    );
  }

  const skippedAnon = users.filter((u) => !u.external_user_id?.trim() && !u.braze_id?.trim()).length;
  const identified = users.filter((u) => !!(u.external_user_id?.trim() || u.braze_id?.trim()));
  if (identified.length === 0) {
    return NextResponse.json({ ok: true, upserted: 0, skipped_anonymous: skippedAnon });
  }

  const seen = new Set<string>();
  const deduped = identified.filter((u) => {
    const key = u.idempotency_key ?? u.external_user_id?.trim() ?? u.braze_id!.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[ingest/users] Upserting ${deduped.length} user profiles`);

  // ── Bulk-load classification data for the whole batch ────────────────────
  const planIds = [...new Set(
    deduped
      .map((u) => (u.attributes?.plan_day_last_plan_id as string | undefined))
      .filter((id): id is string => Boolean(id))
  )];

  const planTagMap = new Map<string, string[]>();
  if (planIds.length > 0) {
    const memberships = await prisma.planSetMember.findMany({
      where: { planId: { in: planIds } },
      select: { planId: true, planSet: { select: { personaTag: true } } },
    });
    for (const m of memberships) {
      const tags = planTagMap.get(m.planId) ?? [];
      tags.push(m.planSet.personaTag);
      planTagMap.set(m.planId, tags);
    }
  }

  const personas = await prisma.persona.findMany({
    select: { id: true, label: true },
  });
  const personaByLabel = new Map(
    personas
      .filter((p): p is { id: string; label: string } => p.label !== null)
      .map((p) => [p.label, p.id])
  );

  // ── Upsert all users in parallel (chunked to avoid connection pool exhaustion) ─
  const CHUNK = 50;
  let upserted = 0;
  let assigned = 0;

  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(async (user) => {
      const externalUserId = user.external_user_id?.trim() || null;
      const brazeId = user.braze_id?.trim() || null;
      // Unverified users (no external_user_id): use braze_id as the Nexus primary key.
      const externalId = externalUserId ?? brazeId!;
      const raw = (user.attributes ?? {}) as Record<string, unknown>;

      let preferredSendHour: number | undefined;
      let preferredSendMinute: number | undefined;
      if (raw["last_seen_at"] && typeof raw["last_seen_at"] === "string") {
        const lastSeen = new Date(raw["last_seen_at"]);
        if (!isNaN(lastSeen.getTime())) {
          const ms = Date.now() - lastSeen.getTime();
          raw["hours_since_last_open"] = Math.round(ms / (1000 * 60 * 60));
          raw["days_since_last_open"] = Math.round(ms / (1000 * 60 * 60 * 24));
          preferredSendHour = lastSeen.getUTCHours();
          preferredSendMinute = lastSeen.getUTCMinutes();
        }
      }

      const attributes = raw as unknown as object;

      const brazeAttrs: BrazeAttributes = {
        plan_day_last_plan_id:        raw["plan_day_last_plan_id"] as string | null,
        plan_day_last_plan_length:    raw["plan_day_last_plan_length"] as number | null,
        plan_day_last_plan_publisher: raw["plan_day_last_plan_publisher"] as string | null,
        plan_day_current_year_count:  raw["plan_day_current_year_count"] as number | null,
        plan_day_current_month_count: raw["plan_day_current_month_count"] as number | null,
        plan_day_year:                raw["plan_day_year"] as string | null,
        plan_finish_lifetime_count:   raw["plan_finish_lifetime_count"] as number | null,
        gp_current_year_count:        raw["gp_current_year_count"] as number | null,
        gs_current_year_count:        raw["gs_current_year_count"] as number | null,
        badge_current_year_count:     raw["badge_current_year_count"] as number | null,
      };

      const planId = brazeAttrs.plan_day_last_plan_id ?? null;
      const planTags = planId ? (planTagMap.get(planId) ?? []) : [];

      const isLapsed = user.funnel_stage === "lapsed" || user.funnel_stage === "lapsed_mau";
      const personaLabel = isLapsed ? "Re-engager" : (classifyPersona(brazeAttrs, planTags) ?? "Bible-first");
      const personaId = personaByLabel.get(personaLabel) ?? null;

      const personaData = personaId
        ? { personaId, personaConfidence: 0.8, personaAssignedAt: new Date() }
        : {};

      const funnelStageData = user.funnel_stage
        ? { funnelStage: user.funnel_stage, funnelStageUpdatedAt: new Date() }
        : {};

      await prisma.trackedUser.upsert({
        where: { externalId },
        create: {
          externalId,
          ...(brazeId !== null && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...funnelStageData,
          ...personaData,
        },
        update: {
          ...(brazeId !== null && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...funnelStageData,
          ...personaData,
        },
      });

      return { upserted: 1, assigned: personaId ? 1 : 0 };
    }));

    for (const r of results) {
      upserted += r.upserted;
      assigned += r.assigned;
    }
  }

  const responseBody = {
    ok: true,
    received: deduped.length,
    deduplicated: identified.length - deduped.length,
    skipped_anonymous: skippedAnon,
    upserted,
    persona_assigned: assigned,
  };

  // Write sync log (non-critical)
  await prisma.ingestSyncLog.create({
    data: {
      syncKind: "user_sync",
      received: deduped.length,
      upserted,
      details: {
        deduplicated: identified.length - deduped.length,
        skipped_anonymous: skippedAnon,
        persona_assigned: assigned,
      },
    },
  }).catch(() => {});

  return NextResponse.json(responseBody, { status: 200 });
}
