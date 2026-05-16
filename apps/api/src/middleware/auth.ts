import { createHmac, timingSafeEqual } from "node:crypto";
import { createMiddleware } from "hono/factory";

const HMAC_KEY = Buffer.from("nexus-token-comparison");

// HMAC-hash both strings to a fixed-length buffer before comparing so that
// string length differences don't produce a timing side-channel.
function safeEqual(a: string, b: string): boolean {
  const ah = createHmac("sha256", HMAC_KEY).update(a).digest();
  const bh = createHmac("sha256", HMAC_KEY).update(b).digest();
  return timingSafeEqual(ah, bh);
}

export const serviceAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const isValid = token.length > 0 && safeEqual(token, expected);
  if (!isValid) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Returns true when the caller is NOT an admin — use as: `if (isNotAdmin(c)) return c.json({ error: "Forbidden" }, 403)` */
export function isNotAdmin(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("X-User-Role") !== "admin";
}
