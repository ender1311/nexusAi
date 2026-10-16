import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { CONTENT_SOURCE_IDS, getContentSourceConfig } from "@/connectors/content/config";
import { createContentSource } from "@/connectors/content/registry";
import { ContentSourceNotConfigured } from "@/connectors/content/types";

const sourceSchema = z.enum(CONTENT_SOURCE_IDS);

export async function POST(_req: Request, { params }: { params: Promise<{ source: string }> }) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const parsed = sourceSchema.safeParse((await params).source);
  if (!parsed.success) return fail("Unknown content source", 404);
  try {
    const result = await createContentSource(parsed.data, await getContentSourceConfig()).testConnection();
    return ok(result);
  } catch (err) {
    if (err instanceof ContentSourceNotConfigured) return ok({ ok: false, error: err.message });
    return handleRouteError(`POST /api/content/test/${parsed.data}`, err);
  }
}
