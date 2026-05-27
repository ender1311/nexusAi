import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyIngestAuth } from "@/lib/ingest-auth";

type SegmentUserRecord = {
  external_user_id?: string;
  braze_id?: string;
  attributes?: {
    ht_segment_name?: string;
    [key: string]: unknown;
  };
};

const CHUNK = 200;
const MAX_BATCH = 10_000;

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

  const segmentNameParam = new URL(req.url).searchParams.get("segment_name")?.trim() || null;

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
      { error: `Batch too large: maximum ${MAX_BATCH.toLocaleString()} users per request` },
      { status: 400 },
    );
  }

  const users = rawUsers.filter(
    (u): u is SegmentUserRecord =>
      typeof u === "object" && u !== null,
  );

  const now = new Date();
  let upserted = 0;
  let skipped = 0;

  for (let i = 0; i < users.length; i += CHUNK) {
    const chunk = users.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (user) => {
        const externalUserId = user.external_user_id?.trim() || null;
        const brazeId = user.braze_id?.trim() || null;

        if (!externalUserId && !brazeId) {
          return { upserted: 0, skipped: 1 };
        }

        const externalId = externalUserId ?? brazeId!;

        const segmentName =
          (user.attributes?.ht_segment_name?.trim() || null) ?? segmentNameParam;

        await prisma.trackedUser.upsert({
          where: { externalId },
          create: {
            externalId,
            ...(brazeId ? { brazeId } : {}),
          },
          update: {}, // don't overwrite existing attributes or funnelStage
        });

        if (segmentName) {
          await prisma.userSegment.upsert({
            where: { externalId_segmentName: { externalId, segmentName } },
            create: { externalId, segmentName, syncedAt: now },
            update: { syncedAt: now },
          });
        }

        return { upserted: 1, skipped: 0 };
      }),
    );
    for (const r of results) {
      upserted += r.upserted;
      skipped += r.skipped;
    }
  }

  const responseBody = {
    ok: true,
    received: rawUsers.length,
    upserted,
    skipped,
  };

  await prisma.ingestSyncLog
    .create({
      data: {
        syncKind: "segment_sync",
        received: rawUsers.length,
        upserted,
        details: { skipped },
      },
    })
    .catch(() => {});

  return NextResponse.json(responseBody, { status: 200 });
}
