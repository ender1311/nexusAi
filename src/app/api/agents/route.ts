import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { FUNNEL_STAGES } from "@/types/agent";
import { isPlainObject } from "@/lib/utils";
import { detectTestedVariables, type VariantInput } from "@/lib/variant-diff";
import { Prisma } from "@/generated/prisma/client";
import { fail, handleRouteError } from "@/lib/api/respond";

export const maxDuration = 15;

const VALID_STAGES = new Set(FUNNEL_STAGES);

export async function GET() {
  try {
    const agents = await apiFetch<unknown[]>("/agents");
    const res = NextResponse.json(agents);
    res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res;
  } catch (err) {
    return handleRouteError("GET /api/agents", err);
  }
}

export async function POST(req: NextRequest) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return fail("Invalid JSON body", 400);
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
    } = body;
    const segmentTargeting = body.segmentTargeting as unknown;

    if (typeof name !== "string" || name.trim().length === 0) {
      return fail("name is required", 400);
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
        return fail(
          "segmentTargeting must be null or { includes: string[], excludes: string[] } with non-empty strings",
          400,
        );
      }
      const st = segmentTargeting as { includes: string[]; excludes: string[] };
      const overlap = st.includes.filter((s: string) => st.excludes.includes(s));
      if (overlap.length > 0) {
        return fail(`Segment(s) cannot appear in both includes and excludes: ${overlap.join(", ")}`, 400);
      }
    }
    const hasSegmentIncludes =
      Array.isArray((segmentTargeting as { includes?: unknown } | null)?.includes) &&
      ((segmentTargeting as { includes: unknown[] }).includes.length > 0);
    if (!hasSegmentIncludes) {
      if (!funnelStage || !VALID_STAGES.has(funnelStage as (typeof FUNNEL_STAGES)[number])) {
        return fail("Invalid funnelStage", 400);
      }
    }
    if (targetFilter !== undefined && targetFilter !== null && !isPlainObject(targetFilter)) {
      return fail("targetFilter must be a plain object", 400);
    }
    if (uniqueUsersCap !== undefined && uniqueUsersCap !== null) {
      if (!Number.isInteger(uniqueUsersCap) || (uniqueUsersCap as number) < 1) {
        return fail("uniqueUsersCap must be null or a positive integer", 400);
      }
    }
    if (dailySendCap !== undefined && dailySendCap !== null) {
      if (!Number.isInteger(dailySendCap) || (dailySendCap as number) < 1) {
        return fail("dailySendCap must be null or a positive integer", 400);
      }
    }
    if (targetSegmentName !== undefined && targetSegmentName !== null && (typeof targetSegmentName !== "string" || (targetSegmentName as string).trim().length === 0)) {
      return fail("targetSegmentName must be null or a non-empty string", 400);
    }
    if (targetSegmentName && typeof targetSegmentName === "string") {
      const trimmed = (targetSegmentName as string).trim();
      const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: trimmed }, select: { name: true } });
      if (conflict) {
        return fail(`Segment "${trimmed}" is already assigned to agent "${conflict.name}"`, 409);
      }
    }
    if (hasSegmentIncludes) {
      const includeSegs = (segmentTargeting as { includes: string[] }).includes;
      for (const seg of includeSegs) {
        const conflict = await prisma.agent.findFirst({ where: { targetSegmentName: seg }, select: { name: true } });
        if (conflict) {
          return fail(`Segment "${seg}" is exclusively assigned to agent "${conflict.name}"`, 409);
        }
      }
    }
    if (quietDays !== undefined) {
      if (
        !Array.isArray(quietDays) ||
        (quietDays as unknown[]).some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)
      ) {
        return fail("quietDays must be an array of day-of-week numbers (0–6)", 400);
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
        funnelStage: funnelStage as string,
        ...(uniqueUsersCap !== undefined ? { uniqueUsersCap: uniqueUsersCap as number | null } : {}),
        ...(dailySendCap !== undefined ? { dailySendCap: dailySendCap as number | null } : {}),
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
            eventName: String(g.eventName),
            tier: String(g.tier),
            valueWeight: typeof g.valueWeight === "number" ? g.valueWeight : 1.0,
            description: typeof g.description === "string" ? g.description : undefined,
            weightMode: typeof g.weightMode === "string" ? g.weightMode : "fixed",
            weightProperty: typeof g.weightProperty === "string" ? g.weightProperty : null,
            weightDefault: typeof g.weightDefault === "number" ? g.weightDefault : 1.0,
          })),
        },
        messages: {
          create: messageList.map((m) => {
            const variantList = (Array.isArray(m.variants) ? m.variants : []) as VariantInput[];
            return {
              name: String(m.name),
              channel: String(m.channel),
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

    revalidateTag("agents", "max");

    if (personaIds.length > 0) {
      await prisma.agentPersonaTarget.createMany({
        data: personaIds.map((personaId) => ({ agentId: agent.id, personaId })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json(agent, { status: 201 });
  } catch (err) {
    return handleRouteError("POST /api/agents", err);
  }
}
