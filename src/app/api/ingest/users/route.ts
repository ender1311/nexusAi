import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { classifyPersona, BrazeAttributes } from "@/lib/engine/plan-persona-classifier";

/**
 * POST /api/ingest/users
 *
 * Hightouch HTTP Request destination for user profile data.
 *
 * Expected payload shape:
 * {
 *   idempotency_key?: string,
 *   external_user_id: string,
 *   attributes: { [key: string]: string | number | boolean | null }
 * }
 *
 * Or batch format:
 * { users: Array<{ external_user_id, attributes }> }
 */

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.HIGHTOUCH_API_KEY ?? process.env.INGEST_API_KEY;
  if (!expected) return false; // Require key to be configured — never open to all
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  return token === expected;
}

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

  type UserRecord = { external_user_id?: string; idempotency_key?: string; attributes?: Record<string, unknown> };

  let users: UserRecord[];
  if (Array.isArray(body)) {
    users = body;
  } else if (typeof body === "object" && body !== null && "users" in body && Array.isArray((body as Record<string, unknown>).users)) {
    users = (body as { users: UserRecord[] }).users;
  } else if (typeof body === "object" && body !== null && "external_user_id" in body) {
    users = [body as UserRecord];
  } else {
    return NextResponse.json({ error: "Invalid payload: expected { external_user_id, attributes } or { users: [...] }" }, { status: 400 });
  }

  const invalid = users.filter((u) => !u.external_user_id);
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Each user record must have external_user_id", invalid_count: invalid.length },
      { status: 400 }
    );
  }

  const seen = new Set<string>();
  const deduped = users.filter((u) => {
    const key = u.idempotency_key ?? u.external_user_id!;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[ingest/users] Upserting ${deduped.length} user profiles`);

  // ── Bulk-load classification data for the whole batch ────────────────────
  // Collect all unique plan IDs from the batch
  const planIds = [...new Set(
    deduped
      .map((u) => (u.attributes?.plan_day_last_plan_id as string | undefined))
      .filter((id): id is string => Boolean(id))
  )];

  // One query: plan_id → persona tags (via PlanSetMember + PlanSet)
  const planTagMap = new Map<string, string[]>(); // planId → personaTags[]
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

  // Load all personas once (label → id map)
  const personas = await prisma.persona.findMany({
    select: { id: true, label: true },
  });
  const personaByLabel = new Map(
    personas
      .filter((p): p is { id: string; label: string } => p.label !== null)
      .map((p) => [p.label, p.id])
  );

  // ── Upsert each user ─────────────────────────────────────────────────────
  let upserted = 0;
  let assigned = 0;

  for (const user of deduped) {
    const externalId = user.external_user_id!;
    const raw = (user.attributes ?? {}) as Record<string, unknown>;

    // Derive days_since_last_open from last_seen_at if present
    let preferredSendHour: number | undefined;
    let preferredSendMinute: number | undefined;
    if (raw["last_seen_at"] && typeof raw["last_seen_at"] === "string") {
      const lastSeen = new Date(raw["last_seen_at"]);
      if (!isNaN(lastSeen.getTime())) {
        const ms = Date.now() - lastSeen.getTime();
        raw["hours_since_last_open"] = Math.round(ms / (1000 * 60 * 60));
        raw["days_since_last_open"] = Math.round(ms / (1000 * 60 * 60 * 24));
        // Store preferred send time fields separately for the upsert (not in attributes JSON)
        preferredSendHour = lastSeen.getUTCHours();
        preferredSendMinute = lastSeen.getUTCMinutes();
      }
    }

    const attributes = raw as unknown as object;

    // ── Persona classification ─────────────────────────────────────────────
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
    const personaLabel = classifyPersona(brazeAttrs, planTags);
    const personaId = personaLabel ? (personaByLabel.get(personaLabel) ?? null) : null;

    const personaData = personaId
      ? { personaId, personaConfidence: 0.8, personaAssignedAt: new Date() }
      : {};

    await prisma.trackedUser.upsert({
      where: { externalId },
      create: {
        externalId,
        attributes,
        ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
        ...personaData,
      },
      update: {
        attributes,
        ...(preferredSendHour !== undefined && { preferredSendHour, preferredSendMinute }),
        ...personaData,
      },
    });

    upserted++;
    if (personaId) assigned++;
  }

  return NextResponse.json(
    {
      ok: true,
      received: deduped.length,
      deduplicated: users.length - deduped.length,
      upserted,
      persona_assigned: assigned,
    },
    { status: 200 }
  );
}
