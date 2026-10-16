import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { constantTimeEqual } from "@/lib/constant-time-compare";
import { getContentSourceConfig } from "@/connectors/content/config";
import { syncContentSource, type SyncResult } from "@/connectors/content/sync";

export const maxDuration = 300;

function verifyAuth(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return token != null && constantTimeEqual(token, secret);
}

export async function GET(req: Request) {
  if (!verifyAuth(req)) return fail("Unauthorized", 401);
  try {
    const config = await getContentSourceConfig();
    const results: Record<string, SyncResult> = {};
    for (const id of config.enabled) {
      if (id === "nexus-library") continue;
      results[id] = await syncContentSource(id);
    }
    return ok({ results });
  } catch (err) {
    return handleRouteError("GET /api/cron/content-sync", err);
  }
}
