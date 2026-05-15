import { timingSafeEqual } from "crypto";
import { createMiddleware } from "hono/factory";

export const serviceAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const isValid =
    token.length > 0 &&
    token.length === expected.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  if (!isValid) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Returns true when the caller is NOT an admin — use as: `if (isNotAdmin(c)) return c.json({ error: "Forbidden" }, 403)` */
export function isNotAdmin(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("X-User-Role") !== "admin";
}
