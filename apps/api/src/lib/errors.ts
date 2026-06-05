import { Prisma } from "../generated/prisma/client";

type MappedError = { status: 404 | 409; body: { error: string } };

/**
 * Maps a known Prisma request error to a client-safe HTTP response, mirroring the
 * Next.js app's handleRouteError so the service and the app agree on status codes:
 *   P2025 (record not found) → 404
 *   P2002 (unique violation) → 409
 * Returns null for anything else, so callers fall through to a generic 500.
 */
export function prismaErrorResponse(error: unknown): MappedError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return { status: 404, body: { error: "Resource not found" } };
    if (error.code === "P2002") return { status: 409, body: { error: "A record with these values already exists" } };
  }
  return null;
}
