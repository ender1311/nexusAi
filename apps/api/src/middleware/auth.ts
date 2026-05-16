import { createMiddleware } from "hono/factory";

// Pure-JS constant-time comparison (XOR loop) — works on both Node.js and edge runtimes.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const serviceAuth = createMiddleware(async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const isValid = token.length > 0 && timingSafeEqual(token, expected);
  if (!isValid) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

/** Returns true when the caller is NOT an admin — use as: `if (isNotAdmin(c)) return c.json({ error: "Forbidden" }, 403)` */
export function isNotAdmin(c: { req: { header: (h: string) => string | undefined } }) {
  return c.req.header("X-User-Role") !== "admin";
}
