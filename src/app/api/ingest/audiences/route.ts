import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyIngestAuth } from "@/lib/ingest-auth";
import { parseAudiencePayload } from "./parse-payload";

type SuccessResponse = {
  ok: true;
  cohort_id: string;
  received: number;
  upserted: number;
  skipped: number;
};

const MAX_BATCH = 10_000;
const CHUNK = 200;

export async function POST(
  req: NextRequest,
): Promise<NextResponse<SuccessResponse | { error: string }>> {
  if (!verifyIngestAuth(req.headers)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseAudiencePayload(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { cohortId, externalIds, brazeIds } = parsed.payload;
  const totalReceived = externalIds.length + brazeIds.length;

  if (totalReceived > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large: maximum ${MAX_BATCH.toLocaleString()} users per request` },
      { status: 400 },
    );
  }

  try {
    const now = new Date();
    let upserted = 0;
    let skipped = 0;

    // Process external_user_ids — direct UserSegment upsert (no FK, no TrackedUser needed)
    for (let i = 0; i < externalIds.length; i += CHUNK) {
      const chunk = externalIds.slice(i, i + CHUNK);
      const results = await Promise.all(
        chunk.map((externalId) =>
          prisma.userSegment
            .upsert({
              where: { externalId_segmentName_source: { externalId, segmentName: cohortId, source: "hightouch" } },
              create: { externalId, segmentName: cohortId, source: "hightouch", syncedAt: now },
              update: { syncedAt: now },
            })
            .then(() => ({ upserted: 1, skipped: 0 }))
            .catch(() => ({ upserted: 0, skipped: 1 })),
        ),
      );
      for (const r of results) {
        upserted += r.upserted;
        skipped += r.skipped;
      }
    }

    // Process braze_user_ids — resolve to externalId via TrackedUser
    for (let i = 0; i < brazeIds.length; i += CHUNK) {
      const chunk = brazeIds.slice(i, i + CHUNK);

      // Batch lookup existing TrackedUsers by brazeId
      const existing = await prisma.trackedUser.findMany({
        where: { brazeId: { in: chunk } },
        select: { externalId: true, brazeId: true },
      });

      const brazeToExternal = new Map<string, string>(
        existing
          .filter((u): u is typeof u & { brazeId: string } => u.brazeId !== null)
          .map((u) => [u.brazeId, u.externalId]),
      );

      // Resolve externalId for each brazeId in chunk
      const resolvedIds: string[] = [];
      for (const brazeId of chunk) {
        const mapped = brazeToExternal.get(brazeId);
        if (mapped !== undefined) {
          resolvedIds.push(mapped);
        } else {
          // Create an unverified TrackedUser keyed by brazeId
          try {
            const created = await prisma.trackedUser.upsert({
              where: { externalId: brazeId },
              create: { externalId: brazeId, brazeId },
              update: {},
              select: { externalId: true, brazeId: true },
            });
            // Only use this record if it actually corresponds to the brazeId we're resolving
            if (created.brazeId === brazeId) {
              resolvedIds.push(created.externalId);
            } else {
              skipped++;
            }
          } catch {
            skipped++;
          }
        }
      }

      // Upsert UserSegment for all resolved externalIds
      const segmentResults = await Promise.all(
        resolvedIds.map((externalId) =>
          prisma.userSegment
            .upsert({
              where: { externalId_segmentName_source: { externalId, segmentName: cohortId, source: "hightouch" } },
              create: { externalId, segmentName: cohortId, source: "hightouch", syncedAt: now },
              update: { syncedAt: now },
            })
            .then(() => ({ upserted: 1, skipped: 0 }))
            .catch(() => ({ upserted: 0, skipped: 1 })),
        ),
      );
      for (const r of segmentResults) {
        upserted += r.upserted;
        skipped += r.skipped;
      }
    }

    // Log + respond
    await prisma.ingestSyncLog
      .create({
        data: {
          syncKind: "audience_sync",
          received: totalReceived,
          upserted,
          details: { cohort_id: cohortId, skipped },
        },
      })
      .catch(() => {});

    return NextResponse.json<SuccessResponse>({
      ok: true,
      cohort_id: cohortId,
      received: totalReceived,
      upserted,
      skipped,
    });
  } catch (err) {
    console.error("[POST /api/ingest/audiences] Unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
