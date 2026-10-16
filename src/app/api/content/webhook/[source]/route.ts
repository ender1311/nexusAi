import { z } from "zod";
import { ok, fail, handleRouteError } from "@/lib/api/respond";
import { CONTENT_SOURCE_IDS } from "@/connectors/content/config";
import { syncContentSource } from "@/connectors/content/sync";
import { verifyWebhookSignature } from "@/connectors/content/webhook-signature";

const sourceSchema = z.enum(CONTENT_SOURCE_IDS);

export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const parsed = sourceSchema.safeParse((await params).source);
  if (!parsed.success) return fail("Unknown content source", 404);
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-nexus-signature") ??
    req.headers.get("x-contentful-signature") ??
    req.headers.get("sanity-webhook-signature");
  if (!verifyWebhookSignature(rawBody, signature, process.env.CONTENT_WEBHOOK_SECRET)) {
    return fail("Invalid signature", 401);
  }
  try {
    await syncContentSource(parsed.data);
    return ok({ queued: true }, 202);
  } catch (err) {
    return handleRouteError(`POST /api/content/webhook/${parsed.data}`, err);
  }
}
