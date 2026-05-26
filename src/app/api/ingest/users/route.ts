import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyPersona, BrazeAttributes } from "@/lib/engine/plan-persona-classifier";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { accumulateUserStats } from "@/lib/engine/user-stats";
import { upsertArmStats, upsertUserArmStats, updateLinUCBArm } from "@/lib/arm-stats";
import { verifyIngestAuth } from "@/lib/ingest-auth";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

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
  return verifyIngestAuth(req.headers);
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
  // Canvas-level fields from Hightouch push opens sync (sync ID 2765748)
  canvas_id?: string;
  canvas_step_id?: string;
  canvas_variation_id?: string;
  canvas_step_message_variation_id?: string;
  app_group_id?: string;
  app_id?: string;
};

/**
 * Flat Hightouch user sync row — raw column names when no Liquid template is applied.
 * Distinguishable from push open rows by the absence of last_updated_timestamp.
 * e.g. "Lapsed Habitual DAU4" sync sends: braze_user_id_latest, user_id,
 * language_tag, plan_locale_latest, newsletter_push_enabled, newsletter_email_enabled, "User Last Seen".
 */
type HtFlatUserRow = {
  user_id?: string | null;
  braze_user_id_latest?: string;
  last_seen_timestamp?: string;
  "User Last Seen"?: string;
  language_tag?: string;
  plan_locale_latest?: string;
  newsletter_push_enabled?: boolean;
  newsletter_email_enabled?: boolean;
  timezone?: string;
  funnel_stage?: string;
  [key: string]: unknown;
};

function normalizeHtFlatUserRow(row: HtFlatUserRow): UserRecord {
  const attrs: Record<string, unknown> = {};
  const lastSeen = row.last_seen_timestamp ?? row["User Last Seen"];
  if (lastSeen)                       attrs.last_seen_at    = lastSeen;
  if (row.language_tag !== undefined) attrs.language_tag    = row.language_tag;
  if (row.plan_locale_latest !== undefined) attrs.plan_locale = row.plan_locale_latest;
  if (row.newsletter_push_enabled !== undefined)  attrs.newsletter_push_enabled  = row.newsletter_push_enabled;
  if (row.newsletter_email_enabled !== undefined) attrs.newsletter_email_enabled = row.newsletter_email_enabled;
  if (row.timezone !== undefined)      attrs.timezone        = row.timezone;
  return {
    external_user_id: row.user_id?.trim() || undefined,
    braze_id: row.braze_user_id_latest?.trim() || undefined,
    attributes: attrs,
    ...(row.funnel_stage ? { funnel_stage: row.funnel_stage === "lapsed_dau" ? "lapsed_dau4" : row.funnel_stage } : {}),
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
      ...(row.canvas_id && { canvas_id: row.canvas_id }),
      ...(row.canvas_step_id && { canvas_step_id: row.canvas_step_id }),
      ...(row.canvas_variation_id && { canvas_variation_id: row.canvas_variation_id }),
      ...(row.canvas_step_message_variation_id && { canvas_step_message_variation_id: row.canvas_step_message_variation_id }),
      ...(row.app_group_id && { app_group_id: row.app_group_id }),
      ...(row.app_id && { app_id: row.app_id }),
    },
  };
}

// ── Canvas-step exact attribution ─────────────────────────────────────────
// When Hightouch delivers canvas_step_id, we can look up the exact MessageVariant
// and credit that arm directly — no time-window guessing needed.
//
// This enables passive learning: even sends NOT orchestrated by Nexus (existing
// Braze canvases) feed the Thompson sampler. An open on an exactly-identified
// variant increments alpha by 1 (positive engagement signal).

async function attributeCanvasOpen(
  event: EventRecord,
  canvasStepId: string,
  occurredAt: Date,
): Promise<boolean> {
  const variant = await prisma.messageVariant.findFirst({
    where:   { brazeCanvasStepId: canvasStepId },
    select:  { id: true, message: { select: { agentId: true } } },
  });
  if (!variant) return false;

  const { agentId } = variant.message;
  const variantId   = variant.id;

  // Try to stamp an existing decision (from a Nexus-controlled send of this variant)
  const windowStart = new Date(occurredAt.getTime() - 48 * 60 * 60 * 1000);
  const existing = await prisma.userDecision.findFirst({
    where: {
      userId: event.external_user_id,
      agentId,
      messageVariantId: variantId,
      pushOpenAt: null,
      sentAt: { gte: windowStart, lte: occurredAt },
    },
    orderBy: { sentAt: "desc" },
  });

  if (existing) {
    await prisma.userDecision.update({
      where: { id: existing.id },
      data:  { pushOpenAt: occurredAt },
    });
  } else {
    // Passive observation: record that this user was exposed to and opened this variant.
    // sentAt ≈ occurredAt (best approximation for independently-sent canvases).
    await prisma.userDecision.create({
      data: {
        userId:          event.external_user_id,
        agentId,
        messageVariantId: variantId,
        channel:         "push",
        sentAt:          occurredAt,
        pushOpenAt:      occurredAt,
        decisionContext: { source: "canvas_observed", canvas_step_id: canvasStepId },
      },
    });
  }

  // Credit the arm: push open on an exactly-attributed variant is a positive signal.
  // deltaAlpha=1 (open), deltaBeta=0 (not a failure), deltaWins=1.
  const user = await prisma.trackedUser.findFirst({
    where:  { externalId: event.external_user_id },
    select: { personaId: true },
  });

  await Promise.all([
    user?.personaId
      ? upsertArmStats({
          personaId: user.personaId, agentId, variantId,
          deltaAlpha: 1, deltaBeta: 0, deltaWins: 1,
        }).catch(() => {})
      : Promise.resolve(),
    upsertUserArmStats({
      userId: event.external_user_id, agentId, variantId,
      deltaAlpha: 1, deltaBeta: 0, deltaWins: 1,
    }).catch(() => {}),
  ]);

  return true; // handled
}

// ── Event attribution ─────────────────────────────────────────────────────
// Matches each event to the most recent unattributed UserDecision within the
// attribution window, then updates arm stats to close the learning loop.
//
// push_open events:
//   - If canvas_step_id is present → attributeCanvasOpen (exact match, updates arm stats)
//   - Otherwise → time-window match, stamps pushOpenAt only (no arm stat update)
//     so the attribution slot stays open for a subsequent goal event.
// Goal events: stamp conversionAt + run reward/arm-stats loop.

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

    // ── Canvas exact attribution (push opens only) ─────────────────────────
    if (isPushOpen) {
      const canvasStepId = typeof event.properties?.canvas_step_id === "string"
        ? event.properties.canvas_step_id
        : null;
      if (canvasStepId) {
        const handled = await attributeCanvasOpen(event, canvasStepId, occurredAt);
        if (handled) {
          await prisma.processedEventId.create({ data: { eventId: event.event_id } }).catch(() => {});
          matched++;
          continue;
        }
        // No variant found for this step ID — fall through to time-window path
      }
    }

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
      // Time-window push_open: stamp pushOpenAt only (no arm stat update — imprecise match)
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

        // LinUCB reward update: if the agent uses linucb, update the arm matrices
        if (decision.agent.algorithm === "linucb" && decision.messageVariantId) {
          const ctx = decision.decisionContext as Record<string, unknown> | null;
          const rawVec = ctx?.contextVector;
          const contextVec =
            Array.isArray(rawVec) &&
            rawVec.length === FEATURE_DIM &&
            (rawVec as number[]).every(Number.isFinite)
              ? (rawVec as number[])
              : null;
          if (contextVec) {
            await updateLinUCBArm({
              agentId: decision.agentId,
              variantId: decision.messageVariantId,
              contextVec,
              reward,
            }).catch((err) => {
              console.error("[ingest/users] Failed to update LinUCBArm:", err);
            });
          }
        }
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
    users = ((body as { users: unknown[] }).users).map((row) =>
      typeof row === "object" && row !== null &&
      "braze_user_id_latest" in row && !("external_user_id" in row) && !("braze_id" in row)
        ? normalizeHtFlatUserRow(row as HtFlatUserRow)
        : (row as UserRecord_)
    );
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
      let writeBrazeId = brazeId !== null;

      // Identity resolution: a user may have been stored as unverified (externalId = brazeId)
      // and now arrives with a real external_user_id. Re-key the old record to avoid a
      // unique constraint violation on brazeId when creating the verified record.
      if (externalUserId && brazeId && externalUserId !== brazeId) {
        const [realRecord, brazeExternalRecord, brazeOwner] = await Promise.all([
          prisma.trackedUser.findUnique({ where: { externalId: externalUserId }, select: { id: true, externalId: true } }),
          prisma.trackedUser.findUnique({ where: { externalId: brazeId }, select: { id: true, externalId: true } }),
          prisma.trackedUser.findUnique({ where: { brazeId }, select: { id: true, externalId: true } }),
        ]);

        if (brazeOwner && brazeOwner.externalId !== externalUserId && brazeOwner.externalId !== brazeId) {
          console.warn("[ingest/users] braze_id conflict; storing user without brazeId", {
            externalUserId,
            brazeId,
            existingExternalId: brazeOwner.externalId,
          });
          writeBrazeId = false;
        } else if (brazeExternalRecord && !realRecord) {
          // Promote: re-key unverified record to the real external ID.
          await prisma.trackedUser.update({ where: { externalId: brazeId }, data: { externalId: externalUserId } });
        } else if (brazeExternalRecord && realRecord) {
          // Both exist: drop the stale unverified duplicate, keep the real record.
          await prisma.trackedUser.delete({ where: { externalId: brazeId } });
        }
      }
      const raw = (user.attributes ?? {}) as Record<string, unknown>;

      const timezone = typeof raw["timezone"] === "string" && raw["timezone"].trim()
        ? raw["timezone"].trim()
        : undefined;

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

      const isLapsed = user.funnel_stage === "lapsed" || user.funnel_stage === "lapsed_mau" || user.funnel_stage === "lapsed_dau" || user.funnel_stage === "lapsed_dau4";
      const personaLabel = isLapsed ? "Re-engager" : (classifyPersona(brazeAttrs, planTags) ?? "Bible-first");
      const personaId = personaByLabel.get(personaLabel) ?? null;

      const personaData = personaId
        ? { personaId, personaConfidence: 0.8, personaAssignedAt: new Date() }
        : {};

      const funnelStageData = user.funnel_stage
        ? { funnelStage: user.funnel_stage === "lapsed_dau" ? "lapsed_dau4" : user.funnel_stage, funnelStageUpdatedAt: new Date() }
        : {};

      await prisma.trackedUser.upsert({
        where: { externalId },
        create: {
          externalId,
          ...(writeBrazeId && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...(timezone !== undefined && { timezone }),
          ...funnelStageData,
          ...personaData,
        },
        update: {
          ...(writeBrazeId && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...(timezone !== undefined && { timezone }),
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
