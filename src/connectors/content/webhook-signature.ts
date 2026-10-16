import { createHmac } from "node:crypto";
import { constantTimeEqual } from "@/lib/constant-time-compare";

/** Signed webhooks older (or further in the future) than this are rejected as replays. */
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;
type Clock = () => number;

/** Nexus' own scheme: HMAC-SHA256 of the raw body, hex. Accepts "sha256=<hex>" or "<hex>". */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.startsWith("sha256=") ? header.slice(7) : header;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return given.length === expected.length && constantTimeEqual(given, expected);
}

function withinTolerance(timestampMs: number, now: Clock): boolean {
  return Number.isFinite(timestampMs) && Math.abs(now() - timestampMs) <= WEBHOOK_TOLERANCE_MS;
}

/**
 * Sanity (@sanity/webhook): header `t=<unix ms>,v1=<base64url>`, where v1 is
 * HMAC-SHA256(secret, `${t}.${rawBody}`) base64url-encoded. The toolkit does not check
 * the timestamp; we add a 5 minute window. Seconds-precision timestamps are tolerated.
 */
export function verifySanitySignature(rawBody: string, header: string | null, secret: string | undefined, now: Clock = Date.now): boolean {
  if (!secret || !header) return false;
  const match = header.trim().match(/^t=(\d+)[, ]+v1=([^, ]+)$/);
  if (!match) return false;
  const raw = Number.parseInt(match[1], 10);
  const timestampMs = raw < 1e11 ? raw * 1000 : raw;
  if (!withinTolerance(timestampMs, now)) return false;
  const expected = createHmac("sha256", secret).update(`${match[1]}.${rawBody}`).digest("base64url");
  return constantTimeEqual(match[2], expected);
}

export type SignedRequestParts = {
  method: string;
  /** Request path plus query string, as the sender signed it. */
  path: string;
  headers: Headers;
  rawBody: string;
};

/** Same normalization as @contentful/node-apps-toolkit: encodeURI(pathname + "?" + querystring.escape(search)). */
function normalizeContentfulPath(path: string): string {
  const [pathname, ...rest] = path.split("?");
  const search = rest.join("?");
  return encodeURI(search ? `${pathname}?${encodeURIComponent(search)}` : pathname);
}

/**
 * Contentful request verification (@contentful/node-apps-toolkit verifyRequest/signRequest):
 * headers x-contentful-signature, x-contentful-signed-headers (comma-separated names),
 * x-contentful-timestamp (unix ms). Canonical request =
 * `${METHOD}\n${path}\n${name:value;...}\n${body}` with the signed headers sorted by name,
 * HMAC-SHA256 hex. The toolkit's default TTL is 30s; ours is the shared 5 minute window.
 */
export function verifyContentfulSignature(req: SignedRequestParts, secret: string | undefined, now: Clock = Date.now): boolean {
  if (!secret) return false;
  const signature = req.headers.get("x-contentful-signature");
  const signedHeaderNames = req.headers.get("x-contentful-signed-headers");
  const timestamp = req.headers.get("x-contentful-timestamp");
  if (!signature || !signedHeaderNames || !timestamp || !/^\d+$/.test(timestamp.trim())) return false;
  if (!withinTolerance(Number.parseInt(timestamp, 10), now)) return false;

  const names = signedHeaderNames.split(",").map((n) => n.toLowerCase().trim());
  const picked = new Map<string, string>();
  for (const name of names) {
    const value = req.headers.get(name);
    if (value !== null) picked.set(name, value.trim());
  }
  // The toolkit recomputes the signed-headers value from the picked names.
  picked.set("x-contentful-timestamp", timestamp.trim());
  picked.set("x-contentful-signed-headers", [...picked.keys()].sort().join(","));
  const headerLine = [...picked.entries()]
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const canonical = [req.method.toUpperCase(), normalizeContentfulPath(req.path), headerLine, req.rawBody].join("\n");
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");
  return constantTimeEqual(signature, expected);
}

/**
 * Picks the scheme by source: Contentful and Sanity use their native signatures when
 * their headers are present; every source also accepts the Nexus HMAC in x-nexus-signature.
 * A request carrying a native header is verified against that scheme only.
 */
export function verifyContentWebhook(source: string, req: SignedRequestParts, secret: string | undefined, now: Clock = Date.now): boolean {
  if (source === "contentful" && req.headers.has("x-contentful-signature")) {
    return verifyContentfulSignature(req, secret, now);
  }
  if (source === "sanity" && req.headers.has("sanity-webhook-signature")) {
    return verifySanitySignature(req.rawBody, req.headers.get("sanity-webhook-signature"), secret, now);
  }
  return verifyWebhookSignature(req.rawBody, req.headers.get("x-nexus-signature"), secret);
}
