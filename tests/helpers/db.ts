import { prisma } from "@/lib/db";

// Production endpoint ID — truncateAll() hard-blocks this to prevent accidental wipes.
// If the production DB ever migrates to a new endpoint, add the new ID here.
const PRODUCTION_ENDPOINT_IDS = ["ep-old-surf-a4p5os6s"];

/**
 * Wipe all test data in FK-safe order using deleteMany().
 * Call in beforeEach (and optionally afterEach) for integration test files.
 * Children are deleted before parents so FK constraints are never violated.
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

  // Delete in FK-safe order (children before parents).
  // Tables with no @relation FK constraints can go in any position.
  // .catch(() => {}) on optional tables that may not exist in the test DB schema.
  await prisma.planSetMember.deleteMany().catch(() => {});
  await prisma.failedBrazeSend.deleteMany().catch(() => {});
  await prisma.cronRun.deleteMany().catch(() => {});
  await prisma.processedEventId.deleteMany();
  await prisma.ingestSyncLog.deleteMany();
  await prisma.userDecision.deleteMany();
  await prisma.userAgentAssignment.deleteMany();
  await prisma.userArmStats.deleteMany();
  await prisma.personaArmStats.deleteMany();
  await prisma.linUCBArm.deleteMany();
  await prisma.modelMetric.deleteMany();
  await prisma.agentPersonaTarget.deleteMany();
  await prisma.schedulingRule.deleteMany();
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.trackedUser.deleteMany();
  await prisma.persona.deleteMany();
  await prisma.planSet.deleteMany().catch(() => {});
  await prisma.appSetting.deleteMany();
  await prisma.campaignContent.deleteMany();
  await prisma.deeplink.deleteMany();
  await prisma.demoUserGroup.deleteMany().catch(() => {});
}

export { prisma };
