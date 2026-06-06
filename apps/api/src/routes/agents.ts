import { Hono } from "hono";
import { prisma } from "../lib/db";
import { Prisma } from "../generated/prisma/client";
import { revalidate } from "../lib/revalidate";
import { isNotAdmin } from "../middleware/auth";
import { LIBRARY_AGENT_NAME, FUNNEL_STAGES } from "../lib/constants";
import { detectTestedVariables, type MessageVariant } from "../lib/variant-diff";
import { prismaErrorResponse } from "../lib/errors";

const agents = new Hono();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const VALID_STAGES = new Set(FUNNEL_STAGES);

agents.get("/", async (c) => {
  try {
    const result = await prisma.agent.findMany({
      where: { name: { not: LIBRARY_AGENT_NAME } },
      include: {
        _count: { select: { goals: true, messages: true, decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return c.json(result, 200, {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    });
  } catch (error) {
    console.error("GET /agents error:", error);
    return c.json({ error: "Failed to fetch agents" }, 500);
  }
});

agents.post("/", async (c) => {
  if (isNotAdmin(c)) return c.json({ error: "Forbidden" }, 403);

  let body: Record<string, unknown> | null;
  try {
    body = (await c.req.json()) as Record<string, unknown> | null;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const {
    name,
    description,
    algorithm,
    epsilon,
    goals,
    messages,
    frequencyCap,
    quietStart,
    quietEnd,
    timezone,
    quietDays,
    smartSuppress,
    suppressThresh,
    funnelStage,
    targetFilter,
    uniqueUsersCap,
    dailySendCap,
    targetPersonaIds,
    targetSegmentName,
    deeplinkOverride,
  } = body;
  const segmentTargeting = body.segmentTargeting;

  if (typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  if (segmentTargeting !== undefined && segmentTargeting !== null) {
    if (
      typeof segmentTargeting !== "object" ||
      Array.isArray(segmentTargeting) ||
      !Array.isArray((segmentTargeting as { includes?: unknown }).includes) ||
      !Array.isArray((segmentTargeting as { excludes?: unknown }).excludes) ||
      (segmentTargeting as { includes: unknown[] }).includes.some((s: unknown) => typeof s !== "string" || !(s as string).trim()) ||
      (segmentTargeting as { excludes: unknown[] }).excludes.some((s: unknown) => typeof s !== "string" || !(s as string).trim())
    ) {
      return c.json({ error: "segmentTargeting must be null or { includes: string[], excludes: string[] } with non-empty strings" }, 400);
    }
    const st = segmentTargeting as { includes: string[]; excludes: string[] };
    const overlap = st.includes.filter((s: string) => st.excludes.includes(s));
    if (overlap.length > 0) {
      return c.json({ error: `Segment(s) cannot appear in both includes and excludes: ${overlap.join(", ")}` }, 400);
    }
  }

  const hasSegmentIncludes =
    Array.isArray((segmentTargeting as { includes?: unknown } | null)?.includes) &&
    ((segmentTargeting as { includes: unknown[] }).includes.length > 0);

  if (!hasSegmentIncludes) {
    if (!funnelStage || !VALID_STAGES.has(funnelStage as (typeof FUNNEL_STAGES)[number])) {
      return c.json({ error: "Invalid funnelStage" }, 400);
    }
  }

  if (targetFilter !== undefined && targetFilter !== null && !isPlainObject(targetFilter)) {
    return c.json({ error: "targetFilter must be a plain object" }, 400);
  }

  if (uniqueUsersCap !== undefined && uniqueUsersCap !== null) {
    if (!Number.isInteger(uniqueUsersCap) || (uniqueUsersCap as number) < 1) {
      return c.json({ error: "uniqueUsersCap must be null or a positive integer" }, 400);
    }
  }

  if (dailySendCap !== undefined && dailySendCap !== null) {
    if (!Number.isInteger(dailySendCap) || (dailySendCap as number) < 1) {
      return c.json({ error: "dailySendCap must be null or a positive integer" }, 400);
    }
  }

  if (deeplinkOverride !== undefined && deeplinkOverride !== null) {
    if (typeof deeplinkOverride !== "string" || (deeplinkOverride as string).trim().length === 0) {
      return c.json({ error: "deeplinkOverride must be null or a non-empty string" }, 400);
    }
  }

  if (targetSegmentName !== undefined && targetSegmentName !== null && (typeof targetSegmentName !== "string" || (targetSegmentName as string).trim().length === 0)) {
    return c.json({ error: "targetSegmentName must be null or a non-empty string" }, 400);
  }

  if (quietDays !== undefined) {
    if (!Array.isArray(quietDays) || (quietDays as unknown[]).some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) {
      return c.json({ error: "quietDays must be an array of day-of-week numbers (0–6)" }, 400);
    }
  }

  if (goals !== undefined && !Array.isArray(goals)) {
    return c.json({ error: "goals must be an array" }, 400);
  }
  for (const g of (Array.isArray(goals) ? goals : []) as Array<Record<string, unknown>>) {
    if (typeof g.eventName !== "string" || g.eventName.trim().length === 0) {
      return c.json({ error: "each goal requires a non-empty eventName" }, 400);
    }
    if (typeof g.tier !== "string" || g.tier.trim().length === 0) {
      return c.json({ error: "each goal requires a non-empty tier" }, 400);
    }
  }

  if (messages !== undefined && !Array.isArray(messages)) {
    return c.json({ error: "messages must be an array" }, 400);
  }
  for (const m of (Array.isArray(messages) ? messages : []) as Array<Record<string, unknown>>) {
    if (typeof m.name !== "string" || m.name.trim().length === 0) {
      return c.json({ error: "each message requires a non-empty name" }, 400);
    }
    if (typeof m.channel !== "string" || m.channel.trim().length === 0) {
      return c.json({ error: "each message requires a non-empty channel" }, 400);
    }
  }

  try {
    if (targetSegmentName && typeof targetSegmentName === "string") {
      const trimmed = (targetSegmentName as string).trim();
      const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: trimmed }, select: { name: true } });
      if (conflict) {
        return c.json({ error: `Segment "${trimmed}" is already assigned to agent "${conflict.name}"` }, 409);
      }
    }
    if (hasSegmentIncludes) {
      const includeSegs = (segmentTargeting as { includes: string[] }).includes;
      for (const seg of includeSegs) {
        const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: seg }, select: { name: true } });
        if (conflict) {
          return c.json({ error: `Segment "${seg}" is exclusively assigned to agent "${conflict.name}"` }, 409);
        }
      }
    }

    const goalList = Array.isArray(goals) ? (goals as Array<Record<string, unknown>>) : [];
    const messageList = Array.isArray(messages) ? (messages as Array<Record<string, unknown>>) : [];
    const personaIds = Array.isArray(targetPersonaIds) ? (targetPersonaIds as string[]) : [];
    const qDays = Array.isArray(quietDays) ? (quietDays as number[]) : [];

    const agent = await prisma.agent.create({
      data: {
        name: name.trim(),
        description: typeof description === "string" ? description : undefined,
        algorithm: typeof algorithm === "string" ? algorithm : "thompson",
        epsilon: typeof epsilon === "number" ? epsilon : 0.1,
        status: "draft",
        funnelStage: typeof funnelStage === "string" ? funnelStage : undefined,
        uniqueUsersCap: uniqueUsersCap === undefined ? 1000 : (uniqueUsersCap as number | null),
        dailySendCap: dailySendCap === undefined ? 500 : (dailySendCap as number | null),
        ...(deeplinkOverride !== undefined && deeplinkOverride !== null
          ? { deeplinkOverride: (deeplinkOverride as string).trim() }
          : {}),
        ...(targetSegmentName !== undefined ? { targetSegmentName: typeof targetSegmentName === "string" ? (targetSegmentName as string).trim() : null } : {}),
        ...(segmentTargeting !== undefined ? {
          segmentTargeting: segmentTargeting === null
            ? Prisma.DbNull
            : {
                includes: (segmentTargeting as { includes: string[]; excludes: string[] }).includes.map((s: string) => s.trim()),
                excludes: (segmentTargeting as { includes: string[]; excludes: string[] }).excludes.map((s: string) => s.trim()),
              }
        } : {}),
        ...(targetFilter !== undefined && targetFilter !== null
          ? { targetFilter: targetFilter as Prisma.InputJsonValue }
          : {}),
        goals: {
          create: goalList.map((g) => ({
            eventName: (g.eventName as string).trim(),
            tier: (g.tier as string).trim(),
            valueWeight: typeof g.valueWeight === "number" ? g.valueWeight : 1.0,
            description: typeof g.description === "string" ? g.description : undefined,
            weightMode: typeof g.weightMode === "string" ? g.weightMode : "fixed",
            weightProperty: typeof g.weightProperty === "string" ? g.weightProperty : null,
            weightDefault: typeof g.weightDefault === "number" ? g.weightDefault : 1.0,
          })),
        },
        messages: {
          create: messageList.map((m) => {
            const variantList = (Array.isArray(m.variants) ? m.variants : []) as MessageVariant[];
            return {
              name: (m.name as string).trim(),
              channel: (m.channel as string).trim(),
              testedVariables: detectTestedVariables(variantList),
              variants: {
                create: variantList.map((v) => ({
                  name: v.name ?? "V1",
                  subject: v.subject,
                  body: v.body ?? "",
                  cta: v.cta,
                  title: v.title,
                  iconImageUrl: v.iconImageUrl,
                  deeplink: v.deeplink,
                  preferredHour: v.preferredHour,
                  preferredDayOfWeek: v.preferredDayOfWeek,
                  frequencyCapOverride: v.frequencyCapOverride ?? undefined,
                  sourceTemplateId: v.sourceTemplateId,
                })),
              },
            };
          }),
        },
        schedulingRule: {
          create: {
            frequencyCap: (isPlainObject(frequencyCap)
              ? frequencyCap
              : { maxSends: 3, period: "week" }) as Prisma.InputJsonValue,
            quietHours: {
              start: typeof quietStart === "string" ? quietStart : "22:00",
              end: typeof quietEnd === "string" ? quietEnd : "08:00",
              timezone: typeof timezone === "string" ? timezone : "America/New_York",
              ...(qDays.length > 0 ? { quietDays: qDays } : {}),
            } as Prisma.InputJsonValue,
            smartSuppress: typeof smartSuppress === "boolean" ? smartSuppress : false,
            suppressThresh: typeof suppressThresh === "number" ? suppressThresh : 0.5,
          },
        },
      },
    });

    void revalidate("agents");

    if (personaIds.length > 0) {
      await prisma.agentPersonaTarget.createMany({
        data: personaIds.map((personaId) => ({ agentId: agent.id, personaId })),
        skipDuplicates: true,
      });
    }

    return c.json(agent, 201);
  } catch (error) {
    const mapped = prismaErrorResponse(error);
    if (mapped) return c.json(mapped.body, mapped.status);
    console.error("POST /agents error:", error);
    return c.json({ error: "Failed to create agent" }, 500);
  }
});

export { agents as agentsRoute };
