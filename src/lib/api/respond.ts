import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";

/** Success envelope: `{ data: T }` with an explicit status (200 default, 201 for creates). */
export function ok<T>(data: T, status = 200): NextResponse<{ data: T }> {
  return NextResponse.json({ data }, { status });
}

/** Error envelope: `{ error: string }`. The message is client-safe — never pass raw error text. */
export function fail(message: string, status: number): NextResponse<{ error: string }> {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Centralized catch-block handler. Logs the real error server-side (never leaked to
 * the client) and maps known Prisma error codes to the right HTTP status:
 *   P2025 (record not found) → 404
 *   P2002 (unique violation) → 409
 * Everything else → a generic 500.
 *
 * @param context short label for the server log, e.g. "POST /api/agents".
 */
export function handleRouteError(context: string, err: unknown): NextResponse<{ error: string }> {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return fail("Resource not found", 404);
    if (err.code === "P2002") return fail("A record with these values already exists", 409);
  }
  console.error(`${context}:`, err);
  return fail("Internal server error", 500);
}
