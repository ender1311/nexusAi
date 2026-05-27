import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyIngestAuth } from "@/lib/ingest-auth";

/**
 * POST /api/ingest/segments
 *
 * Hightouch audience segment sync endpoint.
 * Accepts two payload shapes:
 *   { users: [...] }   — Liquid template format
 *   [...]              — Direct array format
 *
 * Each user object: { external_user_id?, braze_id?, attributes?: { ht_segment_name? } }
 * Segment name resolved from: attributes.ht_segment_name → ?segment_name query param
 *
 * Upserts TrackedUser and UserSegment rows. Does not run persona classification.
 */

// ── Types ─────────────────────────────────────────────────────────────────

type SegmentUserRecord = {
  external_user_id?: string;
  braze_id?: string;
  attributes?: {
    ht_segment_name?: string;
    [key: string]: unknown;
  };
};

// ── Handler ───────────────────────────────────────────────────────────────

const CHUNK = 50;
const MAX_BATCH = 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyIngestAuth(req.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Resolve segment_name query param fallback
  const segmentNameParam = new URL(req.url).searchParams.get("segment_name")?.trim() || null;

  // Normalize payload to array of user records
  let rawUsers: unknown[];
  if (Array.isArray(body)) {
    rawUsers = body;
  } else if (
    typeof body === "object" &&
    body !== null &&
    "users" in body &&
    Array.isArray((body as Record<string, unknown>).users)
  ) {
    rawUsers = (body as { users: unknown[] }).users;
  } else {
    return NextResponse.json({ error: "Invalid payload: expected { users: [...] } or [...]" }, { status: 400 });
  }

  if (rawUsers.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large: maximum ${MAX_BATCH} users per request` },
      { status: 400 },
    );
  }

  // Filter and cast valid user records
  const users = rawUsers.filter(
    (u): u is SegmentUserRecord =>
      typeof u === "object" && u !== null,
  ) as SegmentUserRecord[];

  const now = new Date();
  let upserted = 0;
  let skipped = 0;

  // ── Process in parallel chunks ────────────────────────────────────────────
  for (let i = 0; i < users.length; i += CHUNK) {
    const chunk = users.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (user) => {
        const externalUserId = user.external_user_id?.trim() || null;
        const brazeId = user.braze_id?.trim() || null;

        // Skip users with no identity
        if (!externalUserId && !brazeId) {
          skipped++;
          return;
        }

        // Prefer external_user_id; fall back to braze_id
        const externalId = externalUserId ?? brazeId!;

        // Resolve segment name: attributes first, then query param
        const segmentName =
          (user.attributes?.ht_segment_name?.trim() || null) ?? segmentNameParam;

        // Upsert TrackedUser — do not overwrite attributes or funnelStage
        await prisma.trackedUser.upsert({
          where: { externalId },
          create: {
            externalId,
            ...(brazeId ? { brazeId } : {}),
          },
          update: {},
        });

        // Upsert UserSegment only when we have a segment name
        if (segmentName) {
          await prisma.userSegment.upsert({
            where: { externalId_segmentName: { externalId, segmentName } },
            create: { externalId, segmentName, syncedAt: now },
            update: { syncedAt: now },
          });
        }

        upserted++;
      }),
    );
  }

  const responseBody = {
    ok: true,
    received: users.length,
    upserted,
    skipped,
  };

  // Write sync log (non-critical)
  await prisma.ingestSyncLog
    .create({
      data: {
        syncKind: "segment_sync",
        received: users.length,
        upserted,
        details: { skipped },
      },
    })
    .catch(() => {});

  return NextResponse.json(responseBody, { status: 200 });
}
