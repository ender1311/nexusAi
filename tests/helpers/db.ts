import { prisma } from "@/lib/db";

// Production endpoint ID — truncateAll() hard-blocks this to prevent accidental wipes.
// If the production DB ever migrates to a new endpoint, add the new ID here.
const PRODUCTION_ENDPOINT_IDS = ["ep-old-surf-a4p5os6s"];

/**
 * Wipe all test data in a single atomic TRUNCATE.
 * Call in beforeEach (and optionally afterEach) for integration test files.
 * Using TRUNCATE CASCADE is faster and more reliable than chained deleteMany()
 * calls across the Neon HTTP adapter.
 *
 * SAFETY: throws immediately if DATABASE_URL points to a known production endpoint
 * or if the TEST_DB guard flag is absent. Run tests via `bun test` (which loads
 * .env.test), never via `bun run`.
 */
export async function truncateAll(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";

  // Guard 1: blocklist known production endpoints
  const matchedProd = PRODUCTION_ENDPOINT_IDS.find((id) => url.includes(id));
  if (matchedProd) {
    throw new Error(
      `SAFETY ABORT: truncateAll() refused — DATABASE_URL contains production endpoint "${matchedProd}". ` +
      `Run tests via \`bun test\` (loads .env.test), not \`bun run\`.`
    );
  }

  // Guard 2: require the TEST_DB=true flag set only in .env.test
  if (process.env.TEST_DB !== "true") {
    throw new Error(
      `SAFETY ABORT: truncateAll() refused — TEST_DB env var is not "true". ` +
      `Run tests via \`bun test\` (loads .env.test), not \`bun run\`.`
    );
  }

  // Truncate only tables that actually exist (schema may differ between envs).
  // TrackedUser is stored as "User" (@@map in schema).
  const candidates = [
    "ProcessedEventId", "IngestSyncLog", "UserAgentAssignment",
    "UserArmStats", "PersonaArmStats", "LinUCBArm",
    "UserDecision", "ModelMetric", "User",
    "AgentPersonaTarget", "SchedulingRule",
    "MessageVariant", "Message", "Goal", "Agent", "Persona",
    "PlanSetMember", "PlanSet", "AppSetting",
    "CampaignContent", "DemoUserGroup",
    "Deeplink", "CronRun", "FailedBrazeSend",
  ];
  // Cast to text — the Neon HTTP adapter can't deserialize pg_catalog 'name' type directly.
  const rows = await prisma.$queryRawUnsafe<{ t: string }[]>(
    `SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
    candidates,
  );
  const existing = rows.map((r) => r.t);
  if (existing.length > 0) {
    const list = existing.map((t) => `"${t}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
}

export { prisma };
