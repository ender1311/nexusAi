import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { CONTENT_SOURCE_IDS } from "@/connectors/content/config";

const sourceSchema = z.enum(CONTENT_SOURCE_IDS);

export async function GET(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const raw = new URL(req.url).searchParams.get("source");
  const source = raw === null ? null : sourceSchema.safeParse(raw);
  if (source && !source.success) return fail("Unknown content source", 400);
  try {
    const runs = await prisma.contentSyncRun.findMany({
      where: source ? { source: source.data } : undefined,
      orderBy: { startedAt: "desc" },
      take: 10,
    });
    return ok(runs);
  } catch (err) {
    return handleRouteError("GET /api/content/sync-runs", err);
  }
}
