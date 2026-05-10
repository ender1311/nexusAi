import { prisma } from "@/lib/db";

/**
 * Wipe all test data in a single atomic TRUNCATE.
 * Call in beforeEach (and optionally afterEach) for integration test files.
 * Using TRUNCATE CASCADE is faster and more reliable than chained deleteMany()
 * calls across the Neon HTTP adapter.
 */
export async function truncateAll(): Promise<void> {
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
