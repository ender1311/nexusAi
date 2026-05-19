import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

function createPrismaClient() {
  // connection_limit=1: each serverless instance owns one connection;
  // PgBouncer on the Neon side handles real pooling.
  // pool_timeout=0: fail immediately rather than queue, so timeouts surface fast.
  // Fallback URL prevents new URL() from throwing during next build when DATABASE_URL is absent.
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/placeholder");
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "0");
  const adapter = new PrismaNeon({ connectionString: url.toString() });
  return new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = createPrismaClient();
}

export const prisma = globalForPrisma.prisma;
