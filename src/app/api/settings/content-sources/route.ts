import { requireAdmin } from "@/lib/auth";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import {
  contentSourceConfigSchema, getContentSourceConfig, saveContentSourceConfig, type ContentSourceConfig,
} from "@/connectors/content/config";

import { readTokenPresence, type TokenPresence } from "@/connectors/content/page-data";

export async function GET() {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  try {
    const config = await getContentSourceConfig();
    const tokens = readTokenPresence();
    return ok<{ config: ContentSourceConfig; tokens: TokenPresence }>({ config, tokens });
  } catch (err) {
    return handleRouteError("GET /api/settings/content-sources", err);
  }
}

export async function PUT(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail("Invalid JSON", 400);
  }
  const parsed = contentSourceConfigSchema.safeParse(json);
  if (!parsed.success) return fail("Invalid content source config", 400);
  try {
    await saveContentSourceConfig(parsed.data);
    return ok(parsed.data);
  } catch (err) {
    return handleRouteError("PUT /api/settings/content-sources", err);
  }
}
