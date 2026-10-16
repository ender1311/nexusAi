import { createHmac } from "node:crypto";
import { constantTimeEqual } from "@/lib/constant-time-compare";

/** HMAC-SHA256 of the raw body, hex. Accepts "sha256=<hex>" or "<hex>". */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return given.length === expected.length && constantTimeEqual(given, expected);
}
