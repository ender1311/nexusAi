import { after } from "next/server";
import { z } from "zod";
import { fail, ok, handleRouteError } from "@/lib/api/respond";
import { CONTENT_SOURCE_IDS } from "@/connectors/content/config";
import { syncContentSource } from "@/connectors/content/sync";
import { verifyContentWebhook } from "@/connectors/content/webhook-signature";

const sourceSchema = z.enum(CONTENT_SOURCE_IDS);

export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const parsed = sourceSchema.safeParse((await params).source);
  if (!parsed.success) return fail("Unknown content source", 404);
  const source = parsed.data;
  const rawBody = await req.text();
  const url = new URL(req.url);
  const verified = verifyContentWebhook(
    source,
    { method: req.method, path: url.pathname + url.search, headers: req.headers, rawBody },
    process.env.CONTENT_WEBHOOK_SECRET,
  );
  if (!verified) return fail("Invalid signature", 401);
  try {
    after(async () => {
      try {
        await syncContentSource(source);
      } catch (err) {
        console.error(`content webhook sync (${source}) failed:`, err);
      }
    });
    return ok({ queued: true }, 202);
  } catch (err) {
    return handleRouteError(`POST /api/content/webhook/${source}`, err);
  }
}
