import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { prisma } from "@/lib/db";
import { FIELD_CATALOG } from "@/lib/segments/field-catalog";
import { computeFieldFacet } from "@/lib/segments/facet-compute";
import type { Prisma } from "@/generated/prisma/client";

// Allow up to 300s execution time on Vercel.
export const maxDuration = 300;

type RefreshSummary = { refreshed: string[]; failed: string[] };

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export async function POST(req: NextRequest): Promise<NextResponse<{ data: RefreshSummary } | { error: string }>> {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const refreshed: string[] = [];
  const failed: string[] = [];

  for (const field of FIELD_CATALOG) {
    if (!field.facet) continue;
    try {
      const facet = await computeFieldFacet(field);
      await prisma.segmentFieldFacet.upsert({
        where: { fieldId: field.id },
        create: { fieldId: field.id, kind: facet.kind, payload: facet.payload as Prisma.InputJsonValue },
        update: { kind: facet.kind, payload: facet.payload as Prisma.InputJsonValue },
      });
      refreshed.push(field.id);
    } catch (err) {
      // One slow/failing field must not abort the whole refresh.
      console.error(`refresh-segment-facets ${field.id}:`, err);
      failed.push(field.id);
    }
  }

  return NextResponse.json({ data: { refreshed, failed } }, { status: 200 });
}
