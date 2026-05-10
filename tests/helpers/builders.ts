import { prisma } from "@/lib/db";

export async function createAgent(overrides: {
  name?: string;
  algorithm?: string;
  epsilon?: number;
  status?: string;
  funnelStage?: string;
  targetFilter?: object;
  staleFunnelStageDays?: number | null;
} = {}) {
  return prisma.agent.create({
    data: {
      name: "Test Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      status: "active",
      funnelStage: "wau",
      ...overrides,
    },
  });
}

export async function createPersona(overrides: {
  name?: string;
  label?: string | null;
  isActive?: boolean;
  clusterSize?: number;
  source?: string;
} = {}) {
  return prisma.persona.create({
    data: {
      name: "Test Persona",
      isActive: true,
      clusterSize: 10,
      source: "discovered",
      ...overrides,
    },
  });
}

export async function createMessage(
  agentId: string,
  overrides: { channel?: string; brazeCampaignId?: string | null } = {}
) {
  return prisma.message.create({
    data: {
      agentId,
      name: "Test Message",
      channel: "push",
      ...overrides,
    },
  });
}

export async function createVariant(
  messageId: string,
  overrides: {
    name?: string;
    body?: string;
    title?: string | null;
    brazeVariantId?: string | null;
    status?: string;
    deeplink?: string | null;
    category?: string | null;
    subcategory?: string | null;
    iconImageUrl?: string | null;
    sourceTemplateId?: string | null;
  } = {}
) {
  return prisma.messageVariant.create({
    data: {
      messageId,
      name: "Variant A",
      body: "Test body",
      title: "Test title",
      status: "active",
      ...overrides,
    },
  });
}

export async function createUser(
  externalId: string,
  overrides: {
    personaId?: string | null;
    personaConfidence?: number | null;
    totalDecisions?: number;
    totalConversions?: number;
    totalReward?: number;
    attributes?: object;
    funnelStage?: string | null;
    funnelStageUpdatedAt?: Date | null;
  } = {}
) {
  // Default personaConfidence to 1.0 so tests pass the MIN_PERSONA_CONFIDENCE filter
  const data = { personaConfidence: 1.0, ...overrides };
  return prisma.trackedUser.upsert({
    where: { externalId },
    create: { externalId, ...data },
    update: { ...data },
  });
}

export async function createGoal(
  agentId: string,
  overrides: {
    eventName?: string;
    tier?: string;
    valueWeight?: number;
    weightMode?: string;
    weightDefault?: number;
    weightProperty?: string | null;
  } = {}
) {
  return prisma.goal.create({
    data: {
      agentId,
      eventName: "plan_started",
      tier: "best",
      valueWeight: 1.0,
      weightMode: "fixed",
      weightDefault: 1.0,
      ...overrides,
    },
  });
}

export async function createSchedulingRule(
  agentId: string,
  overrides: {
    frequencyCap?: object;
    quietHours?: object;
    smartSuppress?: boolean;
    suppressThresh?: number;
  } = {}
) {
  return prisma.schedulingRule.create({
    data: {
      agentId,
      frequencyCap: { maxSends: 100, period: "week" } as object,
      quietHours: { start: "00:00", end: "00:00", timezone: "UTC" } as object,
      blackoutDates: [],
      smartSuppress: false,
      suppressThresh: 0.5,
      ...overrides,
    },
  });
}

export async function createUserDecision(params: {
  agentId: string;
  userId: string;           // externalId string
  messageVariantId?: string;
  channel?: string;
  sentAt?: Date;
}) {
  return prisma.userDecision.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      messageVariantId: params.messageVariantId,
      channel: params.channel ?? "push",
      sentAt: params.sentAt ?? new Date(),
    },
  });
}

export async function linkAgentToPersona(agentId: string, personaId: string) {
  return prisma.agentPersonaTarget.create({ data: { agentId, personaId } });
}

export async function createUserAgentAssignment(params: {
  externalUserId: string;
  agentId: string;
  sendCount?: number;
  startedAt?: Date;
  windowCompletedAt?: Date | null;
}) {
  return prisma.userAgentAssignment.upsert({
    where: { externalUserId: params.externalUserId },
    create: {
      externalUserId:    params.externalUserId,
      agentId:           params.agentId,
      sendCount:         params.sendCount ?? 0,
      startedAt:         params.startedAt ?? new Date(),
      windowCompletedAt: params.windowCompletedAt ?? null,
    },
    update: {
      agentId:           params.agentId,
      sendCount:         params.sendCount ?? 0,
      startedAt:         params.startedAt ?? new Date(),
      windowCompletedAt: params.windowCompletedAt ?? null,
    },
  });
}
