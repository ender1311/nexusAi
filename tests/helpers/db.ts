import { prisma } from "@/lib/db";
import { assertLocalDatabase } from "@/lib/db-safety";

/**
 * Throws unless the tests are pointed at the local test DB: DATABASE_URL must be
 * a localhost URL and TEST_DB must be "true" (set only in .env.test). Call it at
 * the top of any hook that wipes whole tables without going through truncateAll().
 */
export function assertLocalTestDatabase(context: string): void {
  assertLocalDatabase(process.env.DATABASE_URL, context);
  if (process.env.TEST_DB !== "true") {
    throw new Error(
      `SAFETY ABORT (${context}): TEST_DB env var is not "true". ` +
      `Run tests via \`bun test\` (loads .env.test), not \`bun run\`.`
    );
  }
}

/**
 * Wipe all test data in FK-safe order using deleteMany().
 * Call in beforeEach (and optionally afterEach) for integration test files.
 * Children are deleted before parents so FK constraints are never violated.
 *
 * SAFETY: throws before any query unless DATABASE_URL is a localhost URL
 * (allowlist, see src/lib/db-safety.ts) AND the TEST_DB=true flag from .env.test
 * is set. Run tests via `bun test` (which loads .env.test), never via `bun run`.
 */
export async function truncateAll(): Promise<void> {
  assertLocalTestDatabase("truncateAll()");

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
  await prisma.funnelTransition.deleteMany();
  await prisma.userArmStats.deleteMany();
  await prisma.personaArmStats.deleteMany();
  await prisma.linUCBArm.deleteMany();
  await prisma.modelMetric.deleteMany();
  await prisma.agentPersonaTarget.deleteMany();
  await prisma.schedulingRule.deleteMany();
  await prisma.contentSyncRun.deleteMany();
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.userSegment.deleteMany().catch(() => {});
  await prisma.segment.deleteMany().catch(() => {});
  await prisma.syncNameOverride.deleteMany().catch(() => {});
  await prisma.segmentFieldFacet.deleteMany().catch(() => {});
  await prisma.userPreference.deleteMany().catch(() => {});
  await prisma.trackedUser.deleteMany();
  await prisma.persona.deleteMany();
  await prisma.planSet.deleteMany().catch(() => {});
  await prisma.appSetting.deleteMany();
  await prisma.campaignContent.deleteMany();
  await prisma.deeplink.deleteMany();
  await prisma.pushSubcategory.deleteMany().catch(() => {});
  await prisma.pushCategory.deleteMany().catch(() => {});
  await prisma.demoUserGroup.deleteMany().catch(() => {});
}

export { prisma };
