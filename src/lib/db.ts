import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

function createBasePrismaClient() {
  // NOTE: connection_limit / pool_timeout URL params are no-ops here — driver
  // adapters (PrismaNeon / PrismaPg) manage their own connections, bypassing
  // Prisma's native pool. Real pooling is PgBouncer on the Neon side. Transient
  // "can't get a connection" failures during ingest floods are smoothed over by
  // the read-retry extension below rather than by a pool timeout.
  // Fallback URL prevents new URL() from throwing during next build when DATABASE_URL is absent.
  const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/placeholder");
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

// Transient connection errors — the query never ran (couldn't acquire/keep a
// connection), so retrying is safe. Seen during Hightouch ingest floods that
// momentarily exhaust the Neon pooler, which otherwise surface as page "Load failed".
const TRANSIENT_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);
const TRANSIENT_MESSAGE =
  /connection terminated|connection closed|connection reset|fetch failed|econnreset|etimedout|too many connections|terminating connection|server has closed the connection|timed out fetching/i;

// Only retry reads — never mutations — so a connection that dropped mid-write
// can't double-apply. Page loads are all reads, which is what this targets.
const RETRYABLE_READ_OPS = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow",
  "findMany", "count", "aggregate", "groupBy",
  "$queryRaw", "$queryRawUnsafe",
]);

function isTransientConnectionError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  const message = (e as { message?: unknown }).message;
  return typeof message === "string" && TRANSIENT_MESSAGE.test(message);
}

function createPrismaClient() {
  return createBasePrismaClient().$extends({
    name: "retry-transient-reads",
    query: {
      async $allOperations({ operation, args, query }) {
        if (!RETRYABLE_READ_OPS.has(operation)) return query(args);
        const MAX_ATTEMPTS = 4; // initial try + 3 retries, ~0.6s total wait
        for (let attempt = 1; ; attempt++) {
          try {
            return await query(args);
          } catch (err) {
            if (attempt >= MAX_ATTEMPTS || !isTransientConnectionError(err)) throw err;
            await new Promise((resolve) => setTimeout(resolve, attempt * 150));
          }
        }
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;
/**
 * Either the top-level (extended) client or a `$transaction` client — for helpers
 * that run under both. Typed as the transaction-scoped shape (no $transaction/$connect/…);
 * the full client is assignable to it since Omit only drops keys.
 */
export type DbExecutor = Omit<
  ExtendedPrismaClient,
  "$extends" | "$transaction" | "$on" | "$connect" | "$disconnect" | "$use"
>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = createPrismaClient();
}

export const prisma = globalForPrisma.prisma;
