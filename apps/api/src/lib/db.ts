import { PrismaClient } from "../generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required");
}

// connection_limit=1: Bun runs as a single persistent process; Neon's PgBouncer handles real pooling.
// pool_timeout=0: fail immediately rather than queue, so connection errors surface fast.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("connection_limit", "1");
url.searchParams.set("pool_timeout", "0");
const connectionString = url.toString();

// The Neon serverless driver speaks Neon's WebSocket/HTTP protocol and cannot
// reach a plain Postgres on localhost — used by the local integration test DB.
// Pick the node-postgres adapter there; keep PrismaNeon for prod/preview.
const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
const adapter = isLocal
  ? new PrismaPg({ connectionString })
  : new PrismaNeon({ connectionString });

export const prisma = new PrismaClient(
  { adapter } as ConstructorParameters<typeof PrismaClient>[0]
);
