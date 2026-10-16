import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { CONTENT_SOURCE_IDS } from "@/connectors/content/config";
import { syncContentSource } from "@/connectors/content/sync";

export const maxDuration = 300;

const sourceSchema = z.enum(CONTENT_SOURCE_IDS);

export async function POST(_req: Request, { params }: { params: Promise<{ source: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const parsed = sourceSchema.safeParse((await params).source);
  if (!parsed.success) return fail("Unknown content source", 404);
  try {
    return ok(await syncContentSource(parsed.data));
  } catch (err) {
    return handleRouteError(`POST /api/content/sync/${parsed.data}`, err);
  }
}
