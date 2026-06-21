import { checkRateLimit } from "@vercel/firewall";
import { createHash } from "crypto";

/**
 * App-level rate limit for the ingest endpoints, counted per caller (a hash of the
 * presented API key) rather than per IP — so one key's burst is bounded regardless
 * of source IP, and a single bulk caller (Hightouch) gets its own budget.
 *
 * Enforced by a Vercel WAF rate-limit rule with id "nexus-ingest" (configure in the
 * Vercel dashboard → Firewall → Rate Limiting SDK). FAILS OPEN: any error, an
 * unconfigured rule, or local/dev (no Vercel firewall) → returns false (not limited),
 * so the limiter can never break ingestion. The edge WAF rule is the always-on layer;
 * this adds per-key precision on top once the dashboard rule exists.
 */
export async function ingestRateLimited(request: Request, headers: Headers): Promise<boolean> {
  // Only the Vercel runtime has the firewall service; skip entirely elsewhere
  // (local dev, tests, other hosts) so there's no network call or latency.
  if (!process.env.VERCEL) return false;
  try {
    const token =
      headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
      headers.get("x-hightouch-token")?.trim() ||
      "anon";
    // Hash the secret so it never appears in a rate-limit counter key.
    const rateLimitKey = createHash("sha256").update(token).digest("hex").slice(0, 16);
    const { rateLimited } = await checkRateLimit("nexus-ingest", { request, rateLimitKey });
    return rateLimited;
  } catch {
    return false; // fail open — never block ingestion on a limiter error
  }
}
