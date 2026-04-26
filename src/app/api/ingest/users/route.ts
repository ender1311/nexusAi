import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const expected = process.env.HIGHTOUCH_API_KEY ?? process.env.INGEST_API_KEY;
  if (!expected) return true;
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

  let upserted = 0;
  for (const user of deduped) {
    const externalId = user.external_user_id!;
    const raw = (user.attributes ?? {}) as Record<string, unknown>;

    // Derive days_since_last_open from last_seen_at if present
    if (raw["last_seen_at"] && typeof raw["last_seen_at"] === "string") {
      const lastSeen = new Date(raw["last_seen_at"]);
      if (!isNaN(lastSeen.getTime())) {
        const days = (Date.now() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
        raw["days_since_last_open"] = Math.round(days);
      }
    }

    const attributes = raw as unknown as object;
    await prisma.user.upsert({
      where: { externalId },
      create: { externalId, attributes },
      update: { attributes },
    });
    upserted++;
  }

  return NextResponse.json(
    { ok: true, received: deduped.length, deduplicated: users.length - deduped.length, upserted },
    { status: 200 }
  );
}
