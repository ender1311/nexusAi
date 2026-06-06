import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";

export async function createAgent(overrides: {
  name?: string;
  algorithm?: string;
  epsilon?: number;
  status?: string;
  funnelStage?: string;
  targetFilter?: object;
  staleFunnelStageDays?: number | null;
  targetSegmentName?: string | null;
  segmentTargeting?: { includes: string[]; excludes: string[] } | null;
  localizePush?: boolean;
  holdMaxDays?: number;
  holdMaxSends?: number;
  deeplinkOverride?: string | null;
} = {}) {
  const { segmentTargeting, ...rest } = overrides;
  return prisma.agent.create({
    data: {
      name: "Test Agent",
      algorithm: "thompson",
      epsilon: 0.1,
      status: "active",
      funnelStage: "wau",
      ...rest,
      ...(segmentTargeting !== undefined ? {
        segmentTargeting: segmentTargeting === null
          ? Prisma.JsonNull
          : segmentTargeting as Prisma.InputJsonValue,
      } : {}),
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
  // Default newsletter_push_enabled/newsletter_email_enabled: true and language_tag: "en"
  // so users are eligible by default; individual tests can override via attributes: { newsletter_push_enabled: false }.
  const defaultAttrs = { newsletter_push_enabled: true, newsletter_email_enabled: true, language_tag: "en" };
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
    blackoutDates?: string[];
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
  scheduledFor?: Date;
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
      ...(params.scheduledFor && { scheduledFor: params.scheduledFor }),
      ...(params.conversionEvent && { conversionEvent: params.conversionEvent }),
      ...(params.conversionAt && { conversionAt: params.conversionAt }),
      ...(params.pushOpenAt && { pushOpenAt: params.pushOpenAt }),
    },
  });
}

/** Alias for createUserDecision with named-object params (used in giving-conversion tests). */
export async function createDecision(data: {
  agentId: string;
  userId: string;
  messageVariantId?: string;
  channel?: string;
  sentAt?: Date;
  brazeSendId?: string | null;
}) {
  const decision = await createUserDecision({
    agentId: data.agentId,
    userId: data.userId,
    messageVariantId: data.messageVariantId,
    channel: data.channel ?? "push",
    sentAt: data.sentAt ?? new Date(),
  });
  if (data.brazeSendId !== undefined) {
    return prisma.userDecision.update({
      where: { id: decision.id },
      data: { brazeSendId: data.brazeSendId },
    });
  }
  return decision;
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

export async function createUserSegment(externalId: string, segmentName: string) {
  return prisma.userSegment.create({
    data: { externalId, segmentName },
  });
}

export async function createUserAgentAssignment(params: {
  externalUserId: string;
  agentId: string;
  sendCount?: number;
  startedAt?: Date;
  windowCompletedAt?: Date | null;
  lastSentAt?: Date | null;
  releasedAt?: Date | null;
  releaseReason?: string | null;
}) {
  const data = {
    agentId:           params.agentId,
    sendCount:         params.sendCount ?? 0,
    startedAt:         params.startedAt ?? new Date(),
    windowCompletedAt: params.windowCompletedAt ?? null,
    lastSentAt:        params.lastSentAt ?? null,
    releasedAt:        params.releasedAt ?? null,
    releaseReason:     params.releaseReason ?? null,
  };
  return prisma.userAgentAssignment.upsert({
    where: { externalUserId: params.externalUserId },
    create: { externalUserId: params.externalUserId, ...data },
    update: data,
  });
}

export async function createFunnelTransition(params: {
  externalUserId: string;
  fromStage: string;
  toStage: string;
  recoveryRank: number;
  detectedAt?: Date;
  attributedAgentId?: string | null;
  attributedDecisionId?: string | null;
}) {
  return prisma.funnelTransition.create({
    data: {
      externalUserId:       params.externalUserId,
      fromStage:            params.fromStage,
      toStage:              params.toStage,
      recoveryRank:         params.recoveryRank,
      ...(params.detectedAt && { detectedAt: params.detectedAt }),
      attributedAgentId:    params.attributedAgentId ?? null,
      attributedDecisionId: params.attributedDecisionId ?? null,
    },
  });
}

export async function createVariantTranslation(
  messageVariantId: string,
  overrides: {
    language?: string;
    title?: string | null;
    body?: string;
    bodyPersonal?: string | null;
    status?: string;
    source?: string | null;
    sourceFile?: string | null;
  } = {}
) {
  return prisma.messageVariantTranslation.create({
    data: {
      messageVariantId,
      language: "es",
      body: "Cuerpo de prueba",
      title: "Título de prueba",
      status: "active",
      ...overrides,
    },
  });
}
