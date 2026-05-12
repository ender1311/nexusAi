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

  // Delete in FK-safe order. deleteMany() is a no-op when the table is empty,
  // and skips tables that don't yet exist (pending migrations) silently via try/catch.
  const steps: (() => Promise<unknown>)[] = [
    () => prisma.processedEventId.deleteMany(),
    () => prisma.ingestSyncLog.deleteMany(),
    () => prisma.userAgentAssignment.deleteMany(),
    () => prisma.userArmStats.deleteMany(),
    () => prisma.personaArmStats.deleteMany(),
    () => prisma.linUCBArm.deleteMany(),
    () => prisma.userDecision.deleteMany(),
    () => prisma.modelMetric.deleteMany(),
    () => prisma.trackedUser.deleteMany(),
    () => prisma.agentPersonaTarget.deleteMany(),
    () => prisma.schedulingRule.deleteMany(),
    () => prisma.messageVariant.deleteMany(),
    () => prisma.message.deleteMany(),
    () => prisma.goal.deleteMany(),
    () => prisma.agent.deleteMany(),
    () => prisma.persona.deleteMany(),
    () => prisma.planSetMember.deleteMany(),
    () => prisma.planSet.deleteMany(),
    () => prisma.appSetting.deleteMany(),
  ];
  for (const step of steps) {
    await step().catch(() => {/* table may not exist yet — skip */});
  }
}

export { prisma };
