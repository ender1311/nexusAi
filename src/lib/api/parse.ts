import { NextRequest } from "next/server";
import { z } from "zod";
import { fail } from "./respond";

/**
 * Parse + validate a JSON request body against a zod schema.
 *
 * Returns a discriminated result: on success `{ ok: true, data }` with the
 * parsed value; on failure `{ ok: false, response }` carrying a ready-to-return
 * 400 `{ error }` envelope (malformed JSON or schema violation). Callers do:
 *
 *   const parsed = await parseBody(req, schema);
 *   if (!parsed.ok) return parsed.response;
 *   // parsed.data is fully typed
 */
export async function parseBody<T>(
  req: NextRequest,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: ReturnType<typeof fail> }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: fail("Invalid JSON body", 400) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    const message = first ? (path ? `${path}: ${first.message}` : first.message) : "Invalid request body";
    return { ok: false, response: fail(message, 400) };
  }

  return { ok: true, data: result.data };
}
