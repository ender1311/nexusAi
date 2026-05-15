import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required");
}

// connection_limit=1: Bun runs as a single persistent process; Neon's PgBouncer handles real pooling.
// pool_timeout=0: fail immediately rather than queue, so connection errors surface fast.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("connection_limit", "1");
url.searchParams.set("pool_timeout", "0");
const adapter = new PrismaNeon({ connectionString: url.toString() });

export const prisma = new PrismaClient(
  { adapter } as ConstructorParameters<typeof PrismaClient>[0]
);
