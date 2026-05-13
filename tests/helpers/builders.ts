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
    brazeCanvasStepId?: string | null;
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
    brazeId?: string | null;
  } = {}
) {
  // Default personaConfidence to 1.0 so tests pass the MIN_PERSONA_CONFIDENCE filter.
  // Default push_enabled: true and language_tag: "en" so users are eligible for push sends
  // by default; individual tests can override via attributes: { push_enabled: false } etc.
  const defaultAttrs = { push_enabled: true, language_tag: "en" };
  const mergedAttrs = overrides.attributes
    ? { ...defaultAttrs, ...(overrides.attributes as Record<string, unknown>) }
    : defaultAttrs;
  const data = { personaConfidence: 1.0, ...overrides, attributes: mergedAttrs };
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
  conversionEvent?: string;
  conversionAt?: Date;
  pushOpenAt?: Date;
}) {
  return prisma.userDecision.create({
    data: {
      agentId: params.agentId,
      userId: params.userId,
      messageVariantId: params.messageVariantId,
      channel: params.channel ?? "push",
      sentAt: params.sentAt ?? new Date(),
      ...(params.conversionEvent && { conversionEvent: params.conversionEvent }),
      ...(params.conversionAt && { conversionAt: params.conversionAt }),
      ...(params.pushOpenAt && { pushOpenAt: params.pushOpenAt }),
    },
  });
}

// Note: title and body are mutually exclusive based on contentType.
// a-title and b-title use title; verse-text uses body.
// If you override contentType, also explicitly override title/body accordingly.
export async function createCampaignContent(overrides: {
  campaign?: string;
  contentType?: string;
  language?: string;
  usfmReference?: string;
  usfmHuman?: string | null;
  title?: string | null;
  body?: string | null;
  status?: string;
} = {}) {
  const contentType = overrides.contentType ?? "a-title";
  const isTitle = contentType !== "verse-text";
  return prisma.campaignContent.create({
    data: {
      campaign: "resurrection-push",
      contentType,
      language: "en",
      usfmReference: "ISA.43.18",
      usfmHuman: "Isaiah 43:18",
      title: isTitle ? "Test A-Title" : null,
      body: !isTitle ? "Test verse body" : null,
      status: "active",
      ...overrides,
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
