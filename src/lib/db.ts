import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  // connection_limit=1: each serverless instance owns one connection;
  // PgBouncer on the Neon side handles real pooling.
  // pool_timeout=0: fail immediately rather than queue, so timeouts surface fast.
  // Fallback URL prevents new URL() from throwing during next build when DATABASE_URL is absent.
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/placeholder");
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "0");
  const connectionString = url.toString();

  // The Neon serverless driver speaks Neon's WebSocket/HTTP protocol and cannot
  // talk to a plain Postgres on localhost — used by the local integration test
  // DB. Pick the node-postgres adapter there; keep PrismaNeon for prod/preview.
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const adapter = isLocal
    ? new PrismaPg({ connectionString })
    : new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = createPrismaClient();
}

export const prisma = globalForPrisma.prisma;
