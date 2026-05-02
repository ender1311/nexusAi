import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { detectTestedVariables } from "@/lib/engine/variant-diff";
import { MessageVariant, FUNNEL_STAGES } from "@/types/agent";
import { isPlainObject } from "@/lib/utils";

export async function GET() {
  try {
    const agents = await prisma.agent.findMany({
      include: {
        goals: true,
        messages: { include: { variants: true } },
        schedulingRule: true,
        _count: { select: { decisions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json(agents);
  } catch (error) {
    console.error("GET /api/agents error:", error);
    return NextResponse.json({ error: "Failed to fetch agents" }, { status: 500 });
  }
}

const VALID_STAGES = new Set(FUNNEL_STAGES);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      name, description, algorithm, epsilon,
      goals = [], messages = [],
      frequencyCap, quietStart, quietEnd, timezone,
      smartSuppress, suppressThresh,
      funnelStage, targetFilter,
    } = body;

    if (!VALID_STAGES.has(funnelStage)) {
      return NextResponse.json({ error: "Invalid funnelStage" }, { status: 400 });
    }

    if (targetFilter !== undefined && !isPlainObject(targetFilter)) {
      return NextResponse.json({ error: "targetFilter must be a plain object" }, { status: 400 });
    }

    const agent = await prisma.agent.create({
      data: {
        name,
        description,
        algorithm: algorithm ?? "thompson",
        epsilon: epsilon ?? 0.1,
        status: "draft",
        funnelStage,
        ...(targetFilter !== undefined ? { targetFilter } : {}),
        goals: {
          create: goals.map((g: { eventName: string; tier: string; valueWeight: number; description?: string }) => ({
            eventName: g.eventName,
            tier: g.tier,
            valueWeight: g.valueWeight,
            description: g.description,
          })),
        },
        messages: {
          create: messages.map((m: {
            name: string;
            channel: string;
            variants?: Array<{
              name: string;
              subject?: string;
              body: string;
              cta?: string;
              title?: string;
              iconImageUrl?: string;
              deeplink?: string;
              preferredHour?: number;
              preferredDayOfWeek?: number;
              frequencyCapOverride?: string;
              sourceTemplateId?: string;
            }>;
          }) => {
            const variantList = m.variants ?? [];
            return {
              name: m.name,
              channel: m.channel,
              testedVariables: detectTestedVariables(variantList as MessageVariant[]),
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
                  frequencyCapOverride: v.frequencyCapOverride,
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

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error("POST /api/agents error:", error);
    return NextResponse.json({ error: "Failed to create agent" }, { status: 500 });
  }
}
