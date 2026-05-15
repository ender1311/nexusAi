import { Hono } from "hono";
import { prisma } from "../lib/db";
import { Prisma } from "../generated/prisma/client";
import { revalidate } from "../lib/revalidate";
import { isNotAdmin } from "../middleware/auth";
import { LIBRARY_AGENT_NAME, FUNNEL_STAGES } from "../lib/constants";
import { detectTestedVariables, type MessageVariant } from "../lib/variant-diff";

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

  try {
    const body = await c.req.json<{
      name?: string;
      description?: string;
      algorithm?: string;
      epsilon?: number;
      goals?: Array<{
        eventName: string;
        tier: string;
        valueWeight: number;
        description?: string;
      }>;
      messages?: Array<{
        name: string;
        channel: string;
        variants?: Array<MessageVariant>;
      }>;
      frequencyCap?: { maxSends: number; period: string };
      quietStart?: string;
      quietEnd?: string;
      timezone?: string;
      smartSuppress?: boolean;
      suppressThresh?: number;
      funnelStage?: string;
      targetFilter?: unknown;
    }>();

    const {
      name = "",
      description,
      algorithm,
      epsilon,
      goals = [],
      messages = [],
      frequencyCap,
      quietStart,
      quietEnd,
      timezone,
      smartSuppress,
      suppressThresh,
      funnelStage,
      targetFilter,
    } = body;

    if (!VALID_STAGES.has(funnelStage as (typeof FUNNEL_STAGES)[number])) {
      return c.json({ error: "Invalid funnelStage" }, 400);
    }

    if (targetFilter !== undefined && !isPlainObject(targetFilter)) {
      return c.json({ error: "targetFilter must be a plain object" }, 400);
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description,
        algorithm: algorithm ?? "thompson",
        epsilon: epsilon ?? 0.1,
        status: "draft",
        funnelStage: funnelStage as string,
        ...(targetFilter !== undefined
          ? { targetFilter: targetFilter as Prisma.InputJsonValue }
          : {}),
        goals: {
          create: goals.map((g) => ({
            eventName: g.eventName,
            tier: g.tier,
            valueWeight: g.valueWeight,
            description: g.description,
          })),
        },
        messages: {
          create: messages.map((m) => {
            const variantList = m.variants ?? [];
            return {
              name: m.name,
              channel: m.channel,
              testedVariables: detectTestedVariables(variantList),
              variants: {
                create: variantList.map((v) => ({
                  name: v.name ?? "V1",
                  subject: v.subject,
                  body: v.body,
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
            frequencyCap: frequencyCap ?? { maxSends: 3, period: "week" },
            quietHours: {
              start: quietStart ?? "22:00",
              end: quietEnd ?? "08:00",
              timezone: timezone ?? "America/New_York",
            },
            smartSuppress: smartSuppress ?? false,
            suppressThresh: suppressThresh ?? 0.5,
          },
        },
      },
    });

    void revalidate("agents");
    return c.json(agent, 201);
  } catch (error) {
    console.error("POST /agents error:", error);
    return c.json({ error: "Failed to create agent" }, 500);
  }
});

export { agents as agentsRoute };
