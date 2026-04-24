import { prisma } from "@/lib/db";

/**
 * Delete all rows in safe dependency order.
 * Call in beforeEach for integration test files.
 */
export async function truncateAll(): Promise<void> {
  await prisma.personaArmStats.deleteMany();
  await prisma.userDecision.deleteMany();
  await prisma.modelMetric.deleteMany();
  // Users must be deleted before Personas (User.personaId FK)
  await prisma.user.deleteMany();
  // AgentPersonaTarget before Agent/Persona (cascade would handle it, but be explicit)
  await prisma.agentPersonaTarget.deleteMany();
  await prisma.schedulingRule.deleteMany();
  await prisma.messageVariant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.persona.deleteMany();
  await prisma.appSetting.deleteMany();
}

export { prisma };
