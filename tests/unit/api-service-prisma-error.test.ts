import { describe, expect, it } from "bun:test";
import { prismaErrorResponse } from "../../apps/api/src/lib/errors";
import { Prisma } from "../../apps/api/src/generated/prisma/client";

// Guards parity with the Next.js app's handleRouteError: the Hono service must
// map known Prisma errors to the same HTTP status codes instead of a blanket 500.
describe("apps/api prismaErrorResponse", () => {
  it("maps P2025 (record not found) to 404", () => {
    const err = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "test",
    });
    expect(prismaErrorResponse(err)).toEqual({ status: 404, body: { error: "Resource not found" } });
  });

  it("maps P2002 (unique violation) to 409", () => {
    const err = new Prisma.PrismaClientKnownRequestError("dupe", {
      code: "P2002",
      clientVersion: "test",
    });
    expect(prismaErrorResponse(err)).toEqual({
      status: 409,
      body: { error: "A record with these values already exists" },
    });
  });

  it("returns null for an unmapped Prisma code (falls through to 500)", () => {
    const err = new Prisma.PrismaClientKnownRequestError("boom", {
      code: "P2003",
      clientVersion: "test",
    });
    expect(prismaErrorResponse(err)).toBeNull();
  });

  it("returns null for a plain Error (no leakage, falls through to 500)", () => {
    expect(prismaErrorResponse(new Error("secret internal detail"))).toBeNull();
  });
});
