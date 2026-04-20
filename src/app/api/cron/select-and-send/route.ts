import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBrazeClient } from "@/lib/braze/client";
import { PayloadFactory } from "@/lib/braze/payload-factory";
import { decideForUser } from "@/lib/decide";

// Allow up to 300s execution time on Vercel
export const maxDuration = 300;

function verifyAuth(req: NextRequest): boolean {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // always require CRON_SECRET — no fallback for cron
  return token === secret;
}

type VariantSendGroup = {
  variantId: string;
  brazeVariantId: string | null;
  brazeCampaignId: string | null;
  channel: string;
  body: string;
  title: string | null;
  externalUserIds: string[];
  decisionIds: string[];
};

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const brazeClient = createBrazeClient();
  if (!brazeClient) {
    return NextResponse.json({ error: "Braze not configured (missing BRAZE_API_KEY or BRAZE_REST_URL)" }, { status: 500 });
  }

  const factory = new PayloadFactory();
  let totalSent = 0;
  let totalSuppressed = 0;
  let totalErrors = 0;

  const agents = await prisma.agent.findMany({
    where: { status: "active" },
    include: {
      personaTargets: true,
      schedulingRule: true,
      messages: {
        include: {
          variants: { where: { status: "active" } },
        },
      },
    },
  });

  for (const agent of agents) {
    const personaIds = agent.personaTargets.map((pt) => pt.personaId);
    if (personaIds.length === 0) continue;

    // Build variant detail lookup: variantId → { channel, body, title, brazeCampaignId, brazeVariantId }
    const variantMeta = new Map<string, {
      channel: string;
      body: string;
      title: string | null;
      brazeCampaignId: string | null;
      brazeVariantId: string | null;
    }>();
    for (const msg of agent.messages) {
      for (const v of msg.variants) {
        variantMeta.set(v.id, {
          channel:        msg.channel,
          body:           v.body,
          title:          v.title ?? null,
          brazeCampaignId: msg.brazeCampaignId ?? null,
          brazeVariantId: v.brazeVariantId ?? null,
        });
      }
    }

    // Evaluate agent-level scheduling checks once (not per user)
    const rule = agent.schedulingRule;
    const now = new Date();

    // 4a. Quiet hours — same for all users, check once
    if (rule) {
      const quietHours = rule.quietHours as unknown as { start?: string; end?: string; timezone?: string };
      if (quietHours?.start && quietHours?.end) {
        const tzTime = new Intl.DateTimeFormat("en-US", {
          timeZone: quietHours.timezone ?? "UTC",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(now);
        const { start, end } = quietHours;
        const inQuiet =
          start > end
            ? tzTime >= start || tzTime < end
            : tzTime >= start && tzTime < end;
        if (inQuiet) {
          // All users for this agent are in quiet hours — skip agent entirely
          continue;
        }
      }
    }

    // Pre-seed PersonaArmStats for all persona × variant combinations so
    // concurrent decideForUser calls don't race on the upsert.
    const allVariantIds = agent.messages.flatMap((m) => m.variants.map((v) => v.id));
    const initialAlpha = agent.algorithm === "thompson" ? 1 : 0;
    const initialBeta  = agent.algorithm === "thompson" ? 1 : 0;
    for (const personaId of personaIds) {
      for (const variantId of allVariantIds) {
        await prisma.personaArmStats.upsert({
          where: { personaId_agentId_variantId: { personaId, agentId: agent.id, variantId } },
          create: { personaId, agentId: agent.id, variantId, alpha: initialAlpha, beta: initialBeta, tries: 0, wins: 0 },
          update: {},
        });
      }
    }

    // Page through users in this agent's target personas (500 at a time)
    let cursor: string | undefined;
    while (true) {
      const users = await prisma.user.findMany({
        where: { personaId: { in: personaIds } },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (users.length === 0) break;
      cursor = users[users.length - 1].id;

      // 4b. Bulk frequency cap check — get recent decision counts for all users in one query
      const freqCappedUserIds = new Set<string>();
      const freqCap = rule?.frequencyCap as unknown as { maxSends?: number; period?: string } | null;
      if (rule && typeof freqCap?.maxSends === "number") {
        const periodMs: Record<string, number> = {
          day:    86_400_000,
          week:   7  * 86_400_000,
          biweek: 14 * 86_400_000,
          month:  30 * 86_400_000,
        };
        const windowStart = new Date(now.getTime() - (periodMs[freqCap.period ?? "week"] ?? periodMs.week));
        const userExternalIds = users.map((u) => u.externalId);

        // Fetch recent decision counts per user in one query
        const recentDecisions = await prisma.userDecision.groupBy({
          by: ["userId"],
          where: {
            agentId: agent.id,
            userId: { in: userExternalIds },
            sentAt: { gte: windowStart },
          },
          _count: { userId: true },
        });

        const countByUser = new Map(recentDecisions.map((r) => [r.userId, r._count.userId]));
        for (const u of users) {
          const count = countByUser.get(u.externalId) ?? 0;
          if (count >= freqCap.maxSends) {
            freqCappedUserIds.add(u.externalId);
          }
        }
      }

      // 4c. Smart suppression — filter out chronically low-reward users using already-loaded user data
      const smartSuppressedUserIds = new Set<string>();
      if (rule?.smartSuppress) {
        for (const u of users) {
          if (u.totalDecisions >= 5) {
            const avgReward = u.totalReward / u.totalDecisions;
            if (avgReward < -rule.suppressThresh) {
              smartSuppressedUserIds.add(u.externalId);
            }
          }
        }
      }

      // Count suppressed users
      for (const u of users) {
        if (freqCappedUserIds.has(u.externalId) || smartSuppressedUserIds.has(u.externalId)) {
          totalSuppressed++;
        }
      }

      // Filter to eligible users only
      const eligibleUsers = users.filter(
        (u) => !freqCappedUserIds.has(u.externalId) && !smartSuppressedUserIds.has(u.externalId)
      );

      // Decide for each eligible user concurrently (concurrency-limited) and group by variant.
      // skipSchedulingChecks=true because we performed them in bulk above.
      const byVariant: Record<string, VariantSendGroup> = {};
      const CONCURRENCY = 10;

      for (let start = 0; start < eligibleUsers.length; start += CONCURRENCY) {
        const chunk = eligibleUsers.slice(start, start + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map((user) =>
            decideForUser({
              agentId: agent.id,
              externalUserId: user.externalId,
              preloadedAgent: agent,
              skipSchedulingChecks: true,
            }).then((r) => ({ user, result: r }))
          )
        );

        for (const { user, result } of chunkResults) {
          if (!result) continue;
          if (result.suppressed) {
            // Shouldn't happen since we skipped scheduling checks, but handle gracefully
            totalSuppressed++;
            continue;
          }

          const { messageVariantId, userDecisionId } = result;
          const meta = variantMeta.get(messageVariantId);
          if (!meta) continue;

          if (!byVariant[messageVariantId]) {
            byVariant[messageVariantId] = {
              variantId:       messageVariantId,
              brazeVariantId:  meta.brazeVariantId,
              brazeCampaignId: meta.brazeCampaignId,
              channel:         meta.channel,
              body:            meta.body,
              title:           meta.title,
              externalUserIds: [],
              decisionIds:     [],
            };
          }
          byVariant[messageVariantId].externalUserIds.push(user.externalId);
          byVariant[messageVariantId].decisionIds.push(userDecisionId);
        }
      }

      // Send each variant group in batches of 50
      for (const group of Object.values(byVariant)) {
        const BATCH = 50;
        for (let i = 0; i < group.externalUserIds.length; i += BATCH) {
          const batchUserIds    = group.externalUserIds.slice(i, i + BATCH);
          const batchDecisionIds = group.decisionIds.slice(i, i + BATCH);

          try {
            const sendId = group.brazeCampaignId
              ? await brazeClient.createSendId(group.brazeCampaignId)
              : null;

            const audience = { externalUserIds: batchUserIds };
            let payload: Record<string, unknown>;

            if (group.channel === "push") {
              payload = factory.buildPushPayload(
                { title: group.title ?? "", body: group.body },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            } else if (group.channel === "email") {
              payload = factory.buildEmailPayload(
                { subject: group.title ?? "", htmlBody: group.body },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            } else {
              payload = factory.buildSmsPayload(
                { body: group.body },
                audience,
                group.brazeCampaignId ?? undefined,
                sendId ?? undefined,
                group.brazeVariantId ?? undefined,
              );
            }

            const res = await brazeClient.post("/messages/send", payload);
            if (res.ok && sendId) {
              await prisma.userDecision.updateMany({
                where: { id: { in: batchDecisionIds } },
                data: { brazeSendId: sendId },
              });
            }
            totalSent += batchUserIds.length;
          } catch (err) {
            console.error("[cron/select-and-send] Braze send error:", err);
            totalErrors += batchUserIds.length;
          }
        }
      }

      if (users.length < 500) break;
    }
  }

  return NextResponse.json({ ok: true, sent: totalSent, suppressed: totalSuppressed, errors: totalErrors });
}
