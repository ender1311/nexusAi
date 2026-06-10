import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyPersona, BrazeAttributes } from "@/lib/engine/plan-persona-classifier";
import { calculateReward } from "@/lib/engine/reward-calculator";
import { usdAmount } from "@/lib/engine/giving-link";
import { accumulateUserStats } from "@/lib/services/user-stats-service";
import { upsertArmStats, upsertUserArmStats, updateLinUCBArm } from "@/lib/arm-stats";
import { verifyIngestAuth } from "@/lib/ingest-auth";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";
import { isRecovery, recoveryRank } from "@/lib/engine/funnel-recovery";
import { applyConversion } from "@/lib/services/attribution-service";
import { detectFlagConversions } from "@/lib/services/interaction-conversion";
import { isInteractionFlag, normalizeFlag, detectTransitionedFlags, FLAG_ATTRIBUTION_WINDOW_MS } from "@/lib/constants/interaction-flags";

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

// Hightouch-synced booleans arrive as a real bool, a "true"/"false" string, or a
// 0/1 int depending on the warehouse column type. Returns true/false when the
// value is unambiguously present, or null when absent/blank/unrecognized — the
// null state is what distinguishes "never observed" from an explicit false, so a
// flag backfill can't be mistaken for a false→true transition.
function normalizeRecurringFlag(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1") return true;
    if (t === "false" || t === "0") return false;
  }
  return null;
}

// Hightouch user-audience syncs ship large batches in a single POST. Identity
// resolution and persona classification are batched (see below) so the whole
// payload resolves within the function timeout. Note: Vercel caps the request
// body at ~4.5MB, so very wide attribute rows may hit that ceiling before this.
const MAX_USERS_PER_BATCH = 10000;

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

/** Goal row shape returned by the flag-goal cache query. */
type FlagGoalRow = { eventName: string; conversionType: string | null };

/**
 * Returns the flag-matching goals for an agent, fetching from DB on first access
 * and caching the result for the lifetime of this request batch.
 */
async function getFlagGoals(
  agentId: string,
  cache: Map<string, FlagGoalRow[]>,
): Promise<FlagGoalRow[]> {
  const cached = cache.get(agentId);
  if (cached !== undefined) return cached;
  const rows = await prisma.goal.findMany({
    where: { agentId },
    select: { eventName: true, conversionType: true },
  });
  cache.set(agentId, rows);
  return rows;
}

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

// Top-level keys that carry identity/control semantics — never folded into
// attributes. Includes the alias columns flat column-mapping syncs use for the
// external_user_id / braze_id identity fields.
const RESERVED_USER_KEYS = new Set<string>([
  "external_user_id",
  "braze_id",
  "idempotency_key",
  "funnel_stage",
  "attributes",
  "user_id",
  "braze_user_id_latest",
  "braze_user_id",
]);

// Flat Hightouch column names → the canonical attribute keys the route reads.
const FLAT_ATTR_ALIASES: Record<string, string> = {
  last_seen_timestamp: "last_seen_at",
  "User Last Seen": "last_seen_at",
  plan_locale_latest: "plan_locale",
};

/**
 * Fold every non-reserved top-level field of a flat column-mapping row into an
 * attributes object, renaming Hightouch column aliases to the canonical keys.
 * Identity (external_user_id/braze_id) and control keys are excluded.
 */
function foldFlatAttributes(row: Record<string, unknown>): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (RESERVED_USER_KEYS.has(key) || value === undefined) continue;
    const canonical = FLAT_ATTR_ALIASES[key] ?? key;
    // A canonical alias never clobbers an explicit canonical field already present.
    if (canonical in attrs) continue;
    attrs[canonical] = value;
  }
  return attrs;
}

/**
 * Normalise a single user-sync row into a UserRecord.
 *
 * Liquid-template rows already nest their data under `attributes` and pass
 * through unchanged. Flat column-mapping rows (no nested `attributes` object —
 * e.g. the "Lapsed Habitual MAU" audience) have their top-level attribute
 * columns folded into `attributes` so none are silently dropped. funnel_stage
 * is left raw here; the upsert below applies the lapsed_dau → lapsed_dau4
 * canonicalisation for every path.
 */
function normalizeUserSyncRow(row: Record<string, unknown>): UserRecord {
  const nested = row.attributes;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return row as UserRecord;
  }
  const externalId = (row.external_user_id ?? row.user_id) as string | undefined;
  const brazeId =
    (row.braze_id ?? row.braze_user_id_latest ?? row.braze_user_id) as string | undefined;
  return {
    external_user_id: externalId?.trim() || undefined,
    braze_id: brazeId?.trim() || undefined,
    attributes: foldFlatAttributes(row),
    ...(typeof row.idempotency_key === "string"
      ? { idempotency_key: row.idempotency_key }
      : {}),
    ...(typeof row.funnel_stage === "string" ? { funnel_stage: row.funnel_stage } : {}),
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
  canonicalUserId: string,
  matchIds: string[],
): Promise<boolean> {
  const variant = await prisma.messageVariant.findFirst({
    where:   { brazeCanvasStepId: canvasStepId },
    select:  { id: true, message: { select: { agentId: true } } },
  });
  if (!variant) return false;

  const { agentId } = variant.message;
  const variantId   = variant.id;

  // Try to stamp an existing decision (from a Nexus-controlled send of this variant).
  // Match on the full id-set: a send keyed on the numeric YouVersion id and an open
  // event keyed on the 24-hex Braze id refer to the same user (see resolveEventIds).
  const windowStart = new Date(occurredAt.getTime() - 48 * 60 * 60 * 1000);
  const existing = await prisma.userDecision.findFirst({
    where: {
      userId: { in: matchIds },
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
        userId:          canonicalUserId,
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
    where:  { externalId: canonicalUserId },
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
      userId: canonicalUserId, agentId, variantId,
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

  // ── Identity bridge ────────────────────────────────────────────────────
  // Push-open events key on Braze's internal 24-hex id, but Nexus stores each
  // verified user's decisions under their numeric YouVersion id (== externalId).
  // Pre-resolve brazeId → externalId for the whole batch so the time-window match
  // can find a decision regardless of which id namespace the event arrived on.
  // (Unverified users have externalId === brazeId, so the map is a no-op for them.)
  const brazeIdCandidates = new Set<string>();
  for (const e of events) {
    const ext = e.external_user_id?.trim();
    if (ext) brazeIdCandidates.add(ext);
    const bid = typeof e.properties?.braze_user_id === "string" ? e.properties.braze_user_id.trim() : "";
    if (bid) brazeIdCandidates.add(bid);
  }
  const brazeToExternal = new Map<string, string>();
  if (brazeIdCandidates.size > 0) {
    const rows = await prisma.trackedUser.findMany({
      where: { brazeId: { in: [...brazeIdCandidates] } },
      select: { brazeId: true, externalId: true },
    });
    for (const r of rows) if (r.brazeId) brazeToExternal.set(r.brazeId, r.externalId);
  }

  // canonical = the Nexus externalId (numeric YouVersion id for verified users,
  // braze id for unverified). matchIds = every id form that could key a decision.
  const resolveEventIds = (event: EventRecord): { canonical: string; matchIds: string[] } => {
    const incoming = event.external_user_id?.trim() ?? "";
    const bid = typeof event.properties?.braze_user_id === "string" ? event.properties.braze_user_id.trim() : "";
    const canonical =
      (bid && brazeToExternal.get(bid)) ||
      (incoming && brazeToExternal.get(incoming)) ||
      incoming;
    const matchIds = [...new Set([incoming, bid, canonical].filter(Boolean))];
    return { canonical, matchIds };
  };

  // ── Batch idempotency: one query for the whole batch instead of N findUniques.
  // Newly-handled event IDs are collected and written once via createMany below,
  // so a per-event write failure can't leave an event credited-but-unmarked
  // (which would double-credit arm stats on a Hightouch retry).
  const alreadyProcessed = new Set(
    (await prisma.processedEventId.findMany({
      where: { eventId: { in: events.map((e) => e.event_id) } },
      select: { eventId: true },
    })).map((r) => r.eventId),
  );
  const newlyProcessed: string[] = [];

  for (const event of events) {
    const occurredAt = new Date(event.occurred_at);
    if (isNaN(occurredAt.getTime())) { unmatched++; continue; }

    const isPushOpen = event.event_name === "push_open";
    const { canonical: canonicalUserId, matchIds } = resolveEventIds(event);

    // ── Idempotency: skip if already processed in a previous batch ────────
    if (alreadyProcessed.has(event.event_id)) { unmatched++; continue; }

    // ── Canvas exact attribution (push opens only) ─────────────────────────
    if (isPushOpen) {
      const canvasStepId = typeof event.properties?.canvas_step_id === "string"
        ? event.properties.canvas_step_id
        : null;
      if (canvasStepId) {
        const handled = await attributeCanvasOpen(event, canvasStepId, occurredAt, canonicalUserId, matchIds);
        if (handled) {
          newlyProcessed.push(event.event_id);
          matched++;
          continue;
        }
        // No variant found for this step ID — fall through to time-window path
      }
    }

    // in_local_time sends deliver up to 12h after their UTC scheduledFor anchor (far-west
    // timezones), but the matcher windows on sentAt — so a late open could land past a flat
    // 48h sentAt window and be silently dropped. Widen the push-open lookback by that buffer,
    // mirroring LOCAL_TIME_DELIVERY_BUFFER_MS in agent-send-delivery-status.ts.
    const LOCAL_TIME_DELIVERY_BUFFER_HOURS = 12;
    const attributionHours =
      (LONG_HORIZON.has(event.event_name) ? 30 * 24 : 48) +
      (isPushOpen ? LOCAL_TIME_DELIVERY_BUFFER_HOURS : 0);
    const windowStart = new Date(occurredAt.getTime() - attributionHours * 60 * 60 * 1000);

    // push_open: also require pushOpenAt: null so we don't double-stamp the same send
    const decision = await prisma.userDecision.findFirst({
      where: {
        userId: { in: matchIds },
        conversionAt: null,
        ...(isPushOpen ? { pushOpenAt: null } : {}),
        sentAt: { gte: windowStart, lte: occurredAt },
      },
      orderBy: { sentAt: "desc" },
      include: { agent: { include: { goals: true } } },
    });

    if (!decision) {
      // Mark as processed so Hightouch retries don't re-attempt (unmatched is usually permanent)
      newlyProcessed.push(event.event_id);
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
          externalId: decision.userId,
          channel: decision.channel,
          reward,
          occurredAt,
        }).catch((err) => {
          console.error("[ingest/users] Failed to accumulate user stats:", err);
        });
      }

      if (decision.messageVariantId) {
        const user = await prisma.trackedUser.findFirst({
          where: { externalId: decision.userId },
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
            userId: decision.userId,
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
    newlyProcessed.push(event.event_id);
    matched++;
  }

  // Single batched idempotency write for the whole batch. skipDuplicates guards
  // against a race where a concurrent batch marked the same event.
  if (newlyProcessed.length > 0) {
    await prisma.processedEventId.createMany({
      data: newlyProcessed.map((eventId) => ({ eventId })),
      skipDuplicates: true,
    }).catch((err) => {
      console.error("[ingest/users] Failed to batch-write processedEventId:", err);
    });
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
    users = (body as Record<string, unknown>[]).map(normalizeUserSyncRow);
  } else if (
    typeof body === "object" && body !== null &&
    "users" in body && Array.isArray((body as Record<string, unknown>).users)
  ) {
    users = ((body as { users: unknown[] }).users).map((row) =>
      normalizeUserSyncRow(row as Record<string, unknown>)
    );
  } else if (
    typeof body === "object" && body !== null &&
    ("external_user_id" in body || "braze_id" in body || "braze_user_id_latest" in body)
  ) {
    users = [normalizeUserSyncRow(body as Record<string, unknown>)];
  } else {
    return NextResponse.json(
      { error: "Invalid payload: expected { external_user_id, attributes }, { braze_id, attributes }, or { users: [...] }" },
      { status: 400 },
    );
  }

  if (users.length > MAX_USERS_PER_BATCH) {
    return NextResponse.json(
      { error: `Batch too large: maximum ${MAX_USERS_PER_BATCH} users per request` },
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
  let unmatchedFlagConversionTotal = 0;

  // Per-request goal cache keyed by agentId — avoids re-fetching goals for the
  // same agent when multiple users in a batch are owned by the same agent.
  const flagGoalsByAgent = new Map<string, FlagGoalRow[]>();

  for (let i = 0; i < deduped.length; i += CHUNK) {
    const chunk = deduped.slice(i, i + CHUNK);

    // Pre-load candidate giving-attribution decisions for the whole chunk in one
    // query, replacing the per-user findFirst inside the parallel map below.
    // Grouped by userId, most-recent first; the in-memory window filter mirrors
    // the original per-user sentAt window.
    const chunkGivingIds = [...new Set(
      chunk
        .filter((u) => (u.attributes as Record<string, unknown> | undefined)?.["gift_amount_most_recent_timestamp"])
        .map((u) => u.external_user_id?.trim() || u.braze_id?.trim())
        .filter((id): id is string => Boolean(id)),
    )];
    const givingRows = chunkGivingIds.length > 0
      ? await prisma.userDecision.findMany({
          where: { userId: { in: chunkGivingIds }, conversionAt: null, brazeSendId: { not: null } },
          orderBy: { sentAt: "desc" },
          include: { agent: { include: { goals: true } } },
        })
      : [];
    const givingDecisionsByUser = new Map<string, typeof givingRows>();
    for (const row of givingRows) {
      const list = givingDecisionsByUser.get(row.userId) ?? [];
      list.push(row);
      givingDecisionsByUser.set(row.userId, list);
    }

    // Pre-load already-attributed gift_given conversion timestamps per user so we
    // can skip re-attributing the same gift on a later sync (dedup by giftDate).
    const attributedGiftRows = chunkGivingIds.length > 0
      ? await prisma.userDecision.findMany({
          where: { userId: { in: chunkGivingIds }, conversionEvent: "gift_given", conversionAt: { not: null } },
          select: { userId: true, conversionAt: true },
        })
      : [];
    const attributedGiftDatesByUser = new Map<string, Set<number>>();
    for (const row of attributedGiftRows) {
      if (!row.conversionAt) continue;
      const set = attributedGiftDatesByUser.get(row.userId) ?? new Set<number>();
      set.add(row.conversionAt.getTime());
      attributedGiftDatesByUser.set(row.userId, set);
    }

    // Pre-load stored funnelStage for the whole chunk so recovery detection can
    // compare stored→incoming BEFORE the upsert overwrites it. One query per chunk.
    const chunkRecoveryIds = [...new Set(
      chunk.map((u) => u.external_user_id?.trim() || u.braze_id?.trim()).filter((id): id is string => Boolean(id)),
    )];
    const storedStageRows = chunkRecoveryIds.length > 0
      ? await prisma.trackedUser.findMany({
          where: { externalId: { in: chunkRecoveryIds } },
          select: { externalId: true, funnelStage: true, hasRecurringGift: true },
        })
      : [];
    const storedStageByUser = new Map(storedStageRows.map((r) => [r.externalId, r.funnelStage]));
    // Prior observed has_recurring_gift per user — drives Sower-flip synthesis below.
    const storedRecurringByUser = new Map(storedStageRows.map((r) => [r.externalId, r.hasRecurringGift]));

    // Pre-load candidate decisions for users whose has_recurring_gift just flipped
    // false→true this sync, so a Sower subscription can be attributed to the owning
    // Nexus send. Mirrors the giving-attribution preload: most-recent unattributed
    // decision within the 30-day window, with agent goals included for reward calc.
    const SOWER_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const sowerWindowStart = new Date(Date.now() - SOWER_ATTRIBUTION_WINDOW_MS);
    const recurringFlipIds: string[] = [];
    for (const u of chunk) {
      const id = u.external_user_id?.trim() || u.braze_id?.trim();
      if (!id) continue;
      const incoming = normalizeRecurringFlag((u.attributes as Record<string, unknown> | undefined)?.["has_recurring_gift"]);
      if (incoming === true && storedRecurringByUser.get(id) === false) recurringFlipIds.push(id);
    }
    const sowerRows = recurringFlipIds.length > 0
      ? await prisma.userDecision.findMany({
          where: {
            userId: { in: recurringFlipIds },
            conversionAt: null,
            brazeSendId: { not: null },
            sentAt: { gte: sowerWindowStart },
          },
          orderBy: { sentAt: "desc" },
          include: { agent: { include: { goals: true } } },
        })
      : [];
    const sowerDecisionByUser = new Map<string, (typeof sowerRows)[number]>();
    for (const row of sowerRows) {
      if (!sowerDecisionByUser.has(row.userId)) sowerDecisionByUser.set(row.userId, row);
    }

    // Pre-load PRE-upsert attributes for users whose incoming payload carries a
    // truthy interaction flag — any_interaction credits only on a false→true
    // transition, so the detector needs the stored value from BEFORE this sync's
    // upsert overwrites it. Scoped to flag carriers to keep the query payload small.
    const flagCarrierIds = [...new Set(
      chunk
        .filter((u) => Object.entries((u.attributes ?? {}) as Record<string, unknown>)
          .some(([k, v]) => isInteractionFlag(k) && normalizeFlag(v)))
        .map((u) => u.external_user_id?.trim() || u.braze_id?.trim())
        .filter((id): id is string => Boolean(id)),
    )];
    const storedAttrRows = flagCarrierIds.length > 0
      ? await prisma.trackedUser.findMany({
          where: { externalId: { in: flagCarrierIds } },
          select: { externalId: true, attributes: true },
        })
      : [];
    const storedAttributesByUser = new Map<string, Record<string, unknown>>(
      storedAttrRows.map((r) => [
        r.externalId,
        r.attributes !== null && typeof r.attributes === "object" && !Array.isArray(r.attributes)
          ? (r.attributes as Record<string, unknown>)
          : {},
      ]),
    );

    // Pre-resolve identity records for the whole chunk in two queries instead of
    // a 3×findUnique fan-out per user. Only users that arrive with both a real
    // external_user_id and a differing braze_id need identity reconciliation.
    type IdRecord = { id: string; externalId: string };
    const externalIdLookups = new Set<string>();
    const brazeIdLookups = new Set<string>();
    for (const u of chunk) {
      const ext = u.external_user_id?.trim();
      const bid = u.braze_id?.trim();
      if (ext && bid && ext !== bid) {
        externalIdLookups.add(ext);
        externalIdLookups.add(bid); // brazeExternalRecord is keyed by externalId == brazeId
        brazeIdLookups.add(bid);
      }
    }
    const [byExternalIdRows, byBrazeIdRows] = await Promise.all([
      externalIdLookups.size > 0
        ? prisma.trackedUser.findMany({
            where: { externalId: { in: [...externalIdLookups] } },
            select: { id: true, externalId: true },
          })
        : Promise.resolve([] as IdRecord[]),
      brazeIdLookups.size > 0
        ? prisma.trackedUser.findMany({
            where: { brazeId: { in: [...brazeIdLookups] } },
            select: { id: true, externalId: true, brazeId: true },
          })
        : Promise.resolve([] as (IdRecord & { brazeId: string | null })[]),
    ]);
    const recordByExternalId = new Map<string, IdRecord>(
      byExternalIdRows.map((r) => [r.externalId, r]),
    );
    const recordByBrazeId = new Map<string, IdRecord>();
    for (const r of byBrazeIdRows) {
      if (r.brazeId) recordByBrazeId.set(r.brazeId, { id: r.id, externalId: r.externalId });
    }

    // ── Identity reconciliation pre-pass (sequential) ──────────────────────
    // A user may have been stored as unverified (externalId = brazeId) and now
    // arrives with a real external_user_id. Re-keying / dropping the stale
    // record is destructive and two users in the same chunk can target the
    // same record, so these ops run one at a time here — never inside the
    // parallel upsert map below — to avoid a concurrent-reconciliation race.
    // Produces writeBrazeId per chunk index for the parallel map to consume.
    const writeBrazeIdByIndex: boolean[] = new Array(chunk.length).fill(false);
    for (let j = 0; j < chunk.length; j++) {
      const user = chunk[j]!;
      const externalUserId = user.external_user_id?.trim() || null;
      const brazeId = user.braze_id?.trim() || null;
      let writeBrazeId = brazeId !== null;

      if (externalUserId && brazeId && externalUserId !== brazeId) {
        const realRecord = recordByExternalId.get(externalUserId) ?? null;
        const brazeExternalRecord = recordByExternalId.get(brazeId) ?? null;
        const brazeOwner = recordByBrazeId.get(brazeId) ?? null;

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
      writeBrazeIdByIndex[j] = writeBrazeId;
    }

    const results = await Promise.all(chunk.map(async (user, idx) => {
      const externalUserId = user.external_user_id?.trim() || null;
      const brazeId = user.braze_id?.trim() || null;
      // Unverified users (no external_user_id): use braze_id as the Nexus primary key.
      const externalId = externalUserId ?? brazeId!;
      const writeBrazeId = writeBrazeIdByIndex[idx]!;
      // Decisions credited by recovery/sower synthesis earlier in this same
      // iteration. Giving attribution must skip these — recovery, sower, and
      // giving all draw from the same pool of unattributed sends, so without
      // this guard one decision could be credited twice in a single sync.
      const creditedDecisionIds = new Set<string>();

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

      const isLapsed = user.funnel_stage === "lapsed" || user.funnel_stage === "lapsed_wau" || user.funnel_stage === "lapsed_mau" || user.funnel_stage === "lapsed_dau" || user.funnel_stage === "lapsed_dau4";
      const personaLabel = isLapsed ? "Re-engager" : (classifyPersona(brazeAttrs, planTags) ?? "Bible-first");
      const personaId = personaByLabel.get(personaLabel) ?? null;

      const personaData = personaId
        ? { personaId, personaConfidence: 0.8, personaAssignedAt: new Date() }
        : {};

      const funnelStageData = user.funnel_stage
        ? { funnelStage: user.funnel_stage === "lapsed_dau" ? "lapsed_dau4" : user.funnel_stage, funnelStageUpdatedAt: new Date() }
        : {};

      // Recurring-giver (Sower) state. null = not present this sync → leave column
      // untouched so a backfill or omitted attribute can't be mistaken for false.
      const incomingRecurring = normalizeRecurringFlag(raw["has_recurring_gift"]);
      const recurringData = incomingRecurring !== null ? { hasRecurringGift: incomingRecurring } : {};

      await prisma.trackedUser.upsert({
        where: { externalId },
        create: {
          externalId,
          ...(writeBrazeId && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...(timezone !== undefined && { timezone }),
          ...funnelStageData,
          ...recurringData,
          ...personaData,
        },
        update: {
          ...(writeBrazeId && { brazeId }),
          attributes,
          ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
          ...(timezone !== undefined && { timezone }),
          ...funnelStageData,
          ...recurringData,
          ...personaData,
        },
      });

      // ── Funnel-recovery detection ──────────────────────────────────────────
      // Compare the stored funnelStage (preloaded before this upsert overwrote it)
      // to the incoming normalized stage. Fault-isolated: a failure logs and never
      // breaks the non-destructive user sync.
      try {
        const incomingStage = "funnelStage" in funnelStageData ? funnelStageData.funnelStage : undefined;
        const storedStage = storedStageByUser.get(externalId) ?? null;
        if (incomingStage && storedStage && storedStage !== incomingStage && isRecovery(storedStage, incomingStage)) {
          const rank = recoveryRank(incomingStage);
          const assignment = await prisma.userAgentAssignment.findFirst({
            where: { externalUserId: externalId, releasedAt: null },
            select: { agentId: true },
          });

          let attributedAgentId: string | null = null;
          let attributedDecisionId: string | null = null;

          if (assignment) {
            // Owned: find the owning agent's most-recent unconverted decision for this user.
            const decision = await prisma.userDecision.findFirst({
              where: { userId: externalId, agentId: assignment.agentId, conversionAt: null },
              orderBy: { sentAt: "desc" },
              include: { agent: { include: { goals: true } } },
            });
            if (decision) {
              await applyConversion({
                decision,
                conversionEvent: "funnel_recovery",
                occurredAt: new Date(),
                properties: { from_stage: storedStage, to_stage: incomingStage, recovery_rank: rank },
                personaId,
              });
              attributedAgentId = assignment.agentId;
              attributedDecisionId = decision.id;
              creditedDecisionIds.add(decision.id);
            }
            // Owned-but-no-decision falls through as organic (null attribution).
          }

          await prisma.funnelTransition.create({
            data: {
              externalUserId: externalId,
              fromStage: storedStage,
              toStage: incomingStage,
              recoveryRank: rank,
              attributedAgentId,
              attributedDecisionId,
            },
          });
        }
      } catch (err) {
        console.error("[ingest/users] recovery detection failed:", err);
      }

      // ── Sower (recurring-giver) conversion synthesis ───────────────────────
      // A false→true flip on has_recurring_gift means the user just became a
      // recurring giver. Synthesize a sower_subscribed conversion against the
      // owning Nexus send (most-recent unattributed decision in the 30-day window).
      // Only false→true fires — a null/unknown→true first observation (e.g. the
      // initial column backfill) is ignored so it can't manufacture conversions.
      // Fault-isolated: a failure logs and never breaks the user sync.
      try {
        if (incomingRecurring === true && storedRecurringByUser.get(externalId) === false) {
          const decision = sowerDecisionByUser.get(externalId) ?? null;
          if (decision) {
            await applyConversion({
              decision,
              conversionEvent: "sower_subscribed",
              occurredAt: new Date(),
              personaId,
            });
            creditedDecisionIds.add(decision.id);
          }
        }
      } catch (err) {
        console.error("[ingest/users] sower synthesis failed:", err);
      }

      // ── Interaction-flag conversion detection ─────────────────────────────
      // When a *_has_ever_flag attribute arrives as true and the user is owned by
      // an agent with a matching goal, credit the conversion.
      //
      // Pre-filter: skip entirely if no incoming attribute is a truthy interaction
      // flag — avoids extra DB queries for the common case where no flags are present.
      // Fault-isolated per-user: one failure must never abort the batch.
      let unmatchedFlagConversions = 0;
      try {
        const hasTruthyFlag = Object.entries(raw).some(
          ([k, v]) => isInteractionFlag(k) && normalizeFlag(v),
        );
        if (hasTruthyFlag) {
          // Hoist pre-upsert stored attributes so both the active-path and the
          // tail path share the same snapshot (PRE-upsert, before the trackedUser
          // upsert above overwrote them). A brand-new user has no stored row → {}.
          const storedAttrs = storedAttributesByUser.get(externalId) ?? {};

          // Track which flags the active-path has taken responsibility for so the
          // tail path never double-fires on the same flag in the same sync.
          const handledFlags = new Set<string>();

          const flagAssignment = await prisma.userAgentAssignment.findFirst({
            where: { externalUserId: externalId, releasedAt: null },
            select: { agentId: true, enrollmentFlags: true },
          });
          if (flagAssignment) {
            const { agentId: owningAgentId, enrollmentFlags: rawEnrollment } = flagAssignment;
            // Tolerant parse: corrupt/missing enrollmentFlags → null, so Type-A
            // detection falls back to the pre-upsert stored attributes instead of
            // an all-false baseline that would credit pre-enrollment engagement
            // as a "first interaction" (2026-06-09 audit, I1).
            const enrollmentFlags: Record<string, unknown> | null =
              rawEnrollment !== null &&
              typeof rawEnrollment === "object" &&
              !Array.isArray(rawEnrollment)
                ? (rawEnrollment as Record<string, unknown>)
                : null;

            // Goals are not cached yet for this agentId scope — fetch once per owned user.
            // (Agents with no flag goals are skipped quickly by detectFlagConversions.)
            const flagGoals = await getFlagGoals(owningAgentId, flagGoalsByAgent);

            const creditedFlags = detectFlagConversions({
              incoming: raw,
              // PRE-upsert attributes (preloaded per-chunk before the trackedUser
              // upsert above overwrote them) — any_interaction credits only on a
              // false→true transition. A brand-new user has no stored row → {}.
              stored: storedAttrs,
              enrollmentFlags,
              goals: flagGoals,
            });

            // When a user is actively owned by an agent, that agent is authoritative
            // for any flag it has a goal for — whether it credits or deliberately
            // rejects (e.g., first_interaction blocked by an already-true baseline).
            // Mark every transition for a flag the owner has a goal for as handled,
            // so the tail path never second-guesses that decision. Flags with no
            // matching owner goal are left unhandled so the tail can still credit
            // a different agent that has a goal for that flag.
            for (const f of detectTransitionedFlags(raw, storedAttrs)) {
              if (flagGoals.some((g) => g.eventName === f)) {
                handledFlags.add(f);
              }
            }

            // Each credited flag independently attributes to the most recent remaining
            // unconverted decision, so two flags flipping in one sync may consume two
            // decisions. When decisions run out, remaining flags are tallied as unmatched.
            // Only the no-decision case is unmatched; an already-credited decision ID
            // means this sync already consumed that slot — skip silently, don't count it.
            for (const flagName of creditedFlags) {
              const flagDecision = await prisma.userDecision.findFirst({
                where: { userId: externalId, agentId: owningAgentId, conversionAt: null },
                orderBy: { sentAt: "desc" },
                include: { agent: { include: { goals: true } } },
              });
              if (flagDecision === null) {
                // No unconverted decision exists — flag fired but there was no prior send.
                unmatchedFlagConversions++;
              } else if (!creditedDecisionIds.has(flagDecision.id)) {
                await applyConversion({
                  decision: flagDecision,
                  conversionEvent: flagName,
                  occurredAt: new Date(),
                  personaId,
                });
                creditedDecisionIds.add(flagDecision.id);
              }
              // else: this decision was already credited in an earlier loop iteration —
              // skip silently; it is not an unmatched conversion.
            }
          }

          // ── 30-day tail attribution ──────────────────────────────────────────
          // A flip after release (segment_exit, hold cap, manual) — or after the
          // assignment row was overwritten by another agent — still credits the
          // most recent unconverted decision within FLAG_ATTRIBUTION_WINDOW_MS
          // whose agent has a goal for that flag (most recent send wins). Requires
          // an observed false/absent → true transition vs pre-upsert attributes:
          // the enrollment baseline may no longer exist, so an already-true stored
          // flag never tail-credits. applyConversion scopes release-on-conversion
          // to the credited agentId, so a tail credit never releases a user from
          // a different agent that currently owns them.
          for (const flagName of detectTransitionedFlags(raw, storedAttrs)) {
            if (handledFlags.has(flagName)) continue;
            const tailDecision = await prisma.userDecision.findFirst({
              where: {
                userId: externalId,
                conversionAt: null,
                sentAt: { gte: new Date(Date.now() - FLAG_ATTRIBUTION_WINDOW_MS) },
                agent: { goals: { some: { eventName: flagName, conversionType: { not: null } } } },
              },
              orderBy: { sentAt: "desc" },
              include: { agent: { include: { goals: true } } },
            });
            if (tailDecision !== null && !creditedDecisionIds.has(tailDecision.id)) {
              await applyConversion({
                decision: tailDecision,
                conversionEvent: flagName,
                occurredAt: new Date(),
                personaId,
              });
              creditedDecisionIds.add(tailDecision.id);
            }
            // No qualifying decision = organic flip with no recent Nexus send —
            // intentionally not counted as "unmatched" (that tally is owner telemetry).
          }
        }
      } catch (err) {
        console.error("[ingest/users] interaction-flag conversion failed:", err);
      }

      // ── Giving conversion attribution ──────────────────────────────────────
      // When Hightouch syncs gift_amount_most_recent_timestamp and it's a new
      // gift within the 30-day attribution window after a Nexus send, attribute
      // a gift_given conversion to that decision.
      const giftTimestampRaw = raw["gift_amount_most_recent_timestamp"];
      if (giftTimestampRaw) {
        if (typeof giftTimestampRaw !== "string" && typeof giftTimestampRaw !== "number") {
          // skip — unexpected type, can't construct a valid Date
        } else {
        const giftDate = new Date(giftTimestampRaw);
        if (!isNaN(giftDate.getTime())) {
          const GIVING_ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
          const windowStart = new Date(giftDate.getTime() - GIVING_ATTRIBUTION_WINDOW_MS);

          // Most-recent unattributed decision within the window, from the chunk
          // pre-load (candidates are already sorted sentAt desc).
          // Dedup: if this exact gift (by timestamp) was already attributed for
          // this user on a prior sync, skip — never attribute one gift twice.
          const alreadyAttributed =
            attributedGiftDatesByUser.get(externalId)?.has(giftDate.getTime()) ?? false;

          const decision = alreadyAttributed
            ? null
            : (givingDecisionsByUser.get(externalId) ?? [])
                .find((d) => d.sentAt >= windowStart && d.sentAt <= giftDate && !creditedDecisionIds.has(d.id)) ?? null;

          if (decision) {
            const giftAmount =
              typeof raw["gift_amount_most_recent"] === "number"
                ? raw["gift_amount_most_recent"]
                : null;
            const giftCurrency =
              typeof raw["gift_currency_most_recent"] === "string"
                ? raw["gift_currency_most_recent"]
                : null;
            const usd = giftAmount !== null ? usdAmount(giftAmount, giftCurrency) : 0;

            const reward = calculateReward(
              "gift_given",
              decision.agent.goals as Parameters<typeof calculateReward>[1],
              { gift_amount_usd: usd, gift_amount_most_recent: giftAmount },
            );

            await prisma.userDecision.update({
              where: { id: decision.id },
              data: {
                conversionEvent: "gift_given",
                conversionAt: giftDate,
                conversionValue: usd > 0 ? usd : null,
                reward: reward !== 0 ? reward : null,
              },
            }).catch((err) => {
              console.error("[ingest/users] Failed to write giving conversion attribution:", err);
            });

            if (reward !== 0) {
              await accumulateUserStats({
                externalId,
                channel: decision.channel,
                reward,
                occurredAt: giftDate,
              }).catch((err) => {
                console.error("[ingest/users] Failed to accumulate user stats (gift_given):", err);
              });

              if (decision.messageVariantId) {
                const deltaAlpha = reward > 0 ? reward : 0;
                const deltaBeta  = reward <= 0 ? 1 : 0;
                const deltaWins  = reward > 0 ? 1 : 0;

                await Promise.all([
                  personaId
                    ? upsertArmStats({
                        personaId,
                        agentId: decision.agentId,
                        variantId: decision.messageVariantId,
                        deltaAlpha, deltaBeta, deltaWins,
                      }).catch((err) => {
                        console.error("[ingest/users] Failed to update PersonaArmStats (gift_given):", err);
                      })
                    : Promise.resolve(),
                  upsertUserArmStats({
                    userId: externalId,
                    agentId: decision.agentId,
                    variantId: decision.messageVariantId,
                    deltaAlpha, deltaBeta, deltaWins,
                  }).catch((err) => {
                    console.error("[ingest/users] Failed to update UserArmStats (gift_given):", err);
                  }),
                ]);

                if (decision.agent.algorithm === "linucb") {
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
                      console.error("[ingest/users] Failed to update LinUCBArm (gift_given):", err);
                    });
                  }
                }
              }
            }
          }
        }
        } // end else (giftTimestampRaw is string | number)
      }

      return { upserted: 1, assigned: personaId ? 1 : 0, unmatchedFlagConversions };
    }));

    for (const r of results) {
      upserted += r.upserted;
      assigned += r.assigned;
      unmatchedFlagConversionTotal += r.unmatchedFlagConversions;
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
        ...(unmatchedFlagConversionTotal > 0 && { unmatched_flag_conversions: unmatchedFlagConversionTotal }),
      },
    },
  }).catch(() => {});

  return NextResponse.json(responseBody, { status: 200 });
}
